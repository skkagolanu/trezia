import {
  ADMIN_PREFIXES,
  PLATFORM_PREFIXES,
  PROTECTED_PREFIXES,
  RESIDENT_PREFIXES,
  SHARED_PREFIXES,
} from '@/lib/constants/routes';

describe('protected route classifications', () => {
  it('classifies resident and shared surfaces explicitly', () => {
    expect(RESIDENT_PREFIXES).toEqual(expect.arrayContaining(['/my-flat', '/community', '/summary']));
    expect(SHARED_PREFIXES).toEqual(['/notices', '/operations']);
  });

  it('protects every admin, resident, shared, and platform route prefix', () => {
    expect(PROTECTED_PREFIXES).toEqual([
      ...ADMIN_PREFIXES,
      ...RESIDENT_PREFIXES,
      ...SHARED_PREFIXES,
      ...PLATFORM_PREFIXES,
    ]);
  });
});
