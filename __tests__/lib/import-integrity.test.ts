import {
  canonicalImportPayload,
  duplicateOutcome,
  hashImportPayload,
  importNaturalKey,
} from '@/lib/imports/service';

describe('import payload integrity', () => {
  it('produces the same hash regardless of object key insertion order', () => {
    const first = [{ flat_number: 'A-101', monthly_amount: 2500 }];
    const second = [{ monthly_amount: 2500, flat_number: 'A-101' }];
    expect(canonicalImportPayload(first)).toBe(canonicalImportPayload(second));
    expect(hashImportPayload(first)).toBe(hashImportPayload(second));
  });

  it('changes the hash for a subset or modified value', () => {
    const rows = [
      { flat_number: 'A-101', monthly_amount: 2500 },
      { flat_number: 'A-102', monthly_amount: 2500 },
    ];
    expect(hashImportPayload(rows.slice(0, 1))).not.toBe(hashImportPayload(rows));
    expect(hashImportPayload([{ ...rows[0], monthly_amount: 1 }, rows[1]])).not.toBe(hashImportPayload(rows));
  });

  it('uses normalized resident keys and all financial natural-key fields', () => {
    expect(importNaturalKey('residents', { flat_number: 'A-101', full_name: 'Anita RAO' }))
      .toBe(importNaturalKey('residents', { flat_number: 'A-101', full_name: 'anita rao' }));
    expect(importNaturalKey('expenses', { expense_date: '2025-04-01', description: 'Power', amount: 10 }))
      .not.toBe(importNaturalKey('expenses', { expense_date: '2025-04-01', description: 'Power', amount: 11 }));
  });

  it('skips exact nonfinancial duplicates but rejects financial duplicates', () => {
    expect(duplicateOutcome('flats')).toBe('DUPLICATE_SKIP');
    expect(duplicateOutcome('residents')).toBe('DUPLICATE_SKIP');
    expect(duplicateOutcome('levy_configs')).toBe('DUPLICATE_SKIP');
    expect(duplicateOutcome('bills')).toBe('ERROR');
    expect(duplicateOutcome('expenses')).toBe('ERROR');
  });
});
