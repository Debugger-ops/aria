// Core message type
export type MessageRole = 'user' | 'assistant';

/** One tool invocation the agent made while answering. */
export interface ToolCall {
  id: string;
  name: string;
  /** Short label for display, e.g. `calculate(1250 * 1.08^5)`. */
  label: string;
  /** Which iteration of the agent loop issued this call (1-indexed). */
  step: number;
  status: 'running' | 'ok' | 'error';
  /** Wall-clock duration once finished. */
  ms?: number;
  /** One-line result or error message. */
  summary?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  dbMsgId?: string;      // ID in the server DB — used to submit feedback
  feedback?: 'up' | 'down'; // cached user rating
  /** Tool trajectory for assistant messages produced by the agent loop. */
  toolCalls?: ToolCall[];
}

// Chat session
export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  pinned?: boolean;   // pinned to the top of the sidebar
}

// Chat application state
export interface ChatState {
  sessions: ChatSession[];
  activeSesssionId: string | null;
  isLoading: boolean;
  darkMode: boolean;
}

// API types
export interface ChatRequest {
  message: string;
  sessionId: string;
  history: Array<{ role: MessageRole; content: string }>;
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  aiMsgId?: string; // ID of the AI message in the DB — used for feedback
}

export type FeedbackRating = 'up' | 'down';

export interface ApiError {
  error: string;
  status: number;
}
