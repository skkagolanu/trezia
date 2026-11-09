import { canonicalLevyLabel, compareLevyLabels, labelDisplay, levyYear } from '@/lib/utils/levy-label';

describe('levy labels', () => {
  it.each([
    ['AMC-2026', 'AMC 2026', 2026],
    ['CMC-June-26', 'AMC Jun 2026', 2026],
    ['AMC-99', 'AMC 2099', 2099],
  ])('formats the legacy label %s without changing its stored value', (label, display, year) => {
    expect(labelDisplay(label)).toBe(display);
    expect(levyYear(label)).toBe(year);
  });

  it('aliases a historical CMC year to AMC without mutating free-text levies', () => {
    expect(canonicalLevyLabel('CMC-2025')).toBe('AMC-2025');
    expect(canonicalLevyLabel('Lift CMC overhaul')).toBe('Lift CMC overhaul');
  });

  it('passes a configured free-text label through unchanged', () => {
    expect(labelDisplay('Lift repair fund')).toBe('Lift repair fund');
    expect(levyYear('Lift repair fund')).toBe(0);
  });

  it('sorts dated labels newest-first then free-text labels predictably', () => {
    const labels = ['Water tank', 'AMC-2025', 'Lift repair fund', 'CMC-June-26'];

    expect(labels.sort(compareLevyLabels)).toEqual([
      'CMC-June-26',
      'AMC-2025',
      'Lift repair fund',
      'Water tank',
    ]);
  });
});
