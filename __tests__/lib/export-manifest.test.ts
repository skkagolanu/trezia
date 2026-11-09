import { buildClaimObjectInventory, buildRestorationExpectations, EXPORT_VERSION } from '@/lib/export/manifest';

describe('export manifest', () => {
  it('versions the private-artifact format and excludes ephemeral push credentials', () => {
    expect(EXPORT_VERSION).toBe(4);
    const expectations = buildRestorationExpectations();
    expect(expectations.limitations.join(' ')).toContain('push_subscriptions');
    // Every table left out of the snapshot must be declared here, so an absence
    // is always a stated decision rather than something that looks like an
    // oversight to whoever is reading the manifest during a recovery.
    expect(expectations.excluded_data.tables).toEqual([
      'push_subscriptions',
      'usage_counters',
      'society_usage_current',
    ]);
    // society_usage_current is excluded for a specific reason worth pinning:
    // restoring it would carry a stale last_snapshot_at into a fresh database
    // and make it report itself as backed up when it is not.
    expect(expectations.limitations.join(' ')).toContain('last_snapshot_at');
    expect(expectations.excluded_data.reason).toContain('claims/{society}/');
  });
});

describe('claim object inventory', () => {
  it('reports linked, missing, and orphan proof objects without deleting them', () => {
    const claims = [
      { id: 'claim-1', screenshot_object_key: 'claims/society-1/linked.png' },
      { id: 'claim-2', screenshot_object_key: 'claims/society-1/missing.png' },
    ] as Parameters<typeof buildClaimObjectInventory>[0];
    const result = buildClaimObjectInventory(claims, [
      { key: 'claims/society-1/linked.png', size: 10 },
      { key: 'claims/society-1/orphan.png', size: 20 },
    ]);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim_id: 'claim-1', status: 'LINKED' }),
      expect.objectContaining({ claim_id: 'claim-2', status: 'MISSING' }),
      expect.objectContaining({ object_key: 'claims/society-1/orphan.png', status: 'ORPHAN' }),
    ]));
  });
});
