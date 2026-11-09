import { resolveLegacyTypeRedirect } from '@/app/(app)/payments/legacy-redirect';

describe('resolveLegacyTypeRedirect', () => {
  it('leaves the default and maintenance views on /payments', () => {
    expect(resolveLegacyTypeRedirect({})).toBeNull();
    expect(resolveLegacyTypeRedirect({ type: 'all' })).toBeNull();
    expect(resolveLegacyTypeRedirect({ type: 'maintenance', period: 'all' })).toBeNull();
  });

  it('leaves an unrecognized type value alone rather than guessing a route', () => {
    expect(resolveLegacyTypeRedirect({ type: 'nonsense' })).toBeNull();
  });

  it('redirects type=amc to /payments/levies, preserving other params', () => {
    expect(resolveLegacyTypeRedirect({ type: 'amc', levy: 'AMC-2026', amcStatus: 'pending' }))
      .toBe('/payments/levies?levy=AMC-2026&amcStatus=pending');
  });

  it('redirects type=bills to /payments/bills, preserving filters', () => {
    expect(resolveLegacyTypeRedirect({ type: 'bills', unpaid: '1', flat: '101', page: '2' }))
      .toBe('/payments/bills?unpaid=1&flat=101&page=2');
  });

  it('redirects type=other-income to /payments/other-income', () => {
    expect(resolveLegacyTypeRedirect({ type: 'other-income', period: 'all' }))
      .toBe('/payments/other-income?period=all');
  });

  it('redirects type=attention to /payments/attention and renames acat/apage to cat/page', () => {
    expect(resolveLegacyTypeRedirect({ type: 'attention', acat: 'pending_claims', apage: '3' }))
      .toBe('/payments/attention?cat=pending_claims&page=3');
  });

  it('keeps canonical attention params authoritative while preserving unrelated params', () => {
    expect(resolveLegacyTypeRedirect({
      type: 'attention',
      acat: 'stale_backups', cat: 'pending_claims',
      apage: '9', page: '2',
      period: 'current', source: ['notice', 'bookmark'],
    })).toBe('/payments/attention?cat=pending_claims&page=2&period=current&source=notice&source=bookmark');
  });

  it('redirects a bare type=attention with no query to the plain route', () => {
    expect(resolveLegacyTypeRedirect({ type: 'attention' })).toBe('/payments/attention');
  });

  it('drops undefined values and preserves every value of repeated params', () => {
    expect(resolveLegacyTypeRedirect({ type: 'bills', flat: undefined, status: ['ISSUED', 'PAID'] }))
      .toBe('/payments/bills?status=ISSUED&status=PAID');
  });
});
