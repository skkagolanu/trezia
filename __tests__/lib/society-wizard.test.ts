import { generateFlatNumbers, normalizeAdminEmails, parseUnitDrafts } from '@/lib/societies/wizard';

describe('society creation wizard helpers', () => {
  it('parses pasted flats and normalizes case-insensitive duplicates', () => {
    expect(parseUnitDrafts('101 | 1200 | 2500\n102\n101 | 1300 | 2600')).toEqual([
      { flat_number: '101', flat_area_sqft: 1300, monthly_amount: 2600 },
      { flat_number: '102' },
    ]);
    expect(parseUnitDrafts('101, 102')).toEqual([{ flat_number: '101' }, { flat_number: '102' }]);
  });

  it('generates floor-unit and sequential numbering deterministically', () => {
    expect(generateFlatNumbers({ floors: 2, firstFloor: 1, perFloor: 2, prefix: 'A-', pattern: 'floor-unit' }))
      .toEqual(['A-101', 'A-102', 'A-201', 'A-202']);
    expect(generateFlatNumbers({ floors: 1, firstFloor: 0, perFloor: 3, prefix: '', pattern: 'sequential' }))
      .toEqual(['001', '002', '003']);
  });

  it('rejects invalid or excessive generation ranges', () => {
    expect(() => generateFlatNumbers({ floors: 1, firstFloor: -1, perFloor: 2, prefix: '', pattern: 'floor-unit' })).toThrow();
    expect(() => generateFlatNumbers({ floors: 50, firstFloor: 1, perFloor: 50, prefix: '', pattern: 'floor-unit' })).toThrow();
  });

  it('normalizes and deduplicates Admin emails', () => {
    expect(normalizeAdminEmails(' ADMIN@example.com,admin@example.com\nsecond@example.com '))
      .toEqual(['admin@example.com', 'second@example.com']);
  });
});
