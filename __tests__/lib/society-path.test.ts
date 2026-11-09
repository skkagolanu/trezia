import { currentSocietySlug, societyApiPath, societyPath } from '@/lib/society-path';

describe('society paths', () => {
  it('keeps operational page context explicit', () => {
    expect(societyPath('oak', '/payments?period=fy')).toBe('/s/oak/payments?period=fy');
    expect(currentSocietySlug('/s/green-heights/reports')).toBe('green-heights');
  });

  it('maps operational APIs into the same society without double-prefixing', () => {
    expect(societyApiPath('/s/oak/payments', '/api/payments')).toBe('/api/s/oak/payments');
    expect(societyApiPath('/s/oak/payments', '/api/s/oak/payments')).toBe('/api/s/oak/payments');
    expect(societyApiPath('/societies', '/api/platform/societies')).toBe('/api/platform/societies');
  });
});
