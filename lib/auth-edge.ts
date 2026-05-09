import { jwtVerify } from 'jose';

const COOKIE_NAME = 'aria-session';

export async function verifyToken(token: string) {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function verifyTokenFromHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(
    new RegExp(`${COOKIE_NAME}=([^;]+)`)
  );

  if (!match) return null;

  return await verifyToken(match[1]);
}