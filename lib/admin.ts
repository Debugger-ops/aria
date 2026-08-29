// lib/admin.ts — Who counts as an admin.
//
// Single source of truth, deliberately dependency-free so it can be imported
// from the Node API routes, the Edge proxy, and the unit tests alike.
//
// Access is decided by EMAIL, not by the `role` field on the user document.
// A role column is editable through any code path that can write a user; an
// allowlist held in configuration is not, so privilege can't be escalated by
// a bug in profile update or registration.

/** Used when ADMIN_EMAILS is not set — so a fresh clone or deploy still works. */
const DEFAULT_ADMIN_EMAILS = 'vivek9to5@gmail.com';

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/** The configured allowlist, lowercased and de-duplicated. */
export function adminEmails(): string[] {
  // Bracket access on purpose: Next inlines `process.env.FOO` member access at
  // build time, which would freeze the allowlist to whatever was set when the
  // bundle was built. Bracket access stays a real runtime lookup.
  const raw = process.env['ADMIN_EMAILS'] ?? DEFAULT_ADMIN_EMAILS;
  return [...new Set(raw.split(',').map(normalise).filter(Boolean))];
}

/** True only for an email on the allowlist. Anything else — including a user
 *  whose stored `role` says 'admin' — is denied. */
export function isAdminEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const candidate = normalise(email);
  if (!candidate) return false;
  return adminEmails().includes(candidate);
}

/** Convenience for a session user or JWT payload of unknown shape. Accepts any
 *  record so it works with both the Mongo user document (Node routes) and the
 *  decoded JWT claims (Edge proxy), neither of which shares a type. */
export function isAdmin(user: Record<string, unknown> | null | undefined): boolean {
  return isAdminEmail(user?.['email']);
}
