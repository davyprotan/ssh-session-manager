import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit, rateLimitReset, _resetAllBuckets } from './rate-limit';

beforeEach(() => {
  _resetAllBuckets();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit', () => {
  it('allows up to limit calls within the window', () => {
    for (let i = 0; i < 5; i++) {
      const r = rateLimit('k', 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const r = rateLimit('k', 5, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets when the window passes', () => {
    for (let i = 0; i < 5; i++) rateLimit('k', 5, 60_000);
    expect(rateLimit('k', 5, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimit('k', 5, 60_000).allowed).toBe(true);
  });

  it('extends the lockout when more attempts come in (online attack defense)', () => {
    for (let i = 0; i < 6; i++) rateLimit('k', 5, 60_000); // 1 over
    vi.advanceTimersByTime(30_000);
    const r = rateLimit('k', 5, 60_000); // still locked out
    expect(r.allowed).toBe(false);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 60_000);
    expect(rateLimit('a', 5, 60_000).allowed).toBe(false);
    expect(rateLimit('b', 5, 60_000).allowed).toBe(true);
  });

  it('rateLimitReset clears the bucket', () => {
    for (let i = 0; i < 5; i++) rateLimit('k', 5, 60_000);
    expect(rateLimit('k', 5, 60_000).allowed).toBe(false);
    rateLimitReset('k');
    expect(rateLimit('k', 5, 60_000).allowed).toBe(true);
  });
});
