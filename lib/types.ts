// Core message type
export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  dbMsgId?: string;      // ID in the server DB — used to submit feedback
  feedback?: 'up' | 'down'; // cached user rating
}

// Chat session
export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
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
