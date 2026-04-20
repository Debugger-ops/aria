import { Message, ChatSession, MessageRole } from './types';

// Generate a unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Format a timestamp for display
export function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// Create a new message object
export function createMessage(role: MessageRole, content: string): Message {
  return {
    id: generateId(),
    role,
    content,
    timestamp: new Date(),
  };
}

// Create a new chat session
export function createSession(firstMessage?: string): ChatSession {
  const now = new Date();
  return {
    id: generateId(),
    title: firstMessage
      ? firstMessage.slice(0, 40) + (firstMessage.length > 40 ? '…' : '')
      : 'New Conversation',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Derive a title for a session from its first user message
export function deriveSessionTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New Conversation';
  const text = first.content.trim();
  return text.slice(0, 40) + (text.length > 40 ? '…' : '');
}

// Persist sessions to localStorage
export function saveSessions(sessions: ChatSession[]): void {
  try {
    const serialised = sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messages: s.messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
    }));
    localStorage.setItem('ai-companion-sessions', JSON.stringify(serialised));
  } catch {
    // Ignore storage errors (e.g. private mode)
  }
}

// Load sessions from localStorage
export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem('ai-companion-sessions');
    if (!raw) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = JSON.parse(raw);
    return parsed.map((s) => ({
      ...s,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
      messages: s.messages.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any): Message => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })
      ),
    }));
  } catch {
    return [];
  }
}

// Build the conversation history for the API (last N messages)
export function buildHistory(
  messages: Message[],
  limit = 20
): Array<{ role: MessageRole; content: string }> {
  return messages.slice(-limit).map(({ role, content }) => ({ role, content }));
}

// ── Server-side in-memory conversation store (keyed by sessionId) ─

const serverSessions: Map<string, Array<{ role: MessageRole; content: string }>> = new Map();

export function getServerHistory(sessionId: string): Array<{ role: MessageRole; content: string }> {
  return serverSessions.get(sessionId) ?? [];
}

export function appendServerHistory(
  sessionId: string,
  role: MessageRole,
  content: string
): void {
  const history = serverSessions.get(sessionId) ?? [];
  history.push({ role, content });
  if (history.length > 40) history.splice(0, history.length - 40);
  serverSessions.set(sessionId, history);
}

// ── Smart mock fallback (used only when no Gemini key is set) ────
//
// These responses are context-sensitive and emotionally aware so they
// are never embarrassingly off-topic even without a real AI.

export function getMockResponse(userMessage: string): string {
  const raw = userMessage.trim();
  const lower = raw.toLowerCase();
  const words = new Set(lower.split(/\W+/));

  const has = (...terms: string[]) => terms.some((t) => lower.includes(t));
  const hasWord = (...terms: string[]) => terms.some((t) => words.has(t));

  // ── Greetings ────────────────────────────────────────────────
  if (hasWord('hello', 'hi', 'hey', 'howdy', 'sup', 'yo')) {
    return "Hey! 👋 Really glad you're here. I'm Aria — your AI companion. What's on your mind today?";
  }

  // ── Self-worth / self-esteem issues ─────────────────────────
  if (has('worthless', 'useless', 'i am nothing', "i'm nothing", 'no good',
          'failure', 'loser', 'nobody cares', 'hate myself', 'hate my life')) {
    return "Hey, I hear you — and I want you to know that those feelings, as real as they are, are not the truth about you. You're here, you're trying, and that already matters more than you realise. What's been making you feel this way? I'm genuinely listening.";
  }

  // ── Feeling stupid / not smart ──────────────────────────────
  if (has('i am stupid', "i'm stupid", 'i am dumb', "i'm dumb", 'i think i am stupid',
          'i am slow', 'not smart', 'bad at everything', 'can\'t do anything right')) {
    return "You're not stupid — not even close. The fact that you can recognise your own struggles and talk about them honestly? That takes real self-awareness. Everyone has things they find hard. What's been making you feel that way? Tell me more.";
  }

  // ── Sadness / depression ─────────────────────────────────────
  if (has('sad', 'depressed', 'depression', 'unhappy', 'miserable',
          'feel empty', 'feeling empty', 'no point', 'what\'s the point',
          'don\'t want to', 'dont want to', 'give up')) {
    return "I'm really sorry you're feeling this way. You don't have to carry it alone — I'm right here with you. It's okay to not be okay. Can you tell me a little more about what's been going on?";
  }

  // ── Anxiety / stress / overwhelm ────────────────────────────
  if (has('anxious', 'anxiety', 'stressed', 'stress', 'overwhelmed',
          'can\'t cope', 'cant cope', 'too much', 'panic', 'scared',
          'worried', 'worry', 'nervous')) {
    return "That sounds really overwhelming, and I want you to take a breath with me for a second. You don't have to solve everything at once. What's the biggest thing weighing on you right now? Let's start there.";
  }

  // ── Loneliness ───────────────────────────────────────────────
  if (has('lonely', 'alone', 'no one', 'nobody', 'no friends',
          'isolated', 'left out', 'abandoned', 'ignored')) {
    return "Loneliness is one of the hardest feelings — and I'm really glad you told me. You're not alone right now, even if it feels that way. I'm here, and I genuinely care. What's been happening?";
  }

  // ── Anger / frustration ──────────────────────────────────────
  if (has('angry', 'furious', 'rage', 'pissed', 'so mad', 'hate',
          'frustrated', 'annoyed', 'fed up', 'sick of')) {
    return "That frustration sounds really intense — and valid. Sometimes things just build up and you need to let it out. What's got you feeling this way? I'm here to listen without judgment.";
  }

  // ── Asking how AI is ────────────────────────────────────────
  if (has('how are you', 'how r u', 'how do you feel', 'are you ok')) {
    return "I'm here and ready to be fully present for you — that's what matters most to me right now. More importantly, how are *you* doing?";
  }

  // ── Gratitude ────────────────────────────────────────────────
  if (hasWord('thanks', 'thank', 'appreciate', 'grateful')) {
    return "Of course! 💙 That's exactly what I'm here for. You can always come back and talk to me, about anything at all.";
  }

  // ── Help request ─────────────────────────────────────────────
  if (hasWord('help', 'assist', 'support', 'guide', 'advice')) {
    return "Absolutely — I'm here for you. Tell me what's going on and we'll work through it together, step by step.";
  }

  // ── Goodbye ──────────────────────────────────────────────────
  if (has('bye', 'goodbye', 'see you', 'gotta go', 'talk later', 'cya')) {
    return "Take care of yourself out there. 🌟 Come back anytime — I'll always be here when you need to talk.";
  }

  // ── Happy / excited ──────────────────────────────────────────
  if (has('happy', 'excited', 'amazing', 'awesome', 'great', 'wonderful',
          'fantastic', 'so good', 'love it', 'best day')) {
    return "That energy is contagious! 🎉 Tell me everything — what's got you feeling so great? I want to hear it!";
  }

  // ── Bored ────────────────────────────────────────────────────
  if (hasWord('bored', 'boring', 'nothing', 'idk')) {
    return "Boredom is basically your brain saying it needs something interesting! 😄 Want to talk, play a word game, explore a random topic, or just vent? I'm game for anything.";
  }

  // ── Coding / technical ──────────────────────────────────────
  if (has('code', 'bug', 'error', 'function', 'javascript', 'python',
          'typescript', 'react', 'css', 'html', 'api', 'database')) {
    return "Oh, a coding question! I love those. Share the code or describe the problem and I'll do my best to help you debug or explain it.";
  }

  // ── Questions directed at AI ─────────────────────────────────
  if (has('who are you', 'what are you', 'are you ai', 'are you real',
          'are you human', 'do you have feelings')) {
    return "I'm Aria — an AI companion powered by Google Gemini. I'm not human, but I'm genuinely designed to care about your wellbeing and help you with anything life throws at you. Think of me as a very attentive friend who's always available. 😊 What's on your mind?";
  }

  // ── Short/unclear messages ───────────────────────────────────
  if (raw.length < 8) {
    return "I'm listening — can you tell me a bit more? I want to make sure I understand what you mean. 😊";
  }

  // ── Smart contextual fallbacks (never random) ────────────────
  const thoughtful = [
    `I hear you. Can you tell me more about that? I want to make sure I really understand what you're going through.`,
    `That sounds important. I'm fully here — walk me through it a bit more?`,
    `Thanks for sharing that with me. How long have you been feeling/thinking this way?`,
    `I appreciate you being open with me. What would feel most helpful right now — to talk it through, get some advice, or just be heard?`,
    `That's worth paying attention to. What do you think is at the root of it?`,
  ];

  // Pick based on message length (deterministic, not random)
  return thoughtful[raw.length % thoughtful.length];
}
