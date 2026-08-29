// lib/auth.ts — unified auth using MongoDB

import 'server-only';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { jwtVerify } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

import { connectToDatabase } from '@/lib/mongoose';
import { User } from '@/lib/models';

// ── Config ────────────────────────────────────────────────────────

const JWT_SECRET  = process.env.JWT_SECRET!;
const COOKIE_NAME = 'aria-session';
const secret      = new TextEncoder().encode(JWT_SECRET);

// ── User Auth ─────────────────────────────────────────────────────

export async function registerUser(email: string, name: string, password: string) {
  await connectToDatabase();

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new Error('User already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    id:           Date.now().toString(),
    email:        email.toLowerCase(),
    name,
    passwordHash,
    role:         'user',
    createdAt:    new Date().toISOString(),
  });

  return user.toObject();
}

export async function loginUser(email: string, password: string) {
  await connectToDatabase();

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return user.toObject();
}

// ── JWT ───────────────────────────────────────────────────────────

export function createToken(user: { id: string; email: string; role: string }) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function verifyTokenFromHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}

// ── Cookie Helpers ────────────────────────────────────────────────

export async function setSessionCookie(token: string) {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// ── Session ───────────────────────────────────────────────────────

export async function getSessionUser() {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.userId) return null;

  await connectToDatabase();
  const user = await User.findOne({ id: payload.userId }).lean();
  if (!user) return null;

  const { passwordHash: _, ...safe } = user as Record<string, unknown>;
  return safe;
}

// ── User Management ───────────────────────────────────────────────

export async function getAllUsers() {
  await connectToDatabase();
  const users = await User.find({}).lean();
  return users.map(({ passwordHash: _, ...safe }: Record<string, unknown>) => safe);
}

export async function getUserApiKey(userId: string): Promise<string | null> {
  await connectToDatabase();
  const user = await User.findOne({ id: userId }).select('geminiApiKey').lean() as { geminiApiKey?: string } | null;
  return user?.geminiApiKey ?? null;
}

export async function updateUserProfile(
  userId: string,
  updates: { name?: string; avatar?: string; password?: string; geminiApiKey?: string }
) {
  await connectToDatabase();

  const patch: Record<string, string> = {};
  if (updates.name)         patch.name         = updates.name;
  if (updates.avatar)       patch.avatar       = updates.avatar;
  if (updates.geminiApiKey !== undefined) patch.geminiApiKey = updates.geminiApiKey;
  if (updates.password) {
    patch.passwordHash = await bcrypt.hash(updates.password, 10);
  }

  const user = await User.findOneAndUpdate(
    { id: userId },
    { $set: patch },
    { returnDocument: 'after' }
  ).lean();

  if (!user) throw new Error('User not found');

  const { passwordHash: _, ...safe } = user as Record<string, unknown>;
  return safe;
}

// ── Password Reset ────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a password-reset token for the given email.
 * Returns the raw token + user name, or null if no such user exists.
 * Only the SHA-256 hash of the token is stored, so a DB leak can't be used to
 * reset accounts.
 */
export async function createPasswordReset(
  email: string,
): Promise<{ token: string; name: string } | null> {
  await connectToDatabase();
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return null;

  const token = randomBytes(32).toString('hex');
  user.resetTokenHash = hashToken(token);
  user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS).toISOString();
  await user.save();

  return { token, name: user.name };
}

/**
 * Consume a reset token and set a new password.
 * Throws if the token is invalid or expired.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await connectToDatabase();
  const user = await User.findOne({ resetTokenHash: hashToken(token) });
  if (!user || !user.resetTokenExpires) throw new Error('Invalid or expired reset link.');

  if (new Date(user.resetTokenExpires).getTime() < Date.now()) {
    throw new Error('This reset link has expired. Please request a new one.');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
}
