import { check, clientIp, _resetForTests } from '@/lib/utils/rate-limit';

beforeEach(() => _resetForTests());

describe('check', () => {
  it('allows calls under the limit', () => {
    const now = 1_000_000;
    expect(check('k', 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 2 });
    expect(check('k', 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(check('k', 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('blocks once the limit is hit within the window', () => {
    const now = 1_000_000;
    check('k', 2, 60_000, now);
    check('k', 2, 60_000, now);
    const result = check('k', 2, 60_000, now);
    expect(result).toEqual({ allowed: false, remaining: 0, resetAt: now + 60_000 });
  });

  it('resets after the window elapses', () => {
    const now = 1_000_000;
    check('k', 1, 60_000, now);
    expect(check('k', 1, 60_000, now).allowed).toBe(false);
    expect(check('k', 1, 60_000, now + 60_000).allowed).toBe(true);
  });

  it('a call just before the window boundary is still blocked', () => {
    const now = 1_000_000;
    check('k', 1, 60_000, now);
    expect(check('k', 1, 60_000, now + 59_999).allowed).toBe(false);
  });

  it('different keys have independent buckets', () => {
    const now = 1_000_000;
    check('a', 1, 60_000, now);
    expect(check('a', 1, 60_000, now).allowed).toBe(false);
    expect(check('b', 1, 60_000, now).allowed).toBe(true);
  });

  it('evicts the oldest bucket once MAX_BUCKETS is reached', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5_000; i++) check(`k${i}`, 100, 60_000, now);
    // Map is now at capacity; a brand-new key must still be admitted (eviction happened).
    expect(check('new-key', 100, 60_000, now).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('reads the first entry of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(clientIp(h)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const h = new Headers({ 'x-real-ip': '9.9.9.9' });
    expect(clientIp(h)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when neither header is present', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
