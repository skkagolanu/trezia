import { timingSafeEqual } from 'crypto';

// A plain `!==` comparison on a bearer secret leaks timing information an
// attacker could use to guess it byte-by-byte. Both cron routes are reachable
// IS the auth), so this is the one place in the app where that matters.
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
