import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromHeader } from '@/lib/auth-edge';

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('aria-session')?.value;

  const user = await verifyTokenFromHeader(
    token ? `aria-session=${token}` : null
  );

  const { pathname } = req.nextUrl;

  // ✅ Public routes (no auth needed)
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register');

  // ❌ IMPORTANT: Skip API routes completely
  const isApi = pathname.startsWith('/api');

  if (isApi) {
    return NextResponse.next();
  }

  // 🔐 Protect only non-public pages
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};