/**
 * lib/auth.ts
 *
 * Authentication utilities:
 *  - File-based user store (data/users.json)
 *  - Password hashing with bcryptjs
 *  - JWT session tokens stored in httpOnly cookies
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

// ── Paths ─────────────────────────────────────────────────────────

const DATA_DIR   = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ── Types ─────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  avatar?: string;         // emoji or initials
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  iat?: number;
  exp?: number;
}

// ── Constants ─────────────────────────────────────────────────────

const JWT_SECRET  = process.env.JWT_SECRET ?? 'aria-dev-secret-change-in-production';
const COOKIE_NAME = 'aria-session';
const SALT_ROUNDS = 10;
const TOKEN_TTL   = '7d';

// ── User store helpers ────────────────────────────────────────────

function ensureUsersFile(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf-8');
}

function readUsers(): User[] {
  ensureUsersFile();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as User[];
  } catch {
    return [];
  }
}

function writeUsers(users: User[]): void {
  ensureUsersFile();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// ── Public API ────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    role: u.role,
    createdAt: u.createdAt,
  };
}

/** Register a new user. Returns the public user or throws on duplicate email. */
export async function registerUser(
  email: string,
  name: string,
  password: string,
): Promise<PublicUser> {
  const users = readUsers();
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with this email already exists.');
  }

  const now  = new Date().toISOString();
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  // First user becomes admin
  const role: 'user' | 'admin' = users.length === 0 ? 'admin' : 'user';

  const user: User = {
    id:           generateId(),
    email:        email.toLowerCase().trim(),
    name:         name.trim(),
    passwordHash: hash,
    avatar:       name.trim().slice(0, 2).toUpperCase(),
    role,
    createdAt:    now,
    updatedAt:    now,
  };

  writeUsers([...users, user]);
  return toPublicUser(user);
}

/** Verify credentials. Returns the public user or throws on bad credentials. */
export async function loginUser(email: string, password: string): Promise<PublicUser> {
  const users = readUsers();
  const user  = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (!user) throw new Error('Invalid email or password.');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Invalid email or password.');

  return toPublicUser(user);
}

/** Update a user's profile fields. */
export async function updateUserProfile(
  userId: string,
  updates: { name?: string; avatar?: string; password?: string },
): Promise<PublicUser> {
  const users = readUsers();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found.');

  const user = { ...users[idx] };
  if (updates.name)   user.name   = updates.name.trim();
  if (updates.avatar) user.avatar = updates.avatar;
  if (updates.password) {
    user.passwordHash = await bcrypt.hash(updates.password, SALT_ROUNDS);
  }
  user.updatedAt = new Date().toISOString();

  users[idx] = user;
  writeUsers(users);
  return toPublicUser(user);
}

export function getAllUsers(): PublicUser[] {
  return readUsers().map(toPublicUser);
}

export function getUserById(id: string): PublicUser | null {
  const u = readUsers().find((u) => u.id === id);
  return u ? toPublicUser(u) : null;
}

// ── JWT helpers ───────────────────────────────────────────────────

export function createToken(user: PublicUser): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role } as JwtPayload,
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Cookie helpers (server components / route handlers) ───────────

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 24 * 7, // 7 days
    path:     '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionUser(): Promise<PublicUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    return getUserById(payload.userId);
  } catch {
    return null;
  }
}

/** For use in middleware (edge runtime) — reads token from request cookies. */
export function verifyTokenFromHeader(cookieHeader: string | null): JwtPayload | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}
