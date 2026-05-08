import { NextRequest } from 'next/server';
import { loginUser, createToken, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const user  = await loginUser(email, password);
    const token = createToken(user);
    await setSessionCookie(token);

    return Response.json({ user }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed.';
    return Response.json({ error: msg }, { status: 401 });
  }
}
