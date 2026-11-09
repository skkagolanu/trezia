import { timingSafeEqualString } from '@/lib/utils/timing-safe';

describe('timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualString('Bearer abc123', 'Bearer abc123')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqualString('Bearer abc123', 'Bearer xyz789')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(timingSafeEqualString('short', 'a-much-longer-string')).toBe(false);
  });

  it('returns false comparing against an empty string', () => {
    expect(timingSafeEqualString('', 'Bearer abc123')).toBe(false);
  });
});
