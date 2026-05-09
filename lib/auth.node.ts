import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'server-only';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const JWT_SECRET = process.env.JWT_SECRET!;

// ---------------- types ----------------
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'user' | 'admin';
  createdAt: string;
}

// ---------------- helpers ----------------
function ensure() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]');
  }
}

function readUsers(): User[] {
  ensure();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users: User[]) {
  ensure();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------------- auth functions ----------------

export async function registerUser(
  email: string,
  name: string,
  password: string
) {
  const users = readUsers();

  if (users.find((u) => u.email === email)) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user: User = {
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
  const user = users.find((u) => u.email === email);

  if (!user) throw new Error('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return user;
}

export function createToken(user: User) {
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

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}