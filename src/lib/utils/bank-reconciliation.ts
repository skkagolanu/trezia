// Pure logic behind the bank reconciliation worklist. Two pieces:
// parsing a bank CSV export into rows, and suggesting candidate matches
// against existing financial records by amount + date proximity. Deliberately
// simple — amount must match exactly (bank statements don't round differently
// than what was recorded) and date within a small window (the bank may clear
// a transaction a day or two after the treasurer recorded it); no fuzzy
// description matching, since bank narration text is too inconsistent across
// banks to be a reliable signal without real sample data to tune against.

export interface BankStatementRow {
  date: string;      // ISO YYYY-MM-DD
  description: string;
  /** Positive = credit (money in), negative = debit (money out). */
  amount: number;
}

export interface ParseResult {
  rows: BankStatementRow[];
  /** 1-indexed line numbers (including the header) that couldn't be parsed. */
  skippedLines: number[];
}

function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  // YYYY-MM-DD (already ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY (the common Indian bank export format)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Parses a bank CSV export. Expects a header row with columns matched
 * case-insensitively: `date`, `description` (or `narration`), and either a
 * single signed `amount` column, or separate `debit`/`credit` columns (a
 * credit is positive, a debit is negated).
 */
export function parseBankStatementCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { rows: [], skippedLines: [] };

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const dateIdx = header.findIndex(h => h === 'date');
  const descIdx = header.findIndex(h => h === 'description' || h === 'narration');
  const amountIdx = header.findIndex(h => h === 'amount');
  const debitIdx = header.findIndex(h => h === 'debit');
  const creditIdx = header.findIndex(h => h === 'credit');

  const rows: BankStatementRow[] = [];
  const skippedLines: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const lineNo = i + 1;

    const date = dateIdx >= 0 ? toIsoDate(cols[dateIdx] ?? '') : null;
    const description = descIdx >= 0 ? (cols[descIdx] ?? '') : '';

    let amount: number | null = null;
    if (amountIdx >= 0) {
      const v = Number(cols[amountIdx]);
      if (!Number.isNaN(v)) amount = v;
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = Number(cols[debitIdx] ?? '0') || 0;
      const credit = Number(cols[creditIdx] ?? '0') || 0;
      amount = credit - debit;
    }

    if (!date || !description || amount === null || amount === 0) {
      skippedLines.push(lineNo);
      continue;
    }

    rows.push({ date, description, amount });
  }

  return { rows, skippedLines };
}

export interface MatchCandidate {
  table: 'payments' | 'amc_collections' | 'other_income' | 'expenditures';
  id: string;
  date: string;
  amount: number;
  label: string;
}

/**
 * Ranks candidates for a bank line by date proximity, filtered to an exact
 * amount match (in absolute value — sign is direction, not part of the
 * match) within `windowDays` of the line's date. Closest date first.
 */
export function findCandidateMatches(
  line: BankStatementRow,
  candidates: MatchCandidate[],
  windowDays = 3,
): MatchCandidate[] {
  const lineTime = new Date(line.date + 'T00:00:00').getTime();
  const target = Math.abs(line.amount);

  // One pass building one array, then one sort. The previous filter → map →
  // filter → sort → map chain allocated five arrays over every candidate for
  // every statement line, and parsed a Date for candidates the amount test was
  // about to discard. Reconciliation runs this per line across a whole
  // statement, so the constant factor is the whole cost of the screen.
  const ranked: Array<{ candidate: MatchCandidate; diffDays: number }> = [];
  for (const candidate of candidates) {
    if (Math.abs(candidate.amount - target) >= 0.005) continue;
    const diffDays = Math.abs(
      (new Date(candidate.date + 'T00:00:00').getTime() - lineTime) / 86_400_000,
    );
    if (diffDays > windowDays) continue;
    ranked.push({ candidate, diffDays });
  }

  return ranked
    .sort((a, b) => a.diffDays - b.diffDays)
    .map(({ candidate }) => candidate);
}
