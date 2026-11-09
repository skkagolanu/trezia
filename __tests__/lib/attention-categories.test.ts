import {
  ATTENTION_CATEGORIES,
  isAttentionCategoryVisible,
  isBackupStale,
  isContractRenewalDue,
  summarizeAttention,
  visibleAttentionCategories,
} from '@/lib/attention/categories';

describe('visibleAttentionCategories', () => {
  it('gives an admin every category including backups', () => {
    const keys = visibleAttentionCategories('admin').map(c => c.key);
    expect(keys).toEqual(ATTENTION_CATEGORIES.map(c => c.key));
    expect(keys).toContain('stale_backups');
  });

  it('gives a treasurer finance and operations items but not backups', () => {
    const keys = visibleAttentionCategories('treasurer').map(c => c.key);
    expect(keys).toContain('pending_claims');
    expect(keys).toContain('contract_renewals');
    expect(keys).not.toContain('stale_backups');
  });

  it('gives residents and unsupported roles nothing', () => {
    expect(visibleAttentionCategories('resident')).toHaveLength(0);
    expect(visibleAttentionCategories('committee')).toHaveLength(0);
    expect(visibleAttentionCategories(null)).toHaveLength(0);
    expect(visibleAttentionCategories(undefined)).toHaveLength(0);
  });

  it('isAttentionCategoryVisible respects the role gate', () => {
    expect(isAttentionCategoryVisible('treasurer', 'pending_claims')).toBe(true);
    expect(isAttentionCategoryVisible('treasurer', 'stale_backups')).toBe(false);
    expect(isAttentionCategoryVisible('resident', 'pending_claims')).toBe(false);
  });
});

describe('isBackupStale', () => {
  const asOf = new Date('2026-07-23T12:00:00Z');

  it('is stale when the last attempt failed regardless of age', () => {
    expect(isBackupStale('2026-07-23T06:00:00Z', 'FAILED', asOf)).toBe(true);
  });

  it('is stale when no snapshot exists', () => {
    expect(isBackupStale(null, null, asOf)).toBe(true);
  });

  it('is fresh when the last success is within the window', () => {
    expect(isBackupStale('2026-07-22T18:00:00Z', 'UPLOADED', asOf)).toBe(false);
    expect(isBackupStale('2026-07-23T00:00:00Z', 'SKIPPED_UNCHANGED', asOf)).toBe(false);
  });

  it('is stale when the last success is older than the window', () => {
    expect(isBackupStale('2026-07-20T06:00:00Z', 'UPLOADED', asOf)).toBe(true);
  });

  it('treats an unparseable date as stale', () => {
    expect(isBackupStale('not-a-date', 'UPLOADED', asOf)).toBe(true);
  });
});

describe('summarizeAttention', () => {
  it('sums known counts and ignores failures for the total', () => {
    const r = summarizeAttention([
      { key: 'pending_claims', count: 3 },
      { key: 'contract_renewals', count: 2 },
    ]);
    expect(r).toEqual({ total: 5, hasFailure: false });
  });

  it('flags a failed source without treating it as zero', () => {
    const r = summarizeAttention([
      { key: 'pending_claims', count: 4 },
      { key: 'unmatched_bank_lines', count: null },
    ]);
    expect(r.total).toBe(4);
    expect(r.hasFailure).toBe(true);
  });
});

describe('isContractRenewalDue', () => {
  it('includes a contract beyond sixty days when its own notice window has opened', () => {
    expect(isContractRenewalDue('2026-11-01', 120, '2026-07-23')).toBe(true);
  });

  it('excludes a future contract before its notice window opens', () => {
    expect(isContractRenewalDue('2026-11-01', 30, '2026-07-23')).toBe(false);
  });

  it('includes ended contracts and excludes missing dates', () => {
    expect(isContractRenewalDue('2026-07-22', 0, '2026-07-23')).toBe(true);
    expect(isContractRenewalDue(null, 365, '2026-07-23')).toBe(false);
  });
});
