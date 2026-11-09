// In-memory sliding-window rate limiter — no external account needed (the
// Module-level Map persists across warm invocations of the same Node.js
// server process; this is a best-effort defence appropriate for this app's
// If the app ever runs multi-instance and needs a hard guarantee, swap the
// store for Upstash Redis behind the same `check()` signature.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: an unbounded Map fed by spoofable IP headers is itself a
// (mild) DoS vector. Evict the oldest entry once the map gets large.
const MAX_BUCKETS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Allow up to `limit` calls per `windowMs` for a given `key` (e.g. `ip:route`).
 * The Map is module-level mutable state — pass `now` explicitly in tests for
 * determinism instead of mocking Date.
 */
export function check(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  const resetAt = existing.windowStart + windowMs;
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt };
}

/** Test-only: clears all buckets so specs don't leak state into each other. */
export function _resetForTests(): void {
  buckets.clear();
}

/** Best-effort caller IP from standard proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
