import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { GeminiClient } from './geminiClient';

export function activate(context: vscode.ExtensionContext) {
  console.log('Aria AI Companion is now active!');

  const config = vscode.workspace.getConfiguration('aria');
  const apiKey = config.get<string>('geminiApiKey') ?? '';
  const model  = config.get<string>('model') ?? 'gemini-1.5-flash';

  const client = new GeminiClient(apiKey, model);
  const provider = new ChatViewProvider(context.extensionUri, client);

  // Register the sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Open chat panel ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aria.openChat', () => {
      vscode.commands.executeCommand('aria.chatView.focus');
    })
  );

  // ── New conversation ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aria.newChat', () => {
      provider.clearHistory();
    })
  );

  // ── Context menu code commands ───────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('aria.explainCode', async () => {
      const code = getSelectedCode();
      if (!code) return;
      await provider.sendPrompt(
        `Please explain what this code does, step by step:\n\n\`\`\`\n${code}\n\`\`\``
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aria.fixCode', async () => {
      const code = getSelectedCode();
      if (!code) return;
      await provider.sendPrompt(
        `Please find and fix any bugs or issues in this code. Explain what was wrong and show the corrected version:\n\n\`\`\`\n${code}\n\`\`\``
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aria.improveCode', async () => {
      const code = getSelectedCode();
      if (!code) return;
      await provider.sendPrompt(
        `Please improve and refactor this code for clarity, performance, and best practices. Show the improved version with a brief explanation:\n\n\`\`\`\n${code}\n\`\`\``
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aria.writeTests', async () => {
      const code = getSelectedCode();
      if (!code) return;
      const lang = vscode.window.activeTextEditor?.document.languageId ?? '';
      await provider.sendPrompt(
        `Write comprehensive unit tests for this ${lang} code. Use appropriate testing frameworks and cover edge cases:\n\n\`\`\`${lang}\n${code}\n\`\`\``
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aria.askAboutFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor found.');
        return;
      }
      const fileName = editor.document.fileName.split('/').pop() ?? 'this file';
      const content = editor.document.getText();
      const lang = editor.document.languageId;
      const snippet = content.length > 3000 ? content.slice(0, 3000) + '\n... (truncated)' : content;
      await provider.sendPrompt(
        `Here is the file "${fileName}":\n\n\`\`\`${lang}\n${snippet}\n\`\`\`\n\nPlease give me an overview of what this file does, its key functions/components, and any potential improvements.`
      );
    })
  );

  // ── Reload settings when changed ─────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aria')) {
        const cfg = vscode.workspace.getConfiguration('aria');
        const newKey = cfg.get<string>('geminiApiKey') ?? '';
        const newModel = cfg.get<string>('model') ?? 'gemini-1.5-flash';
        client.setApiKey(newKey);
        client.setModel(newModel);
      }
    })
  );

  // ── Show setup reminder if no API key ────────────────────────
  if (!apiKey) {
    vscode.window.showInformationMessage(
      'Aria AI: Add your free Gemini API key to enable full AI features.',
      'Open Settings',
      'Get Free Key'
    ).then((choice) => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aria.geminiApiKey');
      } else if (choice === 'Get Free Key') {
        vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/apikey'));
      }
    });
  }
}

export function deactivate() {}

// ── Helpers ──────────────────────────────────────────────────────

function getSelectedCode(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Aria: No active editor found.');
    return null;
  }
  const selection = editor.selection;
  const code = editor.document.getText(selection.isEmpty ? undefined : selection);
  if (!code.trim()) {
    vscode.window.showWarningMessage('Aria: Please select some code first.');
    return null;
  }
  return code;
}
