const LEGACY_LEVY_LABEL = /^(AMC|CMC)-(?:June-)?(\d{2,4})$/;

/** Preserves free-text levies while presenting every historical annual label as AMC. */
export function canonicalLevyLabel(label: string): string {
  const trimmed = label.trim();
  const match = trimmed.match(LEGACY_LEVY_LABEL);
  if (!match) return trimmed;
  return trimmed.replace(/^CMC-/, 'AMC-');
}

/**
 * Returns the sort year encoded in historical AMC/CMC labels.
 *
 * Free-text labels intentionally have no synthetic year: they are ordered
 * after dated labels by compareLevyLabels instead of being rewritten.
 */
export function levyYear(label: string): number {
  const match = label.match(LEGACY_LEVY_LABEL);
  if (!match) return 0;

  const year = Number.parseInt(match[2], 10);
  return year < 100 ? 2000 + year : year;
}

/** Formats legacy labels for display while preserving configured free text. */
export function labelDisplay(label: string): string {
  const canonical = canonicalLevyLabel(label);
  const match = canonical.match(LEGACY_LEVY_LABEL);
  if (!match) return canonical;

  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return canonical.includes('June') ? `AMC Jun ${year}` : `AMC ${year}`;
}

/** Sorts dated labels newest-first, then free-text labels alphabetically. */
export function compareLevyLabels(a: string, b: string): number {
  const yearDifference = levyYear(b) - levyYear(a);
  if (yearDifference !== 0) return yearDifference;
  return a.localeCompare(b, undefined, { numeric: true });
}
