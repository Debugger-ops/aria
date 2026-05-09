import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromHeader } from '@/lib/auth-edge';

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('aria-session')?.value;

  const user = await verifyTokenFromHeader(
    token ? `aria-session=${token}` : null
  );

  const isPublic =
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/register');

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};