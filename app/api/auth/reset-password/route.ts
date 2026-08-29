import { NextRequest } from 'next/server';
import { resetPassword } from '@/lib/auth';

export const runtime = 'nodejs';

// POST /api/auth/reset-password  { token, password }
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token, password } = await req.json();

    if (!token || typeof token !== 'string') {
      return Response.json({ error: 'Reset token is required.' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return Response.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    await resetPassword(token, password);
    return Response.json({ message: 'Password updated. You can now sign in.' }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reset password.';
    return Response.json({ error: msg }, { status: 400 });
  }
}
