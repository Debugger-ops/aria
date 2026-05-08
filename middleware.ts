import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromHeader } from '@/lib/auth';

// Routes that don't require auth
const PUBLIC_PATHS = ['/login', '/register', '/api/auth/login', '/api/auth/register'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public')
  ) {
    return NextResponse.next();
  }

  // Verify JWT from cookie
  const cookieHeader = req.headers.get('cookie');
  const payload = verifyTokenFromHeader(cookieHeader);

  if (!payload) {
    // Redirect to login, preserving the intended destination
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
