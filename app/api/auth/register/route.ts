import { NextRequest, NextResponse } from 'next/server';
import { registerUser, createToken } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { email, name, password } = await req.json();

    if (!email || !name || !password) {
      return NextResponse.json(
        { error: 'Email, name, and password are required.' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      );
    }

    const user = await registerUser(email, name, password);
    const token = createToken(user);

    const cookieStore = await cookies(); // ✅ FIX

    cookieStore.set('aria-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ user }, { status: 201 });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Registration failed.' },
      { status: 400 }
    );
  }
}