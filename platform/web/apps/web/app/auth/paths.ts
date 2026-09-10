/**
 * The return path after sign-in comes from the URL (`/login?next=/account`), so it is untrusted:
 * only a path on this site is followed. `//evil.example` and absolute URLs would send the user
 * elsewhere with a fresh session.
 */
export function safePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
