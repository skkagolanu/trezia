// Minimal RFC-4180 CSV reader for society imports. Handles quoted fields,
// embedded commas/newlines, escaped double-quotes ("") and CRLF/LF line endings.
// Returns raw string cells; type coercion and validation are the caller's job.
// Deliberately dependency-free — the import path must not pull a parser into the
// bundle, and the input is bounded (2 MiB / 5,000 rows) before it reaches here.

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export function parseCsv(input: string): ParsedCsv {
  // Strip a UTF-8 BOM a spreadsheet export commonly prepends.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let quoteClosed = false;
  let i = 0;
  const n = text.length;

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; quoteClosed = true; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (quoteClosed) {
      if (ch === ',') { endField(); quoteClosed = false; i += 1; continue; }
      if (ch === '\r' || ch === '\n') {
        endRecord(); quoteClosed = false;
        if (ch === '\r' && text[i + 1] === '\n') i += 2; else i += 1;
        continue;
      }
      throw new CsvParseError(`Unexpected character after closing quote at position ${i + 1}`);
    }
    if (ch === '"') {
      if (field.length > 0) throw new CsvParseError(`Quote in unquoted field at position ${i + 1}`);
      inQuotes = true; i += 1; continue;
    }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && text[i + 1] === '\n') i += 2; else i += 1;
      continue;
    }
    field += ch; i += 1;
  }
  if (inQuotes) throw new CsvParseError('Unterminated quoted field at end of CSV');
  // Flush the trailing field/record unless the input ended on a newline.
  if (field.length > 0 || record.length > 0 || quoteClosed) endRecord();

  const nonEmpty = records.filter(r => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { header: [], rows: [] };
  const [header, ...rows] = nonEmpty;
  return { header: header.map(h => h.trim()), rows };
}

// Quote a single cell for template/error-CSV output.
function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function toCsv(
  header: string[],
  rows: string[][],
  options: { neutralizeFormulas?: boolean } = {},
): string {
  const lines = [header.map(value => quoteCell(options.neutralizeFormulas ? neutralizeSpreadsheetFormula(value) : value)).join(',')];
  for (const row of rows) {
    lines.push(row.map(value => quoteCell(options.neutralizeFormulas ? neutralizeSpreadsheetFormula(value) : value)).join(','));
  }
  return lines.join('\r\n');
}
