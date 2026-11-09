import { isTrustedRequestOrigin } from '@/lib/security/same-origin';

describe('isTrustedRequestOrigin', () => {
  const production = {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: 'https://legacy.example.test',
    VERCEL_PROJECT_PRODUCTION_URL: 'app-production.example',
    VERCEL_URL: 'preview-origin.example',
  } as const;

  it('allows only configured production and preview origins', () => {
    expect(isTrustedRequestOrigin('http://localhost:3000', production)).toBe(true);
    expect(isTrustedRequestOrigin('https://legacy.example.test', production)).toBe(true);
    expect(isTrustedRequestOrigin('https://app-production.example', production)).toBe(true);
    expect(isTrustedRequestOrigin('https://preview-origin.example', production)).toBe(true);
    expect(isTrustedRequestOrigin('https://attacker.example', production, 'attacker.example')).toBe(false);
  });

  it('accepts the production deployment configuration that uses the legacy app URL', () => {
    expect(isTrustedRequestOrigin('http://localhost:3000', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      VERCEL_URL: 'trezia-random-deployment.vercel.app',
    })).toBe(true);
  });

  it('does not trust a forwarded or Host header in production', () => {
    expect(isTrustedRequestOrigin('https://attacker.example', production, 'attacker.example')).toBe(false);
  });

  it('allows the request host and standard local hosts outside production', () => {
    const development = { NODE_ENV: 'development' } as const;
    expect(isTrustedRequestOrigin('http://localhost:3000', development)).toBe(true);
    expect(isTrustedRequestOrigin('http://tenant.local:3000', development, 'tenant.local:3000')).toBe(true);
  });

  it('rejects malformed origins', () => {
    expect(isTrustedRequestOrigin('not a url', production)).toBe(false);
  });
});
