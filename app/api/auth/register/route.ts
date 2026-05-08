import { NextRequest } from 'next/server';
import { registerUser, createToken, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { email, name, password } = await req.json();

    if (!email || !name || !password) {
      return Response.json({ error: 'Email, name, and password are required.' }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const user  = await registerUser(email, name, password);
    const token = createToken(user);
    await setSessionCookie(token);

    return Response.json({ user }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration failed.';
    return Response.json({ error: msg }, { status: 400 });
  }
}
