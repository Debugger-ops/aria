// lib/auth.ts (UNIFIED AUTH API)

import 'server-only';

// Node-only imports
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Edge-safe import
import { jwtVerify } from 'jose';

// ---------------- CONFIG ----------------
const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = 'aria-session';

const secret = new TextEncoder().encode(JWT_SECRET);

// ---------------- FILE DB ----------------
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
}

function readUsers() {
  ensure();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users: any[]) {
  ensure();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------------- USER AUTH ----------------

export async function registerUser(email: string, name: string, password: string) {
  const users = readUsers();

  if (users.find((u: any) => u.email === email)) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: Date.now().toString(),
    email,
    name,
    passwordHash,
    role: 'user',
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeUsers(users);

  return user;
}

export async function loginUser(email: string, password: string) {
  const users = readUsers();
  const user = users.find((u: any) => u.email === email);

  if (!user) throw new Error('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return user;
}

// ---------------- JWT (NODE) ----------------

export function createToken(user: any) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ---------------- JWT (EDGE SAFE) ----------------

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

  const match = cookieHeader.match(
    new RegExp(`${COOKIE_NAME}=([^;]+)`)
  );

  if (!match) return null;

  return verifyToken(match[1]);
}

// ---------------- COOKIE HELPERS (NODE ONLY) ----------------

export async function setSessionCookie(token: string) {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// ---------------- SESSION HELPERS ----------------

export async function getSessionUser() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.userId) return null;

  const users = readUsers();
  const user = users.find((u: any) => u.id === payload.userId);
  if (!user) return null;

  // strip sensitive fields before returning
  const { passwordHash: _, ...safe } = user;
  return safe;
}

// ---------------- USER MANAGEMENT ----------------

export function getAllUsers() {
  const users = readUsers();
  return users.map(({ passwordHash: _, ...safe }: any) => safe);
}

export async function updateUserProfile(
  userId: string,
  updates: { name?: string; avatar?: string; password?: string }
) {
  const users = readUsers();
  const idx = users.findIndex((u: any) => u.id === userId);
  if (idx === -1) throw new Error('User not found');

  if (updates.name)     users[idx].name   = updates.name;
  if (updates.avatar)   users[idx].avatar = updates.avatar;
  if (updates.password) {
    users[idx].passwordHash = await bcrypt.hash(updates.password, 10);
  }

  writeUsers(users);

  const { passwordHash: _, ...safe } = users[idx];
  return safe;
}