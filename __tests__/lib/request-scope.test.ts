import { classifyApiRequest, parseScopedPage, resolveBridgeRedirect } from '@/lib/request-scope';

describe('classifyApiRequest', () => {
  it.each([
    ['GET', '/api/societies'],
    ['POST', '/api/access-requests'],
    ['GET', '/api/demo/start'],
    ['POST', '/api/cron/snapshot'],
  ])('classifies %s %s as public-routing scope', (method, path) => {
    expect(classifyApiRequest(method, path)).toEqual({ kind: 'public' });
  });

  it.each([
    ['GET', '/api/me/societies'],
    ['GET', '/api/platform/societies'],
    ['POST', '/api/platform/societies/abc/suspend'],
  ])('classifies %s %s as control plane', (method, path) => {
    expect(classifyApiRequest(method, path)).toEqual({ kind: 'control-plane' });
  });

  it('extracts an explicit operational society scope', () => {
    expect(classifyApiRequest('PATCH', '/api/s/demo-apartments/access-requests/request-1')).toEqual({
      kind: 'scoped-operational',
      slug: 'demo-apartments',
      logicalPath: '/api/access-requests/request-1',
    });
  });

  it.each([
    ['POST', '/api/societies'],
    ['GET', '/api/access-requests'],
    ['PATCH', '/api/access-requests/request-1'],
    ['POST', '/api/payments'],
    ['GET', '/api/s/demo-apartments'],
  ])('rejects legacy or malformed operational request %s %s', (method, path) => {
    expect(classifyApiRequest(method, path)).toEqual({ kind: 'legacy-operational' });
  });

  it('does not treat non-API pages as APIs', () => {
    expect(classifyApiRequest('GET', '/payments')).toEqual({ kind: 'not-api' });
  });
});

describe('parseScopedPage', () => {
  it('defaults a society root to payments', () => {
    expect(parseScopedPage('/s/demo-apartments')).toEqual({ slug: 'demo-apartments', logicalPath: '/payments' });
  });

  it('preserves the logical page path', () => {
    expect(parseScopedPage('/s/demo-apartments/reports')).toEqual({ slug: 'demo-apartments', logicalPath: '/reports' });
  });

  it('rejects unscoped pages', () => {
    expect(parseScopedPage('/reports')).toBeNull();
  });
});

describe('resolveBridgeRedirect', () => {
  it('splices the slug from a scoped destination onto the requested page', () => {
    expect(resolveBridgeRedirect('/s/oak/my-flat', '/my-flat')).toBe('/s/oak/my-flat');
    expect(resolveBridgeRedirect('/s/demo-apartments/payments', '/payments?type=amc')).toBe('/s/demo-apartments/payments?type=amc');
  });

  it('passes control destinations through unchanged', () => {
    expect(resolveBridgeRedirect('/societies', '/my-flat')).toBe('/societies');
    expect(resolveBridgeRedirect('/access-denied', '/payments')).toBe('/access-denied');
  });

  it('never guesses a slug for a bare legacy destination — the /s/undefined regression', () => {
    expect(resolveBridgeRedirect('/my-flat', '/my-flat')).toBe('/my-flat');
    expect(resolveBridgeRedirect('/payments', '/payments')).not.toContain('undefined');
  });
});
