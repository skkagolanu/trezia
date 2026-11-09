import type { createServiceClient } from '@/lib/supabase/server';
import { createHash } from 'node:crypto';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { parseCsv } from '@/lib/imports/csv';
import { validateStage, type ImportCellValue, type ValidatedRow } from '@/lib/imports/validate';
import { STAGE_DEFS, type ImportStage } from '@/lib/imports/stages';

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type RowOutcome = 'VALID' | 'ERROR' | 'DUPLICATE_SKIP';

export interface ClassifiedRow extends ValidatedRow {
  outcome: RowOutcome;
  raw: Record<string, string>;
}

export interface ImportClassification {
  stage: ImportStage;
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  headerErrors: string[];
  rows: ClassifiedRow[];
  // Cell-valid, non-duplicate rows in original order — exactly what the commit
  // RPC receives.
  committable: Array<Record<string, ImportCellValue>>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalImportPayload(rows: Array<Record<string, ImportCellValue>>): string {
  return JSON.stringify(canonicalize(rows));
}

export function hashImportPayload(rows: Array<Record<string, ImportCellValue>>): string {
  return createHash('sha256').update(canonicalImportPayload(rows), 'utf8').digest('hex');
}

export function importNaturalKey(stage: ImportStage, values: Record<string, ImportCellValue>): string | null {
  const text = (key: string) => String(values[key] ?? '');
  switch (stage) {
    case 'flats': return text('flat_number');
    case 'residents': return `${text('flat_number')}\u0000${text('full_name').toLocaleLowerCase()}`;
    case 'opening_balances': return text('fy_start_year');
    case 'levy_configs': return text('levy_label');
    case 'bills': return text('invoice_number') || null;
    case 'payments': return text('receipt_number') || null;
    case 'levy_collections': return `${text('flat_number')}\u0000${text('levy_label')}\u0000${text('payment_date')}`;
    case 'expenses': return `${text('expense_date')}\u0000${text('description')}\u0000${text('amount')}`;
    case 'other_income': return `${text('income_date')}\u0000${text('description')}\u0000${text('amount')}`;
  }
}

export function duplicateOutcome(stage: ImportStage): Extract<RowOutcome, 'ERROR' | 'DUPLICATE_SKIP'> {
  return stage === 'flats' || stage === 'residents' || stage === 'levy_configs'
    ? 'DUPLICATE_SKIP'
    : 'ERROR';
}

function duplicateMessage(
  stage: ImportStage,
  values: Record<string, ImportCellValue>,
  inFile: boolean,
  resolvedKey: string,
): string {
  const location = inFile ? 'is repeated in this CSV' : 'already exists';
  switch (stage) {
    case 'bills': return `Invoice "${values.invoice_number ?? resolvedKey}" ${location}`;
    case 'payments': return `Receipt "${values.receipt_number ?? resolvedKey}" ${location}`;
    case 'opening_balances': return `Opening balance for FY ${values.fy_start_year} ${location}`;
    default: return `${STAGE_DEFS[stage].naturalKey} ${location}`;
  }
}

function rawOf(header: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((h, i) => { out[h] = cells[i] ?? ''; });
  return out;
}

// DB-backed dry run. Cell validation is pure; this layer resolves society-scoped
// natural keys and existing financial identifiers against live data so the
// preview totals and duplicate classification are accurate before commit. It
// only reads — no write happens until commit.
export async function classifyImport(
  service: ServiceClient,
  societyId: string,
  stage: ImportStage,
  csvText: string,
): Promise<ImportClassification> {
  const parsed = parseCsv(csvText);
  const validation = validateStage(stage, parsed);
  const def = STAGE_DEFS[stage];

  // Load the reference/identifier sets this stage needs.
  const needsFlats = def.columns.some(c => c.key === 'flat_number');
  const flatSet = new Set<string>();
  if (needsFlats) {
    const units = await fetchAll((f, t) => service.from('units').select('flat_number').eq('society_id', societyId).order('flat_number').order('id').range(f, t));
    for (const u of units) flatSet.add(String(u.flat_number));
  }
  const existingInvoices = new Set<string>();
  if (stage === 'bills') {
    const bills = await fetchAll((f, t) => service.from('bills').select('invoice_number').eq('society_id', societyId).order('invoice_number').order('id').range(f, t));
    for (const b of bills) existingInvoices.add(String(b.invoice_number));
  }
  const existingReceipts = new Set<string>();
  if (stage === 'payments') {
    const pays = await fetchAll((f, t) => service.from('payments').select('receipt_number').eq('society_id', societyId).not('receipt_number', 'is', null).order('receipt_number').order('id').range(f, t));
    for (const p of pays) if (p.receipt_number) existingReceipts.add(String(p.receipt_number));
  }
  const existingFy = new Set<number>();
  if (stage === 'opening_balances') {
    const obs = await fetchAll((f, t) => service.from('opening_balances').select('fy_start_year').eq('society_id', societyId).order('fy_start_year').order('id').range(f, t));
    for (const o of obs) existingFy.add(Number(o.fy_start_year));
  }
  const existingLevies = new Set<string>();
  if (stage === 'levy_configs') {
    const lc = await fetchAll((f, t) => service.from('levy_configs').select('levy_label').eq('society_id', societyId).order('levy_label').order('id').range(f, t));
    for (const l of lc) existingLevies.add(String(l.levy_label));
  }

  const existingNaturalKeys = new Set<string>();
  if (stage === 'residents') {
    const residents = await fetchAll((f, t) => service.from('residents')
      .select('id, full_name, units!inner(flat_number, society_id)')
      .eq('units.society_id', societyId).order('id').range(f, t));
    for (const resident of residents) {
      const unit = resident.units as unknown as { flat_number: string };
      existingNaturalKeys.add(`${unit.flat_number}\u0000${String(resident.full_name).toLocaleLowerCase()}`);
    }
  } else if (stage === 'levy_collections') {
    const records = await fetchAll((f, t) => service.from('amc_collections')
      .select('id, levy_label, payment_date, units!inner(flat_number)')
      .eq('society_id', societyId).order('id').range(f, t));
    for (const record of records) {
      const unit = record.units as unknown as { flat_number: string };
      existingNaturalKeys.add(`${unit.flat_number}\u0000${record.levy_label}\u0000${record.payment_date ?? ''}`);
    }
  } else if (stage === 'expenses') {
    const records = await fetchAll((f, t) => service.from('expenditures')
      .select('id, expense_date, description, amount').eq('society_id', societyId).order('id').range(f, t));
    for (const record of records) existingNaturalKeys.add(`${record.expense_date}\u0000${record.description}\u0000${record.amount}`);
  } else if (stage === 'other_income') {
    const records = await fetchAll((f, t) => service.from('other_income')
      .select('id, income_date, description, amount').eq('society_id', societyId).order('id').range(f, t));
    for (const record of records) existingNaturalKeys.add(`${record.income_date}\u0000${record.description}\u0000${record.amount}`);
  }

  const rows: ClassifiedRow[] = [];
  const committable: Array<Record<string, ImportCellValue>> = [];
  let validCount = 0, errorCount = 0, duplicateCount = 0;
  const seenNaturalKeys = new Set<string>();
  const histNumber = (value: string) => Number(value.match(/^HIST-(\d+)$/)?.[1] ?? 0);
  let nextInvoiceHist = Math.max(0, ...[...existingInvoices].map(histNumber));
  let nextReceiptHist = Math.max(0, ...[...existingReceipts].map(histNumber));

  for (const row of validation.rows) {
    const raw = rawOf(parsed.header, parsed.rows[row.rowNumber - 1] ?? []);
    const errors = [...row.errors];
    let outcome: RowOutcome = errors.length > 0 ? 'ERROR' : 'VALID';

    if (outcome === 'VALID') {
      const flat = row.values.flat_number as string | undefined;
      const flatMissing = needsFlats && flat != null && !flatSet.has(flat);

      switch (stage) {
        case 'flats':
          if (flat != null && flatSet.has(flat)) outcome = 'DUPLICATE_SKIP';
          break;
        case 'residents':
        case 'levy_collections':
          if (flatMissing) errors.push({ column: 'flat_number', message: `No flat "${flat}" exists — import Flats first` });
          break;
        case 'bills': {
          if (flatMissing) errors.push({ column: 'flat_number', message: `No flat "${flat}" exists — import Flats first` });
          const inv = (row.values.invoice_number as string | null) ?? null;
          if (inv && existingInvoices.has(inv)) errors.push({ column: 'invoice_number', message: `Invoice "${inv}" already exists` });
          break;
        }
        case 'payments': {
          if (flatMissing) errors.push({ column: 'flat_number', message: `No flat "${flat}" exists — import Flats first` });
          const rec = (row.values.receipt_number as string | null) ?? null;
          if (rec && existingReceipts.has(rec)) errors.push({ column: 'receipt_number', message: `Receipt "${rec}" already exists` });
          const alloc = (row.values.bill_invoice_numbers as string | null) ?? null;
          const unalloc = row.values.unallocated === true;
          if (!alloc && !unalloc) errors.push({ column: 'unallocated', message: 'Set an allocation, or mark unallocated=true to record without a bill' });
          break;
        }
        case 'opening_balances': {
          const fy = row.values.fy_start_year as number | undefined;
          if (fy != null && existingFy.has(fy)) errors.push({ column: 'fy_start_year', message: `Opening balance for FY ${fy} already exists` });
          break;
        }
        case 'levy_configs': {
          const label = row.values.levy_label as string | undefined;
          if (label != null && existingLevies.has(label)) outcome = 'DUPLICATE_SKIP';
          break;
        }
        default:
          break;
      }
      let key = importNaturalKey(stage, row.values);
      if (key === null && stage === 'bills') {
        nextInvoiceHist += 1;
        key = `HIST-${String(nextInvoiceHist).padStart(4, '0')}`;
      } else if (key === null && stage === 'payments') {
        nextReceiptHist += 1;
        key = `HIST-${String(nextReceiptHist).padStart(4, '0')}`;
      }
      if (key !== null) {
        const duplicateInFile = seenNaturalKeys.has(key);
        const duplicateInDatabase = existingNaturalKeys.has(key);
        if (duplicateInFile || duplicateInDatabase) {
          const duplicate = duplicateOutcome(stage);
          if (duplicate === 'DUPLICATE_SKIP') {
            outcome = duplicate;
          } else {
            errors.push({
              column: STAGE_DEFS[stage].naturalKey,
              message: duplicateMessage(stage, row.values, duplicateInFile, key),
            });
          }
        }
        seenNaturalKeys.add(key);
      }
      if (errors.length > 0) outcome = 'ERROR';
    }

    if (outcome === 'VALID') { validCount++; committable.push(row.values); }
    else if (outcome === 'DUPLICATE_SKIP') duplicateCount++;
    else errorCount++;

    rows.push({ ...row, errors, outcome, raw });
  }

  return {
    stage,
    totalRows: validation.rows.length,
    validCount,
    errorCount,
    duplicateCount,
    headerErrors: validation.headerErrors,
    rows,
    committable,
  };
}

// The subset persisted to society_import_records for the errors CSV + provenance.
export function persistableRecords(classification: ImportClassification) {
  return classification.rows
    .filter(r => r.outcome !== 'VALID')
    .map(r => ({
      row_number: r.rowNumber,
      raw: r.raw,
      status: r.outcome,
      errors: r.errors,
    }));
}

export function validationSummary(classification: ImportClassification) {
  return {
    stage: classification.stage,
    total_rows: classification.totalRows,
    valid: classification.validCount,
    duplicates: classification.duplicateCount,
    errors: classification.errorCount,
    header_errors: classification.headerErrors,
  };
}
