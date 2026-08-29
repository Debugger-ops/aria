import { NextRequest } from 'next/server';
import { createPasswordReset } from '@/lib/auth';
import { sendPasswordResetEmail, emailConfigured } from '@/lib/email';

export const runtime = 'nodejs';

// POST /api/auth/forgot-password  { email }
//
// Always returns a generic success so attackers can't probe which emails are
// registered (no account enumeration). When a provider is configured the reset
// link is emailed; in development with no provider, the link is returned in the
// response (and logged) so you can still test the flow.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'Email is required.' }, { status: 400 });
    }

    const reset = await createPasswordReset(email);

    let devLink: string | undefined;
    if (reset) {
      const origin = process.env.APP_URL ?? new URL(req.url).origin;
      const link = `${origin}/reset-password?token=${reset.token}`;
      const result = await sendPasswordResetEmail(email, reset.name, link);
      // Only expose the link directly when there's no email provider AND we're
      // not in production — purely a local-dev convenience.
      if (result.method === 'none' && process.env.NODE_ENV !== 'production') {
        devLink = link;
      }
    }

    return Response.json({
      message: 'If an account exists for that email, a reset link has been sent.',
      emailConfigured: emailConfigured(),
      ...(devLink ? { devLink } : {}),
    });
  } catch (err) {
    console.error('/api/auth/forgot-password error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
