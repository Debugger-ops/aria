import { getSessionUser, updateUserProfile } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  return Response.json({ user });
}

export async function PATCH(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const body = await req.json();
    const updated = await updateUserProfile(user.id as string, {
      name:     body.name,
      avatar:   body.avatar,
      password: body.password,
    });
    return Response.json({ user: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed.';
    return Response.json({ error: msg }, { status: 400 });
  }
}
