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

  // ❌ Skip API routes completely
  const isApi = pathname.startsWith('/api');
  if (isApi) return NextResponse.next();

  // 🔐 Unauthenticated → login
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 🔒 Admin-only pages - REMOVED THIS RESTRICTION
  // Now any authenticated user can access /admin
  // if (pathname.startsWith('/admin')) {
  //   const role = (user as Record<string, unknown>)?.role;
  //   if (role !== 'admin') {
  //     const url = req.nextUrl.clone();
  //     url.pathname = '/';
  //     return NextResponse.redirect(url);
  //   }
  // }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};