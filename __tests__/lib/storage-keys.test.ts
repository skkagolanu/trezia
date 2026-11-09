import { billKey, legacyBillKey, legacyReceiptKey, levyReceiptKey, receiptKey, snapshotKey } from '@/lib/storage/r2';

describe('snapshotKey', () => {
  it('isolates each society under its own backup prefix', () => {
    expect(snapshotKey('society-a', '2026-07-16T05-00-00')).toBe(
      'snapshots/society-a/2026-07-16T05-00-00.json'
    );
    expect(snapshotKey('society-b', '2026-07-16T05-00-00')).not.toBe(
      snapshotKey('society-a', '2026-07-16T05-00-00')
    );
  });
});

describe('financial document keys', () => {
  it('prevents collisions between societies with the same human identifier', () => {
    expect(receiptKey('society-a', 'R/42')).toBe('receipts/society-a/R_42.pdf');
    expect(receiptKey('society-a', 'R/42')).not.toBe(receiptKey('society-b', 'R/42'));
    expect(billKey('society-a', 'JUL/101/26')).toBe('bills/society-a/JUL_101_26.pdf');
    expect(levyReceiptKey('society-a', 'collection-1')).toBe('levy-receipts/society-a/collection-1.pdf');
    expect(legacyReceiptKey('R/42')).toBe('receipts/R_42.pdf');
    expect(legacyBillKey('JUL/101/26')).toBe('bills/JUL_101_26.pdf');
  });

  it('keeps private artifact prefixes society-scoped, including claims', () => {
    expect(snapshotKey('society-a', '2026-07-16T05-00-00')).toMatch(/^snapshots\/society-a\//);
  });
});
