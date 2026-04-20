/**
 * Aria AI Companion — Embeddable Website Widget
 * Usage:
 *   <script src="https://YOUR_DOMAIN/widget.js" data-aria-key="YOUR_GEMINI_KEY"></script>
 * Or with a self-hosted server:
 *   <script src="https://YOUR_DOMAIN/widget.js" data-aria-server="https://YOUR_DOMAIN"></script>
 */
(function (window, document) {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────
  const currentScript = document.currentScript;
  const CONFIG = {
    geminiKey:  currentScript?.getAttribute('data-aria-key')    || '',
    serverUrl:  currentScript?.getAttribute('data-aria-server') || '',
    position:   currentScript?.getAttribute('data-aria-pos')    || 'bottom-right',
    primaryColor: currentScript?.getAttribute('data-aria-color') || '#7c3aed',
    title:      currentScript?.getAttribute('data-aria-title')  || 'Aria AI',
    placeholder: currentScript?.getAttribute('data-aria-placeholder') || 'Ask me anything…',
    greeting:   currentScript?.getAttribute('data-aria-greeting') || "Hi! I'm Aria 👋 How can I help you today?",
    model:      currentScript?.getAttribute('data-aria-model')  || 'gemini-1.5-flash',
  };

  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  const SYSTEM_PROMPT = `You are Aria, a helpful AI assistant embedded on this website.
You help website visitors with questions, guidance, and support.
Be friendly, clear, and concise. Use bullet points and numbered lists when helpful.
If asked about code, wrap it in triple-backtick code blocks.
Always prioritise the user's actual need.`;

  // ── Conversation history ────────────────────────────────────────
  let history = []; // [{role:'user'|'model', parts:[{text}]}]
  let isLoading = false;
  let isOpen = false;

  // ── CSS ─────────────────────────────────────────────────────────
  const css = `
    #aria-widget-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }

    #aria-toggle-btn {
      position: fixed;
      ${CONFIG.position.includes('right') ? 'right:20px;' : 'left:20px;'}
      ${CONFIG.position.includes('top') ? 'top:20px;' : 'bottom:20px;'}
      width: 56px; height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #2563eb);
      color: #fff; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; z-index: 999998;
      transition: transform .2s, box-shadow .2s;
    }
    #aria-toggle-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
    #aria-toggle-btn.aria-open { background: #374151; }

    #aria-panel {
      position: fixed;
      ${CONFIG.position.includes('right') ? 'right:16px;' : 'left:16px;'}
      ${CONFIG.position.includes('top') ? 'top:86px;' : 'bottom:86px;'}
      width: 360px;
      max-height: 560px;
      display: flex; flex-direction: column;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18);
      z-index: 999999;
      overflow: hidden;
      transform: scale(.9) translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: transform .2s cubic-bezier(.34,1.56,.64,1), opacity .18s ease;
    }
    #aria-panel.aria-visible {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    /* Header */
    .aria-header {
      padding: 12px 14px;
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #2563eb);
      color: #fff;
      display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    .aria-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: rgba(255,255,255,.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
    }
    .aria-header-text { flex: 1; }
    .aria-header-name { font-weight: 700; font-size: 14px; }
    .aria-header-status { font-size: 11px; opacity: .8; }
    .aria-close-btn {
      background: rgba(255,255,255,.15); border: none; color: #fff;
      width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    .aria-close-btn:hover { background: rgba(255,255,255,.3); }

    /* Messages */
    .aria-messages {
      flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: #e4e4ee transparent;
      background: #f8f8fc;
    }
    .aria-bubble-wrap {
      display: flex; flex-direction: column; gap: 3px;
      animation: ariaFadeIn .2s ease-out;
    }
    @keyframes ariaFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    .aria-bubble-wrap.aria-user { align-items: flex-end; }
    .aria-bubble-wrap.aria-ai  { align-items: flex-start; }
    .aria-label { font-size: 10px; font-weight: 700; opacity: .5; letter-spacing: .04em; text-transform: uppercase; }
    .aria-bubble {
      max-width: 85%; padding: 9px 12px;
      border-radius: 14px; font-size: 13.5px; line-height: 1.55;
      word-break: break-word;
    }
    .aria-bubble.aria-user-bubble {
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #2563eb);
      color: #fff; border-bottom-right-radius: 4px;
    }
    .aria-bubble.aria-ai-bubble {
      background: #fff; color: #111;
      box-shadow: 0 1px 6px rgba(0,0,0,.07);
      border-bottom-left-radius: 4px;
    }
    /* Inline markdown in AI bubbles */
    .aria-ai-bubble strong { font-weight: 700; }
    .aria-ai-bubble em     { font-style: italic; }
    .aria-ai-bubble code:not(pre code) {
      font-family: monospace; font-size: 12px;
      background: #f0f0f6; color: #7c3aed;
      padding: 1px 5px; border-radius: 4px;
    }
    .aria-ai-bubble pre {
      background: #1e1e2e; border-radius: 8px;
      margin: 6px 0; overflow: hidden;
    }
    .aria-ai-bubble pre code {
      display: block; color: #cdd6f4; font-family: monospace;
      font-size: 12px; padding: 10px 12px; overflow-x: auto;
      line-height: 1.5; white-space: pre;
    }
    .aria-code-actions { display: flex; gap: 5px; margin-top: 3px; }
    .aria-code-btn {
      background: #f0f0f6; border: none; color: #555;
      font-size: 10px; padding: 2px 8px; border-radius: 4px;
      cursor: pointer; font-family: inherit; transition: background .15s;
    }
    .aria-code-btn:hover { background: ${CONFIG.primaryColor}; color: #fff; }

    /* Typing */
    .aria-typing {
      display: flex; gap: 4px; align-items: center;
      padding: 8px 12px; background: #fff;
      border-radius: 14px 14px 14px 4px;
      box-shadow: 0 1px 6px rgba(0,0,0,.07);
      width: fit-content;
    }
    .aria-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #aaa; animation: ariaDot 1.2s ease infinite;
    }
    .aria-typing span:nth-child(2) { animation-delay: .2s; }
    .aria-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes ariaDot {
      0%,60%,100% { transform:translateY(0); opacity:.3; }
      30%          { transform:translateY(-5px); opacity:1; }
    }

    /* Error */
    .aria-error { color: #dc2626; font-size: 12px; padding: 6px 0; }

    /* Powered-by */
    .aria-powered {
      text-align: center; font-size: 10.5px;
      color: #aaa; padding: 4px 0;
      background: #f8f8fc;
    }

    /* Input */
    .aria-input-area {
      padding: 10px; border-top: 1px solid #eee;
      background: #fff; flex-shrink: 0;
    }
    .aria-input-row { display: flex; gap: 7px; align-items: flex-end; }
    .aria-textarea {
      flex: 1; border: 1.5px solid #e4e4ee; border-radius: 10px;
      padding: 7px 10px; font-size: 13px; font-family: inherit;
      resize: none; outline: none; min-height: 36px; max-height: 100px;
      line-height: 1.45; transition: border-color .2s;
      color: #111; background: #f8f8fc;
    }
    .aria-textarea:focus { border-color: ${CONFIG.primaryColor}; background: #fff; }
    .aria-textarea::placeholder { color: #aaa; }
    .aria-send-btn {
      width: 36px; height: 36px; flex-shrink: 0;
      border-radius: 10px; border: none;
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #2563eb);
      color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .15s, transform .15s;
      box-shadow: 0 2px 8px rgba(124,58,237,.3);
    }
    .aria-send-btn:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
    .aria-send-btn:not(:disabled):hover { opacity: .88; transform: scale(1.05); }

    @media (max-width: 400px) {
      #aria-panel { width: calc(100vw - 24px); left: 12px; right: 12px; }
    }
  `;

  // ── Inject styles ────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Build DOM ───────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'aria-widget-root';

  // Toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'aria-toggle-btn';
  toggleBtn.title = 'Chat with Aria AI';
  toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  // Panel
  const panel = document.createElement('div');
  panel.id = 'aria-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', CONFIG.title + ' Chat');

  panel.innerHTML = `
    <div class="aria-header">
      <div class="aria-avatar">✦</div>
      <div class="aria-header-text">
        <div class="aria-header-name">${CONFIG.title}</div>
        <div class="aria-header-status" id="aria-status">Online · Powered by Gemini (free)</div>
      </div>
      <button class="aria-close-btn" id="aria-close-btn" aria-label="Close chat">✕</button>
    </div>
    <div class="aria-messages" id="aria-messages" role="log" aria-live="polite"></div>
    <div class="aria-powered">Powered by Google Gemini · Free AI</div>
    <div class="aria-input-area">
      <div class="aria-input-row">
        <textarea class="aria-textarea" id="aria-input" rows="1" placeholder="${CONFIG.placeholder}" aria-label="Message"></textarea>
        <button class="aria-send-btn" id="aria-send" disabled aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  root.appendChild(toggleBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  // ── Element refs ─────────────────────────────────────────────────
  const messagesEl = panel.querySelector('#aria-messages');
  const inputEl    = panel.querySelector('#aria-input');
  const sendBtn    = panel.querySelector('#aria-send');
  const closeBtn   = panel.querySelector('#aria-close-btn');
  const statusEl   = panel.querySelector('#aria-status');

  // ── Show greeting ────────────────────────────────────────────────
  appendAiMessage(CONFIG.greeting);

  // ── Toggle panel ─────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('aria-visible', isOpen);
    toggleBtn.classList.toggle('aria-open', isOpen);
    if (isOpen) setTimeout(() => inputEl.focus(), 200);
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('aria-visible');
    toggleBtn.classList.remove('aria-open');
  });

  // ── Input handling ───────────────────────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    sendBtn.disabled = !inputEl.value.trim() || isLoading;
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // ── Send message ─────────────────────────────────────────────────
  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    isLoading = true;

    appendUserMessage(text);
    const typingEl = appendTyping();

    setStatus('Typing…');

    try {
      let reply;
      if (CONFIG.geminiKey) {
        reply = await callGeminiDirect(text);
      } else if (CONFIG.serverUrl) {
        reply = await callServer(text, CONFIG.serverUrl);
      } else {
        throw new Error('No API key or server URL configured. Please set data-aria-key or data-aria-server on the widget script tag.');
      }
      typingEl.remove();
      appendAiMessage(reply);
    } catch (err) {
      typingEl.remove();
      appendError(err.message);
    } finally {
      isLoading = false;
      setStatus('Online · Powered by Gemini (free)');
      sendBtn.disabled = !inputEl.value.trim();
    }
  }

  // ── Gemini direct API call ────────────────────────────────────────
  async function callGeminiDirect(userText) {
    history.push({ role: 'user', parts: [{ text: userText }] });

    const url = `${GEMINI_BASE}/${CONFIG.model}:generateContent?key=${CONFIG.geminiKey}`;
    const body = {
      contents: history,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.8, maxOutputTokens: 1024, topP: 0.95 },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      history.pop();
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) throw new Error('Empty response from Gemini.');

    history.push({ role: 'model', parts: [{ text: reply }] });
    if (history.length > 40) history = history.slice(history.length - 40);
    return reply;
  }

  // ── Server proxy call ─────────────────────────────────────────────
  async function callServer(userText, serverUrl) {
    const res = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText, sessionId: 'widget', history: [] }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    return data.reply;
  }

  // ── DOM helpers ───────────────────────────────────────────────────

  function appendUserMessage(text) {
    const wrap = el('div', 'aria-bubble-wrap aria-user');
    const label = el('div', 'aria-label', 'You');
    const bubble = el('div', 'aria-bubble aria-user-bubble', escapeHtml(text));
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function appendAiMessage(raw) {
    const wrap = el('div', 'aria-bubble-wrap aria-ai');
    const label = el('div', 'aria-label', CONFIG.title);
    const bubble = document.createElement('div');
    bubble.className = 'aria-bubble aria-ai-bubble';
    bubble.innerHTML = renderMarkdown(raw);

    // Copy buttons on code blocks
    bubble.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code')?.textContent ?? '';
      const actions = el('div', 'aria-code-actions');
      const copyBtn = el('button', 'aria-code-btn', '⎘ Copy');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(code);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = '⎘ Copy'; }, 1500);
      });
      actions.appendChild(copyBtn);
      pre.after(actions);
    });

    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function appendTyping() {
    const wrap = el('div', 'aria-bubble-wrap aria-ai');
    const label = el('div', 'aria-label', CONFIG.title);
    const typing = el('div', 'aria-typing');
    typing.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(label);
    wrap.appendChild(typing);
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  function appendError(msg) {
    const errEl = el('div', 'aria-error', '⚠ ' + msg);
    messagesEl.appendChild(errEl);
    scrollBottom();
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function el(tag, classes, text) {
    const e = document.createElement(tag);
    if (classes) e.className = classes;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderMarkdown(text) {
    // Fenced code blocks
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre>`
    );
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Headers
    text = text.replace(/^### (.+)$/gm, '<strong style="display:block;margin:6px 0 2px">$1</strong>');
    text = text.replace(/^## (.+)$/gm,  '<strong style="display:block;margin:6px 0 2px;font-size:14px">$1</strong>');
    // Numbered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px">$1</li>');
    // Bullet lists
    text = text.replace(/^[-*] (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  // Expose API for programmatic control
  window.AriaWidget = {
    open:  () => { isOpen = true;  panel.classList.add('aria-visible');    toggleBtn.classList.add('aria-open');    },
    close: () => { isOpen = false; panel.classList.remove('aria-visible'); toggleBtn.classList.remove('aria-open'); },
    send:  (msg) => { inputEl.value = msg; handleSend(); },
    reset: () => { history = []; messagesEl.innerHTML = ''; appendAiMessage(CONFIG.greeting); },
  };

})(window, document);
