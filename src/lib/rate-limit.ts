// Tiny in-memory token-bucket-ish rate limiter.
// Used to slow down repeated password guesses on decryption endpoints
// (encrypted backup import / restore). The app is local-only so a single
// per-process map is sufficient — there's exactly one user.

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Allow up to `limit` calls per `windowMs` for the given key. Returns details
 * the caller can use to build a 429 response.
 *
 * Counters are bumped on each call regardless of allowed state, so once you're
 * locked out, hitting the endpoint extends the window — same as bcrypt-style
 * online attack defenses.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const e = buckets.get(key);
  if (!e || now >= e.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  e.count++;
  if (e.count > limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, e.resetAt - now) };
  }
  return { allowed: true, remaining: limit - e.count, retryAfterMs: 0 };
}

/** Reset a bucket — call on a successful decrypt so the window doesn't punish the legit user. */
export function rateLimitReset(key: string): void {
  buckets.delete(key);
}

/** Test-only: clear all buckets. */
export function _resetAllBuckets(): void {
  buckets.clear();
}
