import { NextRequest } from 'next/server';
import { demoBridgeDestination, isDemoLifecycleApi, proxy, shouldExitDemoSession } from '@/proxy';
import { DEMO_SOCIETY_SLUG } from '@/lib/demo/session';
import { contentSecurityPolicy } from '@/lib/security/csp';

describe('demo routing bridge', () => {
  it('keeps a legacy-mode demo visit on its unscoped protected path', () => {
    expect(demoBridgeDestination(false, false, '/payments')).toBeNull();
  });

  it('bridges an unscoped protected demo visit only when routed mode is enabled', () => {
    expect(demoBridgeDestination(true, false, '/payments')).toBe(
      `/s/${DEMO_SOCIETY_SLUG}/payments`,
    );
    expect(demoBridgeDestination(true, true, '/payments')).toBeNull();
  });
});

describe('demo isolation boundary', () => {
  it('drops demo state before a real society or authentication route', () => {
    expect(shouldExitDemoSession('/api/s/oak/payments', 'oak')).toBe(true);
    expect(shouldExitDemoSession('/s/oak/my-flat', 'oak')).toBe(true);
    expect(shouldExitDemoSession('/login', null)).toBe(true);
    expect(shouldExitDemoSession('/api/s/demo-apartments/payments', 'demo-apartments')).toBe(false);
  });

  it('allows only the two cookie lifecycle APIs', () => {
    expect(isDemoLifecycleApi('/api/demo/start')).toBe(true);
    expect(isDemoLifecycleApi('/api/demo/end')).toBe(true);
    expect(isDemoLifecycleApi('/api/demo/anything-else')).toBe(false);
    expect(isDemoLifecycleApi('/api/payments')).toBe(false);
  });

  it('rejects a scoped operational API before auth or Supabase is constructed', async () => {
    const request = new NextRequest('http://localhost/api/s/demo-apartments/payments', {
      method: 'GET', headers: { cookie: 'trezia_demo=1' },
    });
    const response = await proxy(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'API access is unavailable in demo mode' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('removes Supabase and telemetry origins from the demo connect policy', () => {
    const policy = contentSecurityPolicy(false, true);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain('supabase.co');
    expect(policy).not.toContain('sentry.io');
  });
});
