import { shouldUploadSentrySourceMaps } from '@/lib/config/sentry-build';

describe('Sentry production source-map configuration', () => {
  test('stays disabled when no upload credentials are configured', () => {
    expect(shouldUploadSentrySourceMaps({ NODE_ENV: 'production' })).toBe(false);
  });

  test('stays disabled outside production even with a partial credential set', () => {
    expect(shouldUploadSentrySourceMaps({ NODE_ENV: 'test', SENTRY_ORG: 'trezia' })).toBe(false);
  });

  test.each([
    { SENTRY_AUTH_TOKEN: 'token' },
    { SENTRY_ORG: 'trezia' },
    { SENTRY_PROJECT: 'web' },
    { SENTRY_AUTH_TOKEN: 'token', SENTRY_ORG: 'trezia' },
    { SENTRY_AUTH_TOKEN: 'token', SENTRY_PROJECT: 'web' },
    { SENTRY_ORG: 'trezia', SENTRY_PROJECT: 'web' },
  ])('rejects an incomplete production credential tuple: %o', partial => {
    expect(() => shouldUploadSentrySourceMaps({ NODE_ENV: 'production', ...partial }))
      .toThrow('complete credential set');
  });

  test('enables upload only for the complete production credential tuple', () => {
    expect(shouldUploadSentrySourceMaps({
      NODE_ENV: 'production',
      SENTRY_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'trezia',
      SENTRY_PROJECT: 'web',
    })).toBe(true);
  });
});
