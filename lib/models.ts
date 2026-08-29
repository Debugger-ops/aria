import mongoose, { Schema, model, models } from 'mongoose';

// ── User ─────────────────────────────────────────────────────────

export interface IUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'user' | 'admin';
  avatar?: string;
  geminiApiKey?: string;
  createdAt: string;
  resetTokenHash?: string;    // sha256 of the active password-reset token
  resetTokenExpires?: string; // ISO expiry for the reset token
}

const UserSchema = new Schema<IUser>({
  id:           { type: String, required: true, unique: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  name:         { type: String, required: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['user', 'admin'], default: 'user' },
  avatar:       { type: String },
  geminiApiKey: { type: String },
  createdAt:    { type: String, required: true },
  resetTokenHash:    { type: String },
  resetTokenExpires: { type: String },
});

export const User = models.User ?? model<IUser>('User', UserSchema);

// ── Conversation ─────────────────────────────────────────────────

/** One tool invocation made while producing an assistant message. */
export interface IToolCall {
  name: string;
  args: string;      // JSON-encoded arguments the model chose
  ok: boolean;
  ms: number;        // wall-clock duration of the tool run
  summary: string;   // short, human-readable result or error
}

export interface IMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** Present on assistant messages that used tools. The stored trajectory is
   *  what makes an agent debuggable after the fact — you can replay exactly
   *  which tools ran, in what order, and which of them failed. */
  toolCalls?: IToolCall[];
}

export interface IConversation {
  sessionId: string;
  userId?: string; // owner — set when an authenticated user starts the chat
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: IMessage[];
}

const ToolCallSchema = new Schema<IToolCall>({
  name:    { type: String, required: true },
  args:    { type: String, default: '{}' },
  ok:      { type: Boolean, required: true },
  ms:      { type: Number, default: 0 },
  summary: { type: String, default: '' },
}, { _id: false });

const MessageSchema = new Schema<IMessage>({
  id:        { type: String, required: true },
  role:      { type: String, enum: ['user', 'assistant'], required: true },
  content:   { type: String, required: true },
  timestamp: { type: String, required: true },
  toolCalls: { type: [ToolCallSchema], default: undefined },
}, { _id: false });

const ConversationSchema = new Schema<IConversation>({
  sessionId: { type: String, required: true, unique: true },
  userId:    { type: String, index: true },
  title:     { type: String, required: true },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
  messages:  { type: [MessageSchema], default: [] },
});

export const Conversation = models.Conversation ?? model<IConversation>('Conversation', ConversationSchema);

// ── Feedback ─────────────────────────────────────────────────────

export interface IFeedback {
  id: string;
  messageId: string;
  sessionId: string;
  rating: 'up' | 'down';
  userMessage: string;
  aiReply: string;
  createdAt: string;
}

const FeedbackSchema = new Schema<IFeedback>({
  id:          { type: String, required: true },
  messageId:   { type: String, required: true, unique: true },
  sessionId:   { type: String, required: true },
  rating:      { type: String, enum: ['up', 'down'], required: true },
  userMessage: { type: String, required: true },
  aiReply:     { type: String, required: true },
  createdAt:   { type: String, required: true },
});

export const Feedback = models.Feedback ?? model<IFeedback>('Feedback', FeedbackSchema);
