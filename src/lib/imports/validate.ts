import type { ParsedCsv } from '@/lib/imports/csv';
import { STAGE_DEFS, type ImportStage, type StageColumn } from '@/lib/imports/stages';

export type ImportCellValue = string | number | boolean | null;

export interface CellError {
  column: string;
  message: string;
}

export interface ValidatedRow {
  // 1-based data row index (the header is not counted).
  rowNumber: number;
  values: Record<string, ImportCellValue>;
  errors: CellError[];
}

export interface StageValidation {
  headerErrors: string[];
  rows: ValidatedRow[];
  validCount: number;
  errorCount: number;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '']);

// Accept the canonical ISO form the templates use, plus the DD/MM/YYYY and
// DD-MM-YYYY a non-technical treasurer's spreadsheet commonly exports. Returns a
// normalized YYYY-MM-DD string or null when the value is not a real date.
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function coerceCell(column: StageColumn, raw: string): { value: ImportCellValue; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    if (column.required) return { value: null, error: 'Required value is missing' };
    return { value: null, error: null };
  }
  switch (column.type) {
    case 'text':
      return { value: trimmed, error: null };
    case 'number': {
      const num = Number(trimmed.replace(/,/g, ''));
      if (!Number.isFinite(num)) return { value: null, error: `"${trimmed}" is not a valid number` };
      if (num < 0) return { value: null, error: 'Negative amounts are not allowed' };
      return { value: num, error: null };
    }
    case 'integer': {
      const num = Number(trimmed.replace(/,/g, ''));
      if (!Number.isInteger(num)) return { value: null, error: `"${trimmed}" is not a whole number` };
      // The only bounded integer in any stage is the bill month.
      if (column.key === 'bill_period_month' && (num < 1 || num > 12)) return { value: null, error: 'Month must be between 1 and 12' };
      if (column.key === 'bill_period_year' && (num < 2000 || num > 2100)) return { value: null, error: 'Year is out of range' };
      if (column.key === 'fy_start_year' && (num < 2000 || num > 2100)) return { value: null, error: 'Year is out of range' };
      return { value: num, error: null };
    }
    case 'date': {
      const iso = parseDate(trimmed);
      if (!iso) return { value: null, error: `"${trimmed}" is not a valid date (use YYYY-MM-DD)` };
      return { value: iso, error: null };
    }
    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (TRUE_WORDS.has(lower)) return { value: true, error: null };
      if (FALSE_WORDS.has(lower)) return { value: false, error: null };
      return { value: null, error: `"${trimmed}" is not true/false` };
    }
    case 'enum': {
      const match = column.enumValues?.find(v => v.toLowerCase() === trimmed.toLowerCase());
      if (!match) return { value: null, error: `"${trimmed}" is not one of: ${column.enumValues?.join(', ')}` };
      return { value: match, error: null };
    }
  }
}

// Pure cell-level validation against a stage's column contract. Detects duplicate
// headers, missing required columns, and per-cell type/enum/date/number errors.
// Relationship resolution (flat_number → unit) and duplicate/financial-identifier
// classification happen later against the live database, transactionally at commit.
export function validateStage(stage: ImportStage, parsed: ParsedCsv): StageValidation {
  const def = STAGE_DEFS[stage];
  const headerErrors: string[] = [];

  const seen = new Set<string>();
  for (const h of parsed.header) {
    if (seen.has(h)) headerErrors.push(`Duplicate column: "${h}"`);
    seen.add(h);
  }
  for (const col of def.columns) {
    if (col.required && !parsed.header.includes(col.key)) {
      headerErrors.push(`Missing required column: "${col.key}"`);
    }
  }

  const indexOf = new Map(parsed.header.map((h, i) => [h, i] as const));
  const rows: ValidatedRow[] = [];
  let validCount = 0;
  let errorCount = 0;

  for (let r = 0; r < parsed.rows.length; r++) {
    const raw = parsed.rows[r];
    const values: Record<string, ImportCellValue> = {};
    const errors: CellError[] = [];
    for (const col of def.columns) {
      const idx = indexOf.get(col.key);
      const cell = idx === undefined ? '' : (raw[idx] ?? '');
      const { value, error } = coerceCell(col, cell);
      if (error) errors.push({ column: col.key, message: error });
      else values[col.key] = value;
    }
    if (errors.length > 0) errorCount++; else validCount++;
    rows.push({ rowNumber: r + 1, values, errors });
  }

  return { headerErrors, rows, validCount, errorCount };
}
