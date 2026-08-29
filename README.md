# Aria — AI Companion Agent

Aria is a tool-calling **AI agent** powered by Google Gemini. Rather than
answering in a single pass, it runs a bounded reason → act → observe loop: the
model can call tools, read what they return, and use the results to answer —
streaming each step to the client as it happens.

It ships in three forms from a single codebase: a polished **Next.js web app**, a
**VS Code extension** for coding help right inside your editor, and a one‑line
**embeddable widget** you can drop onto any website.

> "Ask me anything." — Aria

---

## Features

- **Agent loop with tool calling** — Gemini function calling, bounded at 5 steps,
  with the tool trajectory streamed live to the UI (see [Agent architecture](#agent-architecture))
- **Three built-in tools** — conversation memory search, URL fetching, and exact arithmetic
- **Tool observability** — every invocation emits a Kafka event with outcome and latency
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
├── app/
│   └── api/chat/route.ts # HTTP + SSE transport; drives the agent loop
├── components/           # ChatWindow, ChatInput, MessageBubble, Sidebar, VoiceControls
├── lib/
│   ├── agent.ts          # The agent loop — transport-agnostic, unit tested
│   ├── tools.ts          # Tool registry: schemas + implementations
│   ├── gemini.ts         # Gemini wire format; streams one turn at a time
│   ├── expression.ts     # Safe arithmetic parser (no eval)
│   ├── url-guard.ts      # SSRF protection for fetch_url
│   ├── events.ts         # Kafka/Redis event bus, incl. tool telemetry
│   └── db.ts             # Mongo persistence + conversation search
├── tests/                # Node test runner; no framework needed
├── public/widget.js      # The embeddable chat widget
├── vscode-extension/     # The "Aria AI Companion" VS Code extension
├── SETUP.md              # Step‑by‑step setup for every surface
└── README.md
```

---

## Agent architecture

A chatbot makes one model call per message. Aria makes as many as the task needs,
up to a hard ceiling.

```
user message
     │
     ▼
┌─────────────────────────────────────────────┐
│  streamTurn() ── one Gemini turn            │
│    ├─ text  ──────────────► streamed to UI  │
│    └─ functionCall ──┐                      │
└──────────────────────┼──────────────────────┘
                       ▼
              execute tool (bounded timeout)
                       │
                       ▼
        append model turn + functionResponse
                       │
                       └──► loop (max 5 steps)
```

**Design decisions worth knowing about:**

| Concern | How it's handled |
|---|---|
| Runaway loops | `MAX_STEPS = 5`. The final iteration is sent *without* tools, forcing the model to answer from what it has instead of requesting a call it will never get. |
| Tool failures | Executors resolve with `{ error }` rather than throwing. A failure becomes data the model can read and explain, not an exception that kills the stream. |
| Hanging tools | Every tool declares a `timeoutMs`; the runner races it and turns a hang into a readable error. |
| Context blowout | Tool results are capped at 12k characters before being fed back. |
| SSRF | `fetch_url` rejects private, loopback, link-local and metadata addresses — re-checked *after* redirects, since a public URL can 302 into a private one. |
| Code execution | `calculate` uses a hand-written recursive-descent parser, never `eval`. Lookup tables have null prototypes so `constructor(2)` can't reach a callable. |
| Data isolation | `search_past_conversations` is scoped to the signed-in user's `userId` at the query level, so the model cannot reach another account's history. |
| Observability | Each call emits `tool.called` / `tool.succeeded` / `tool.failed` to Kafka with latency, making tool-level failure rates queryable independently of chat volume. |
| Persistence outage | Storage failures are logged and swallowed — losing the transcript beats losing the conversation. |

The loop in `lib/agent.ts` knows nothing about HTTP, Mongo, or what any tool
does: tool execution arrives as a callback and progress leaves through an event
object. That's what lets `tests/agent-loop.test.ts` drive it against a fake
Gemini endpoint with no API key, no network, and no quota.

### Built-in tools

| Tool | Purpose |
|---|---|
| `search_past_conversations` | Searches the signed-in user's own history — memory beyond the context window |
| `fetch_url` | Fetches a public page and reduces it to readable text |
| `calculate` | Exact arithmetic, so the model never has to guess at a number |

Add a tool by appending one object to `TOOLS` in `lib/tools.ts` — a JSON schema
plus an `execute` function. The loop picks it up with no other changes.

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
| `GEMINI_MODEL` | no | `gemini-2.0-flash` (default), `gemini-1.5-flash`, or `gemini-1.5-pro` |
| `GEMINI_BASE_URL` | no | Override the Gemini endpoint — useful for a proxy or a local emulator |

> Never commit `.env.local`. For production, set these in your hosting provider's environment variable dashboard.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint with ESLint |
| `npm test` | Run the agent + tool unit tests (Node's built-in runner — nothing to install) |

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
- **AI:** Gemini 2.0 Flash / 1.5 Pro via the REST API, with function calling
- **Agent:** Custom bounded reason→act→observe loop (`lib/agent.ts`)
- **Infra:** MongoDB (transcripts), Redis (cache + pub/sub), Kafka (event log)
- **Voice:** Web Speech API (SpeechRecognition + SpeechSynthesis)
- **Extension:** VS Code Extension API (WebView‑based chat panel)

---

## Privacy

Messages are sent directly from your app (or VS Code extension) to Google's Gemini API. Aria does not store conversations on any Anthropic or third‑party server — chat history lives in the browser (or extension) only.

---

## License

MIT — do whatever you like, attribution appreciated.
