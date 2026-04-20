# Aria — AI Companion Chatbot

Aria is a friendly, fast, and flexible AI companion powered by Google Gemini. It ships in three forms from a single codebase: a polished **Next.js web app**, a **VS Code extension** for coding help right inside your editor, and a one‑line **embeddable widget** you can drop onto any website.

> "Ask me anything." — Aria

---

## Features

- Conversational chat UI with streaming responses, message history, and multiple sessions
- Voice input and text‑to‑speech replies (browser Web Speech API)
- Code‑aware helpers — explain, fix, refactor, and generate tests for selected code from VS Code
- Embeddable floating chat widget (`widget.js`) with theme, position, and greeting customization
- JavaScript API for programmatic control (`AriaWidget.open()`, `.send()`, `.reset()`, …)
- Runs on Gemini's free tier — no credit card required
- Built with Next.js 16, React 19, TypeScript, and Tailwind CSS v4

---

## Project structure

```
ai-companion-bot/
├── app/                  # Next.js App Router (UI + API routes)
│   └── api/              # /api/chat endpoint that proxies Gemini
├── components/           # ChatWindow, ChatInput, MessageBubble, Sidebar, VoiceControls
├── lib/                  # chatLogic, gemini client, voice, sounds, shared types
├── public/
│   └── widget.js         # The embeddable chat widget
├── vscode-extension/     # The "Aria AI Companion" VS Code extension
├── styles/               # Global styles
├── SETUP.md              # Step‑by‑step setup for every surface
└── README.md
```

---

## Quick start

### 1. Get a free Gemini API key

Visit <https://aistudio.google.com/apikey>, sign in with any Google account, and click **Create API Key**. The free tier gives you 15 requests/min and 1M tokens/min — no card needed.

### 2. Run the web app

```bash
git clone <this-repo>
cd ai-companion-bot

cp .env.local.example .env.local
# paste your key into GEMINI_API_KEY

npm install
npm run dev
```

Open <http://localhost:3000>.

### 3. Try the VS Code extension

```bash
cd vscode-extension
npm install
npm run compile
code .                   # open in VS Code, then press F5
```

Full install instructions (including packaging a `.vsix`) live in [`SETUP.md`](./SETUP.md).

### 4. Embed on any website

```html
<!-- Point at your deployed Aria server (recommended) -->
<script src="https://YOUR_DOMAIN/widget.js"
        data-aria-server="https://YOUR_DOMAIN"></script>
```

See [`SETUP.md`](./SETUP.md) for all `data-aria-*` customization options and the `AriaWidget` JS API.

---

## Environment variables

Create `.env.local` in the project root (use `.env.local.example` as a template):

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | yes | Your Google Gemini API key |
| `GEMINI_MODEL` | no | `gemini-1.5-flash` (default), `gemini-1.5-pro`, or `gemini-2.0-flash-exp` |

> Never commit `.env.local`. For production, set these in your hosting provider's environment variable dashboard.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint with ESLint |

---

## Deployment

The easiest path is Vercel:

```bash
npx vercel
# add GEMINI_API_KEY in Project Settings → Environment Variables
```

For the embed widget in production, prefer `data-aria-server="https://your-app.vercel.app"` over `data-aria-key=""` so your API key stays on the server and never reaches the browser.

---

## VS Code extension commands

| Action | Shortcut / Menu |
|---|---|
| Open Aria chat panel | `Ctrl+Shift+A` · `Cmd+Shift+A` |
| Explain selected code | Right‑click → **Aria: Explain Selected Code** |
| Fix / debug | Right‑click → **Aria: Fix / Debug Selected Code** |
| Refactor | Right‑click → **Aria: Improve / Refactor** |
| Write tests | Right‑click → **Aria: Write Tests** |
| Ask about file | Right‑click → **Aria: Ask About This File** |

Settings live under **Aria** in VS Code preferences: `aria.geminiApiKey`, `aria.model`, `aria.serverUrl`.

---

## Tech stack

- **Framework:** Next.js 16 (App Router) · React 19
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS v4
- **AI:** `@google/generative-ai` — Gemini 1.5 Flash / Pro
- **Voice:** Web Speech API (SpeechRecognition + SpeechSynthesis)
- **Extension:** VS Code Extension API (WebView‑based chat panel)

---

## Privacy

Messages are sent directly from your app (or VS Code extension) to Google's Gemini API. Aria does not store conversations on any Anthropic or third‑party server — chat history lives in the browser (or extension) only.

---

## License

MIT — do whatever you like, attribution appreciated.
