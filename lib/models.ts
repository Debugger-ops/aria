import mongoose, { Schema, model, models } from 'mongoose';

// ── User ─────────────────────────────────────────────────────────

export interface IUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'user' | 'admin';
  avatar?: string;
  createdAt: string;
}

const UserSchema = new Schema<IUser>({
  id:           { type: String, required: true, unique: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  name:         { type: String, required: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['user', 'admin'], default: 'user' },
  avatar:       { type: String },
  createdAt:    { type: String, required: true },
});

export const User = models.User ?? model<IUser>('User', UserSchema);

// ── Conversation ─────────────────────────────────────────────────

export interface IMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface IConversation {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: IMessage[];
}

const MessageSchema = new Schema<IMessage>({
  id:        { type: String, required: true },
  role:      { type: String, enum: ['user', 'assistant'], required: true },
  content:   { type: String, required: true },
  timestamp: { type: String, required: true },
}, { _id: false });

const ConversationSchema = new Schema<IConversation>({
  sessionId: { type: String, required: true, unique: true },
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
