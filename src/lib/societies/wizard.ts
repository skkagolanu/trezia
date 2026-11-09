export type UnitDraft = { flat_number: string; flat_area_sqft?: number; monthly_amount?: number };
export type FlatGenerator = {
  floors: number;
  firstFloor: number;
  perFloor: number;
  prefix: string;
  pattern: 'floor-unit' | 'sequential';
};

export function parseUnitDrafts(value: string): UnitDraft[] {
  const rawLines = value.split('\n').map(line => line.trim()).filter(Boolean);
  const lines = rawLines.length === 1 && !rawLines[0].includes('|')
    ? rawLines[0].split(',').map(line => line.trim()).filter(Boolean)
    : rawLines;
  const byFlat = new Map<string, UnitDraft>();
  for (const line of lines) {
    const [flat, area, amount] = line.split('|').map(part => part.trim());
    if (!flat) continue;
    byFlat.set(flat.toLocaleLowerCase('en-IN'), {
      flat_number: flat,
      ...(area && Number.isFinite(Number(area)) ? { flat_area_sqft: Number(area) } : {}),
      ...(amount && Number.isFinite(Number(amount)) ? { monthly_amount: Number(amount) } : {}),
    });
  }
  return [...byFlat.values()];
}

export function normalizeAdminEmails(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map(email => email.trim().toLowerCase()).filter(Boolean))];
}

export function generateFlatNumbers(generator: FlatGenerator): string[] {
  const { floors, firstFloor, perFloor, prefix, pattern } = generator;
  if (![floors, firstFloor, perFloor].every(Number.isInteger)
    || floors < 1 || firstFloor < 0 || perFloor < 1 || floors * perFloor > 2000) {
    throw new Error('Enter a valid non-negative floor range with no more than 2,000 flats');
  }
  return Array.from({ length: floors }, (_, floorIndex) => Array.from({ length: perFloor }, (_, flatIndex) => {
    const floor = firstFloor + floorIndex;
    const number = pattern === 'floor-unit'
      ? `${floor}${String(flatIndex + 1).padStart(2, '0')}`
      : String(floorIndex * perFloor + flatIndex + 1).padStart(3, '0');
    return `${prefix.trim()}${number}`;
  })).flat();
}
