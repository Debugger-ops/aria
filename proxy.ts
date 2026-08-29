import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromHeader } from '@/lib/auth-edge';
import { isAdmin } from '@/lib/admin';

export async function proxy(req: NextRequest) {
  const token = req.cookies.get('aria-session')?.value;

  const user = await verifyTokenFromHeader(
    token ? `aria-session=${token}` : null
  );

  const { pathname } = req.nextUrl;

  // ✅ Public routes (no auth needed)
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register');

  // ❌ Skip API routes completely
  const isApi = pathname.startsWith('/api');
  if (isApi) return NextResponse.next();

  // 🔐 Unauthenticated → login
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 🔒 Admin-only pages — restricted to the email allowlist in lib/admin.ts.
  //
  // This is the UX guard: it stops a non-admin from ever seeing the page shell.
  // It is NOT the security boundary — /api/admin and /api/admin/stream check
  // independently, because a proxy can be bypassed but the API cannot.
  if (pathname.startsWith('/admin') && !isAdmin(user)) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
