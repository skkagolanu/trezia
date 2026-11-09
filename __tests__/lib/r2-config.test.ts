import { r2Endpoint, r2JurisdictionEndpoint } from '@/lib/storage/r2-config';

describe('r2Endpoint', () => {
  it('uses the account endpoint for an unrestricted bucket', () => {
    expect(r2Endpoint({ R2_ACCOUNT_ID: 'abc123' })).toBe(
      'https://abc123.r2.cloudflarestorage.com',
    );
  });

  it.each(['eu', 'us', 'fedramp'] as const)(
    'uses the required %s jurisdiction endpoint',
    jurisdiction => {
      expect(r2Endpoint({ R2_ACCOUNT_ID: 'abc123', R2_JURISDICTION: jurisdiction })).toBe(
        `https://abc123.${jurisdiction}.r2.cloudflarestorage.com`,
      );
    },
  );

  it('rejects malformed account ids and unsupported jurisdictions', () => {
    expect(() => r2Endpoint({ R2_ACCOUNT_ID: 'https://attacker.example' })).toThrow(
      'R2_ACCOUNT_ID is not configured correctly',
    );
    expect(() => r2Endpoint({ R2_ACCOUNT_ID: 'abc123', R2_JURISDICTION: 'apac' })).toThrow(
      'R2_JURISDICTION must be eu, fedramp, or us',
    );
  });
});

describe('separate R2 jurisdictions', () => {
  it('builds independent legacy and private endpoints', () => {
    expect(r2JurisdictionEndpoint('abc123', 'us', 'R2_LEGACY_JURISDICTION')).toContain('.us.');
    expect(r2JurisdictionEndpoint('abc123', 'eu', 'R2_PRIVATE_JURISDICTION')).toContain('.eu.');
  });

  it('names the invalid variable', () => {
    expect(() => r2JurisdictionEndpoint('abc123', 'apac', 'R2_PRIVATE_JURISDICTION'))
      .toThrow('R2_PRIVATE_JURISDICTION must be eu, fedramp, or us');
  });
});
