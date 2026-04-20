# Aria AI — Setup Guide

## 1. Get Your Free Gemini API Key (60 seconds)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with any Google account
3. Click **"Create API Key"**
4. Copy the key

**Free limits:** 15 requests/min · 1M tokens/min · No credit card needed

---

## 2. Run the Web App

```bash
# In the project root
cp .env.local.example .env.local
# Paste your key into .env.local

npm run dev
# Open http://localhost:3000
```

---

## 3. Add the VS Code Extension

### Option A — Install from source (development)

```bash
cd vscode-extension
npm install
npm run compile

# Open VS Code in the extension folder
code .
# Press F5 to launch Extension Development Host
```

### Option B — Package as .vsix and install permanently

```bash
cd vscode-extension
npm install
npm install -g @vscode/vsce
vsce package
# Creates: aria-ai-companion-1.0.0.vsix

# Install in VS Code:
code --install-extension aria-ai-companion-1.0.0.vsix
```

### Configure the extension

Open VS Code Settings (`Ctrl+,`) and search for **"Aria"**:

| Setting | Value |
|---|---|
| `aria.geminiApiKey` | Your Gemini API key |
| `aria.model` | `gemini-1.5-flash` (default, free) |
| `aria.serverUrl` | `http://localhost:3000` (optional fallback) |

### Using the extension

| Action | How |
|---|---|
| Open chat panel | `Ctrl+Shift+A` (Mac: `Cmd+Shift+A`) or click ✦ in activity bar |
| Explain code | Select code → right-click → **Aria: Explain Selected Code** |
| Fix a bug | Select code → right-click → **Aria: Fix / Debug Selected Code** |
| Improve code | Select code → right-click → **Aria: Improve / Refactor** |
| Write tests | Select code → right-click → **Aria: Write Tests** |
| Ask about file | Right-click in editor → **Aria: Ask About This File** |
| New conversation | Click `⊕` in the Aria panel header |

---

## 4. Embed on Any Website

Add **one line** before `</body>` in your HTML:

```html
<!-- With direct Gemini key (key visible in browser — use server option for production) -->
<script src="https://YOUR_DOMAIN/widget.js" data-aria-key="YOUR_GEMINI_KEY"></script>

<!-- OR point to your Aria server (recommended for production) -->
<script src="https://YOUR_DOMAIN/widget.js" data-aria-server="https://YOUR_DOMAIN"></script>
```

### Widget customisation options

```html
<script
  src="https://YOUR_DOMAIN/widget.js"
  data-aria-key="YOUR_GEMINI_KEY"
  data-aria-title="Support Bot"
  data-aria-color="#7c3aed"
  data-aria-pos="bottom-right"
  data-aria-greeting="Hi! How can I help you today?"
  data-aria-placeholder="Ask a question…"
  data-aria-model="gemini-1.5-flash"
></script>
```

| Attribute | Options | Default |
|---|---|---|
| `data-aria-key` | Your Gemini API key | — |
| `data-aria-server` | URL of your Aria Next.js app | — |
| `data-aria-title` | Any string | `Aria AI` |
| `data-aria-color` | Any hex color | `#7c3aed` |
| `data-aria-pos` | `bottom-right`, `bottom-left`, `top-right`, `top-left` | `bottom-right` |
| `data-aria-greeting` | Any string | built-in greeting |
| `data-aria-placeholder` | Any string | `Ask me anything…` |
| `data-aria-model` | `gemini-1.5-flash`, `gemini-1.5-pro` | `gemini-1.5-flash` |

### JavaScript API (programmatic control)

```javascript
AriaWidget.open();          // Open the chat panel
AriaWidget.close();         // Close it
AriaWidget.send("Hello!");  // Send a message programmatically
AriaWidget.reset();         // Clear conversation history
```

---

## 5. Production deployment

Deploy the Next.js app to Vercel (free tier works great):

```bash
npx vercel
# Add GEMINI_API_KEY in Vercel's Environment Variables dashboard
```

For security, always use `data-aria-server="https://your-vercel-app.vercel.app"` in the widget
instead of exposing the Gemini API key in the browser.
