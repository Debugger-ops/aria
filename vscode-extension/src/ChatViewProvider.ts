import * as vscode from 'vscode';
import { GeminiClient } from './geminiClient';

/**
 * Provides the Aria chat panel in the VS Code sidebar.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aria.chatView';
  private _view?: vscode.WebviewView;
  private _client: GeminiClient;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    client: GeminiClient
  ) {
    this._client = client;
  }

  // Called whenever the webview becomes visible
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'send': {
          const text: string = msg.text;
          if (!text.trim()) return;

          this._postToView({ type: 'thinking' });

          try {
            const reply = await this._sendMessage(text);
            this._postToView({ type: 'reply', text: reply });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this._postToView({ type: 'error', text: errMsg });
          }
          break;
        }
        case 'newChat': {
          this._client.clearHistory();
          this._postToView({ type: 'cleared' });
          break;
        }
        case 'openSettings': {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'aria.geminiApiKey'
          );
          break;
        }
        case 'copyCode': {
          await vscode.env.clipboard.writeText(msg.text);
          vscode.window.showInformationMessage('Code copied to clipboard!');
          break;
        }
        case 'insertCode': {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            editor.edit((editBuilder) => {
              editBuilder.replace(editor.selection, msg.text);
            });
          }
          break;
        }
      }
    });
  }

  /** Send a message from outside the webview (e.g., editor context commands) */
  public async sendPrompt(prompt: string): Promise<void> {
    // Make sure the view is visible
    await vscode.commands.executeCommand('aria.chatView.focus');

    // Display the prompt in the chat UI
    this._postToView({ type: 'inject', text: prompt });
    this._postToView({ type: 'thinking' });

    try {
      const reply = await this._sendMessage(prompt);
      this._postToView({ type: 'reply', text: reply });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._postToView({ type: 'error', text: errMsg });
    }
  }

  public clearHistory() {
    this._client.clearHistory();
    this._postToView({ type: 'cleared' });
  }

  private _postToView(msg: object) {
    this._view?.webview.postMessage(msg);
  }

  private async _sendMessage(text: string): Promise<string> {
    // Reload config in case user updated settings
    const config = vscode.workspace.getConfiguration('aria');
    const apiKey = config.get<string>('geminiApiKey') ?? '';
    const model = config.get<string>('model') ?? 'gemini-1.5-flash';
    const serverUrl = config.get<string>('serverUrl') ?? 'http://localhost:3000';

    if (apiKey) {
      this._client.setApiKey(apiKey);
      this._client.setModel(model);
      return this._client.send(text);
    }

    // Fallback: use the Next.js server if no API key
    const res = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: 'vscode', history: [] }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json() as { reply: string };
    return data.reply;
  }

  private _getHtml(_webview: vscode.Webview): string {
    const nonce = getNonce();
    // In a packaged extension these would be webview URIs; for now we inline everything
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline';
             script-src 'nonce-${nonce}';
             connect-src https://generativelanguage.googleapis.com http://localhost:* https://*;" />
  <title>Aria AI</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #333);
      flex-shrink: 0;
    }
    .header__title {
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header__dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
    }
    .header__actions { display: flex; gap: 4px; }
    .icon-btn {
      background: none; border: none;
      color: var(--vscode-foreground);
      opacity: 0.6; cursor: pointer;
      padding: 3px 5px; border-radius: 4px;
      font-size: 14px; line-height: 1;
      transition: opacity .15s, background .15s;
    }
    .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

    /* ── Messages ── */
    #messages {
      flex: 1; overflow-y: auto;
      padding: 10px 10px 6px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin;
    }

    /* Empty state */
    .empty {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 8px; text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 20px;
    }
    .empty__icon { font-size: 28px; }
    .empty__title { font-weight: 700; font-size: 14px; color: var(--vscode-foreground); }
    .empty__sub { font-size: 11px; line-height: 1.5; }
    .starters { display: flex; flex-direction: column; gap: 4px; width: 100%; margin-top: 6px; }
    .starter {
      background: var(--vscode-button-secondaryBackground, #3c3c3c);
      border: none; color: var(--vscode-button-secondaryForeground, #ccc);
      border-radius: 6px; padding: 6px 10px; font-size: 11px;
      cursor: pointer; text-align: left; font-family: inherit;
      transition: background .15s;
    }
    .starter:hover { background: var(--vscode-button-secondaryHoverBackground, #505050); }

    /* Message bubbles */
    .msg {
      display: flex; flex-direction: column; gap: 4px;
      animation: fadein .2s ease-out;
    }
    @keyframes fadein { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
    .msg--user { align-items: flex-end; }
    .msg--ai   { align-items: flex-start; }

    .msg__label {
      font-size: 10px; font-weight: 700; opacity: 0.5;
      letter-spacing: .06em; text-transform: uppercase;
    }
    .msg__bubble {
      max-width: 95%;
      padding: 8px 10px;
      border-radius: 10px;
      font-size: 12.5px;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg--user .msg__bubble {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border-bottom-right-radius: 3px;
    }
    .msg--ai .msg__bubble {
      background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
      color: var(--vscode-foreground);
      border-bottom-left-radius: 3px;
    }

    /* Code blocks inside AI messages */
    .msg__bubble pre {
      margin: 8px 0; border-radius: 6px; overflow: hidden;
    }
    .msg__bubble pre code {
      display: block;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family, 'Courier New');
      font-size: 11.5px;
      overflow-x: auto;
      line-height: 1.5;
      white-space: pre;
    }
    .code-actions {
      display: flex; gap: 4px; margin-top: 4px;
    }
    .code-btn {
      background: var(--vscode-button-secondaryBackground, #3c3c3c);
      border: none; color: var(--vscode-button-secondaryForeground, #ccc);
      font-size: 10px; padding: 2px 7px; border-radius: 4px;
      cursor: pointer; font-family: inherit;
      transition: background .15s;
    }
    .code-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

    /* Inline code */
    .msg__bubble code:not(pre code) {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-editor-background, #1e1e1e);
      color: #ce9178;
      padding: 1px 4px; border-radius: 3px; font-size: 11px;
    }

    /* Typing indicator */
    .typing { display: flex; align-items: center; gap: 4px; padding: 8px 4px; }
    .typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      animation: bounce 1s ease-in-out infinite;
    }
    .typing span:nth-child(2) { animation-delay: .15s; }
    .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes bounce {
      0%,60%,100% { transform:translateY(0); opacity:.4; }
      30%          { transform:translateY(-5px); opacity:1; }
    }

    /* Error */
    .error-msg {
      color: var(--vscode-errorForeground, #f48771);
      font-size: 11.5px; padding: 6px 0;
    }

    /* Setup banner */
    .setup-banner {
      margin: 8px; padding: 10px;
      background: var(--vscode-editorWarning-background, rgba(255,200,0,.1));
      border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
      border-radius: 6px; font-size: 11px; line-height: 1.5;
    }
    .setup-banner a {
      color: var(--vscode-textLink-foreground, #4ec9b0);
      cursor: pointer; text-decoration: underline;
    }

    /* ── Input area ── */
    .input-area {
      padding: 8px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, #333);
      flex-shrink: 0;
    }
    .input-row { display: flex; gap: 6px; align-items: flex-end; }
    #userInput {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 6px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: 12.5px;
      resize: none;
      min-height: 32px;
      max-height: 120px;
      line-height: 1.4;
      outline: none;
    }
    #userInput:focus { border-color: var(--vscode-focusBorder, #0078d4); }
    #userInput::placeholder { color: var(--vscode-input-placeholderForeground); }
    #sendBtn {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 6px;
      width: 30px; height: 30px;
      cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .15s;
    }
    #sendBtn:disabled { opacity: .4; cursor: not-allowed; }
    #sendBtn:not(:disabled):hover { opacity: .85; }
    .hint {
      font-size: 10px; color: var(--vscode-descriptionForeground);
      text-align: center; margin-top: 4px; opacity: .7;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header__title">
      <div class="header__dot"></div>
      ✦ Aria AI
    </div>
    <div class="header__actions">
      <button class="icon-btn" id="newChatBtn" title="New conversation">⊕</button>
      <button class="icon-btn" id="settingsBtn" title="Open settings">⚙</button>
    </div>
  </div>

  <!-- Messages -->
  <div id="messages">
    <div class="empty" id="emptyState">
      <div class="empty__icon">✦</div>
      <div class="empty__title">Hi, I'm Aria!</div>
      <div class="empty__sub">Free AI powered by Gemini.<br/>Ask me anything or use editor right-click.</div>
      <div class="starters">
        <button class="starter" data-prompt="Explain what the code in this file does">📄 Explain this file</button>
        <button class="starter" data-prompt="Review my code and suggest improvements and best practices">🔍 Review my code</button>
        <button class="starter" data-prompt="Help me debug this — what could be going wrong?">🐛 Help me debug</button>
        <button class="starter" data-prompt="Write unit tests for the selected code">🧪 Write tests</button>
      </div>
    </div>
  </div>

  <!-- Input -->
  <div class="input-area">
    <div class="input-row">
      <textarea id="userInput" rows="1" placeholder="Ask anything… (Enter to send)"></textarea>
      <button id="sendBtn" disabled title="Send (Enter)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z"/>
        </svg>
      </button>
    </div>
    <p class="hint">Enter to send · Shift+Enter for new line</p>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('userInput');
  const sendBtn    = document.getElementById('sendBtn');
  const emptyState = document.getElementById('emptyState');

  let isLoading = false;

  // ── Textarea auto-resize ──
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    sendBtn.disabled = !inputEl.value.trim() || isLoading;
  });

  // ── Send on Enter ──
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) send();
    }
  });

  sendBtn.addEventListener('click', send);

  // ── Starter prompts ──
  document.querySelectorAll('.starter').forEach(btn => {
    btn.addEventListener('click', () => {
      inputEl.value = btn.dataset.prompt;
      send();
    });
  });

  // ── Header buttons ──
  document.getElementById('newChatBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'newChat' });
  });
  document.getElementById('settingsBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

  function send() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    hideEmpty();
    appendMessage('user', text);
    showTyping();
    vscode.postMessage({ type: 'send', text });
    isLoading = true;
  }

  // ── VS Code → webview messages ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'reply':
        removeTyping();
        appendMessage('ai', msg.text);
        isLoading = false;
        sendBtn.disabled = !inputEl.value.trim();
        break;
      case 'error':
        removeTyping();
        appendError(msg.text);
        isLoading = false;
        sendBtn.disabled = !inputEl.value.trim();
        break;
      case 'thinking':
        // handled by the send() path
        break;
      case 'cleared':
        messagesEl.innerHTML = '';
        messagesEl.appendChild(emptyState);
        emptyState.style.display = '';
        isLoading = false;
        sendBtn.disabled = !inputEl.value.trim();
        break;
      case 'inject':
        hideEmpty();
        appendMessage('user', msg.text);
        showTyping();
        isLoading = true;
        sendBtn.disabled = true;
        break;
    }
  });

  // ── DOM helpers ──

  function hideEmpty() {
    emptyState.style.display = 'none';
  }

  function appendMessage(role, rawText) {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg--' + (role === 'user' ? 'user' : 'ai');

    const label = document.createElement('div');
    label.className = 'msg__label';
    label.textContent = role === 'user' ? 'You' : 'Aria';

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    if (role === 'ai') {
      bubble.innerHTML = renderMarkdown(rawText);
      // Attach copy/insert buttons to each code block
      bubble.querySelectorAll('pre').forEach((pre) => {
        const code = pre.querySelector('code')?.textContent ?? '';
        const actions = document.createElement('div');
        actions.className = 'code-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-btn';
        copyBtn.textContent = '⎘ Copy';
        copyBtn.addEventListener('click', () => vscode.postMessage({ type: 'copyCode', text: code }));

        const insertBtn = document.createElement('button');
        insertBtn.className = 'code-btn';
        insertBtn.textContent = '↓ Insert';
        insertBtn.addEventListener('click', () => vscode.postMessage({ type: 'insertCode', text: code }));

        actions.appendChild(copyBtn);
        actions.appendChild(insertBtn);
        pre.after(actions);
      });
    } else {
      bubble.textContent = rawText;
    }

    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.id = 'typing';
    el.className = 'typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function removeTyping() {
    document.getElementById('typing')?.remove();
  }

  function appendError(text) {
    const el = document.createElement('div');
    el.className = 'error-msg';
    el.textContent = '⚠ ' + text;
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Very lightweight markdown renderer ──
  function renderMarkdown(text) {
    // Fenced code blocks
    text = text.replace(/\`\`\`(\w*)\n?([\s\S]*?)\`\`\`/g, (_, lang, code) => {
      return '<pre><code class="lang-' + escHtml(lang) + '">' + escHtml(code.trim()) + '</code></pre>';
    });
    // Inline code
    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Headers
    text = text.replace(/^### (.+)$/gm, '<h4 style="margin:8px 0 4px;font-size:12.5px">$1</h4>');
    text = text.replace(/^## (.+)$/gm, '<h3 style="margin:8px 0 4px;font-size:13px">$1</h3>');
    text = text.replace(/^# (.+)$/gm, '<h2 style="margin:8px 0 4px;font-size:14px">$1</h2>');
    // Numbered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px">$1</li>');
    // Bullet lists
    text = text.replace(/^[-*] (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
    // Newlines → <br> (but not inside code blocks)
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
