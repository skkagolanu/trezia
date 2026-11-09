/**
 * Disaster-recovery drill: proves a daily society snapshot (src/lib/snapshots/
 * create.ts + serialize.ts) can be restored and checked against the captured fingerprint.
 *
 * Two phases in one file, selected by Jest's `-t` name filter (see
 * scripts/restore-snapshot.mjs and the orchestrator that drives this test):
 *   - "capture": seeds a society, builds a real snapshot, writes it + an
 *     `expected.json` fingerprint to REHEARSAL_DIR.
 *   - "verify": runs after an external wipe-and-restore of the same database
 *     from that snapshot, rebuilds the snapshot from the restored rows, and
 *     asserts the content hash and row counts are unchanged.
 *
 * The two phases cannot share in-memory state — the orchestrator resets the
 * database between them — so REHEARSAL_DIR is the only channel between them.
 *
 * DESTRUCTIVE: never point this at a database you care about. It is meant to
 * run only against a disposable local Supabase instance that gets wiped
 * between phases, matching the sibling RLS suite's fail-loudly convention
 * (missing env vars throw, this test never silently skips).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBackupSnapshot } from '@/lib/snapshots/create';
import { serializeSnapshot, snapshotContentHash } from '@/lib/snapshots/serialize';

// buildBackupSnapshot() goes through createServiceClient(), which checks
// request (i.e. here, in Jest) that throws "called outside a request scope"
// the narrowest fix: the actual service-role client construction and every
// DB call stay real, only the irrelevant demo-mode branch is bypassed.
// ts-jest hoists this above the imports above (same pattern proven in
// __tests__/lib/supabase-server.test.ts), so declaration order here doesn't matter.
jest.mock('@/lib/demo/session.server', () => ({ isDemoSession: jest.fn().mockResolvedValue(false) }));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REHEARSAL_DIR = process.env.REHEARSAL_DIR;
const missing = [
  !URL && 'NEXT_PUBLIC_SUPABASE_URL',
  !SERVICE && 'SUPABASE_SERVICE_ROLE_KEY',
  !REHEARSAL_DIR && 'REHEARSAL_DIR',
].filter(Boolean);

const serviceClient = (): SupabaseClient => createClient(URL!, SERVICE!, { auth: { persistSession: false } });
const runId = crypto.randomUUID().slice(0, 8);
const id = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getUTCFullYear();
const currentMonth = new Date().getUTCMonth() + 1;

const snapshotPath = () => join(REHEARSAL_DIR!, 'snapshot.json.gz');
const expectedPath = () => join(REHEARSAL_DIR!, 'expected.json');

interface ExpectedManifest {
  societyId: string;
  contentHash: string;
  rowCounts: Record<string, number>;
}

async function expectSetup<T>(result: { data: T; error: { message: string } | null }, operation: string): Promise<T> {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

// A bare insert legitimately returns null data, so expectSetup cannot reject it.
// This variant is for insert().select(), where absent rows mean the fixture is broken.
async function expectRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  operation: string,
): Promise<T[]> {
  const data = await expectSetup(result, operation);
  if (!data?.length) throw new Error(`${operation}: expected rows, received none`);
  return data;
}

async function createAuthUser(svc: SupabaseClient, label: string): Promise<string> {
  const email = `snapshot-rehearsal-${label}-${runId}-${id()}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: id(), email_confirm: true });
  if (error) throw new Error(`create ${label} auth user: ${error.message}`);
  if (!data.user) throw new Error(`create ${label} auth user returned no user`);
  return data.user.id;
}

async function makeBill(
  svc: SupabaseClient,
  societyId: string,
  unitId: string,
  invoiceSuffix: string,
  monthOffset: number,
): Promise<string> {
  const billId = id();
  const month = ((currentMonth - 1 + monthOffset + 12) % 12) + 1;
  const year = currentYear + Math.floor((currentMonth - 1 + monthOffset) / 12);
  // Insert without cgst_amount/sgst_amount/total_amount/payable_amount —
  // GENERATED ALWAYS columns, Postgres rejects them in an INSERT list.
  await expectSetup(
    await svc.from('bills').insert({
      id: billId,
      society_id: societyId,
      unit_id: unitId,
      bill_period_year: year,
      bill_period_month: month,
      invoice_number: `SNAP-${runId}-${invoiceSuffix}`,
      invoice_date: today,
      due_date: today,
      base_amount: 1500,
      status: 'ISSUED',
    }),
    `create bill ${invoiceSuffix}`,
  );
  return billId;
}


function rowCountsOf(snapshot: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  return counts;
}

describe('snapshot capture', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(
        `Snapshot rehearsal requires: ${missing.join(', ')}. `
        + 'Run only against a disposable local Supabase, never production.',
      );
    }
  });

  it('captures a real production snapshot of a seeded society', async () => {
    const svc = serviceClient();
    const societyId = id();
    const slug = `snap-rehearsal-${runId}`;
    const unitA = id();
    const unitB = id();
    const unitC = id();

    const adminUserId = await createAuthUser(svc, 'admin');
    const residentUserId = await createAuthUser(svc, 'resident');

    await expectSetup(
      await svc.from('societies').insert({ id: societyId, name: `Snapshot Rehearsal ${runId}`, slug }),
      'create society',
    );
    await expectSetup(
      await svc.from('society_config').insert({
        id: id(), society_id: societyId, name: `Snapshot Rehearsal config ${runId}`,
        receipt_prefix: 'REC', next_receipt_no: 1,
      }),
      'create society_config',
    );
    await expectSetup(
      await svc.from('units').insert([
        { id: unitA, society_id: societyId, flat_number: `${runId}-A-101`, is_test_unit: false },
        { id: unitB, society_id: societyId, flat_number: `${runId}-A-102`, is_test_unit: false },
        { id: unitC, society_id: societyId, flat_number: `${runId}-A-103`, is_test_unit: false },
      ]),
      'create units',
    );
    const residents = await expectRows(
      await svc.from('residents').insert([
        { id: id(), society_id: societyId, unit_id: unitA, full_name: `Resident A ${runId}`, occupancy_type: 'OWNER', consent_given: true },
        { id: id(), society_id: societyId, unit_id: unitB, full_name: `Resident B ${runId}`, occupancy_type: 'TENANT', consent_given: true },
        { id: id(), society_id: societyId, unit_id: unitC, full_name: `Resident C ${runId}`, occupancy_type: 'OWNER', consent_given: false },
      ]).select('id, unit_id'),
      'create residents',
    );
    const residentForUnitA = residents.find(r => r.unit_id === unitA)!.id as string;

    await expectSetup(
      await svc.from('levy_configs').insert([
        { id: id(), society_id: societyId, levy_label: 'AMC-2026', default_amount: 2300, is_active_for_new_collections: true },
        { id: id(), society_id: societyId, levy_label: 'CMC-2025', default_amount: 2000, is_active_for_new_collections: false },
      ]),
      'create levy_configs',
    );

    const billOne = await makeBill(svc, societyId, unitA, 'B1', 0);
    const billTwo = await makeBill(svc, societyId, unitB, 'B2', 0);
    const billThree = await makeBill(svc, societyId, unitC, 'B3', -1);
    await makeBill(svc, societyId, unitA, 'B4', -2);
    await makeBill(svc, societyId, unitB, 'B5', -1);

    await expectSetup(
      await svc.from('payments').insert([
        { id: id(), society_id: societyId, unit_id: unitA, resident_id: residentForUnitA, bill_ids: [billOne], amount_paid: 1500, payment_mode: 'UPI', payment_date: today, months_covered: 1, months_detail: 'This month' },
        { id: id(), society_id: societyId, unit_id: unitB, bill_ids: [billTwo], amount_paid: 1500, payment_mode: 'BANK_TRANSFER', payment_date: today, months_covered: 1 },
        { id: id(), society_id: societyId, unit_id: unitC, bill_ids: [billThree], amount_paid: 1500, payment_mode: 'MANUAL_COLLECTION', payment_date: today, months_covered: 1 },
        { id: id(), society_id: societyId, unit_id: unitA, bill_ids: [], amount_paid: 500, payment_mode: 'OTHER', payment_date: today, months_covered: 0, notes: 'Advance / miscellaneous' },
      ]),
      'create payments',
    );

    const expenditures = await expectRows(
      await svc.from('expenditures').insert([
        { id: id(), society_id: societyId, expense_date: today, category: 'ELECTRICITY', description: `Electricity bill ${runId}`, amount: 4200 },
        { id: id(), society_id: societyId, expense_date: today, category: 'WATER_MUNICIPAL', description: `Water bill ${runId}`, amount: 1800 },
        { id: id(), society_id: societyId, expense_date: today, category: 'MISC', description: `Misc expense ${runId}`, amount: 650 },
      ]).select('id'),
      'create expenditures',
    );

    await expectSetup(
      await svc.from('amc_collections').insert([
        { id: id(), society_id: societyId, unit_id: unitA, levy_label: 'AMC-2026', amount_paid: 2300, payment_date: today, payment_mode: 'UPI' },
        { id: id(), society_id: societyId, unit_id: unitB, levy_label: 'AMC-2026', amount_paid: 2300, payment_date: today, payment_mode: 'MANUAL_COLLECTION' },
        { id: id(), society_id: societyId, unit_id: unitC, levy_label: 'CMC-2025', amount_paid: 2000, payment_date: today, payment_mode: 'BANK_TRANSFER' },
      ]),
      'create amc_collections',
    );

    await expectSetup(
      await svc.from('other_income').insert([
        { id: id(), society_id: societyId, income_date: today, category: 'OTHER_INCOME', description: `Hall booking ${runId}`, amount: 1000 },
        { id: id(), society_id: societyId, income_date: today, category: 'PENALTY', description: `Late fee ${runId}`, amount: 200 },
        { id: id(), society_id: societyId, income_date: today, category: 'CORPUS_FUND', description: `Corpus contribution ${runId}`, amount: 5000 },
      ]),
      'create other_income',
    );

    await expectSetup(
      await svc.from('opening_balances').insert({
        id: id(), society_id: societyId, fy_start_year: currentYear, bank_balance: 100000, cash_in_hand: 5000, recorded_by: adminUserId,
      }),
      'create opening_balances',
    );

    await expectSetup(
      await svc.from('fund_ledger_entries').insert([
        { id: id(), society_id: societyId, fund_type: 'CORPUS', entry_type: 'CONTRIBUTION', amount: 5000, entry_date: today },
        { id: id(), society_id: societyId, fund_type: 'SINKING', entry_type: 'INTEREST', amount: 300, entry_date: today },
      ]),
      'create fund_ledger_entries',
    );

    await expectSetup(
      await svc.from('balance_snapshots').insert([
        { id: id(), society_id: societyId, snapshot_date: today, bank_balance: 100000, cash_in_hand: 5000 },
        { id: id(), society_id: societyId, snapshot_date: today, bank_balance: 101000, cash_in_hand: 5200, notes: 'Weekly check' },
      ]),
      'create balance_snapshots',
    );

    await expectSetup(
      // Every row of a bulk insert must carry the SAME keys. PostgREST builds one
      // statement from the union of keys across the array and sends NULL for any a
      // row omits, which bypasses the column DEFAULT — so omitting is_pinned here
      // would violate its NOT NULL rather than default to false.
      await svc.from('society_notices').insert([
        { id: id(), society_id: societyId, title: `Notice One ${runId}`, body: 'Society-wide notice body.', created_by: adminUserId, is_pinned: false },
        { id: id(), society_id: societyId, title: `Notice Two ${runId}`, body: 'A second notice, pinned.', created_by: adminUserId, is_pinned: true },
      ]),
      'create society_notices',
    );

    const vendors = await expectRows(
      await svc.from('vendors').insert([
        { id: id(), society_id: societyId, name: `Elevator Co ${runId}`, service_category: 'Lift maintenance', created_by: adminUserId },
        { id: id(), society_id: societyId, name: `Security Agency ${runId}`, service_category: 'Security', created_by: adminUserId },
      ]).select('id'),
      'create vendors',
    );

    await expectSetup(
      await svc.from('vendor_contracts').insert(
        vendors.map((v, i) => ({
          id: id(), society_id: societyId, vendor_id: v.id as string,
          title: `Contract ${i + 1} ${runId}`, contract_value: 12000, created_by: adminUserId,
        })),
      ),
      'create vendor_contracts',
    );

    await expectSetup(
      await svc.from('society_memberships').insert([
        { id: id(), user_id: adminUserId, society_id: societyId, role: 'admin', status: 'active' },
        { id: id(), user_id: residentUserId, society_id: societyId, role: 'resident', unit_id: unitA, status: 'active' },
      ]),
      'create society_memberships',
    );

    await expectSetup(
      await svc.from('resident_invites').insert([
        { id: id(), society_id: societyId, email: `unclaimed-treasurer-${runId}@example.test`, role: 'treasurer', invited_by: adminUserId },
        { id: id(), society_id: societyId, email: `unclaimed-resident-${runId}@example.test`, role: 'resident', unit_id: unitB, invited_by: adminUserId },
      ]),
      'create resident_invites',
    );

    await expectSetup(
      await svc.from('resident_payment_claims').insert([
        {
          id: id(), society_id: societyId, unit_id: unitB, bill_ids: [billTwo], amount: 1500,
          utr_reference: `UTR-${runId}-1`, paid_on: today, screenshot_object_key: `claims/${societyId}/${unitB}/1.jpg`,
          status: 'pending', submitted_by: residentUserId,
        },
        {
          id: id(), society_id: societyId, unit_id: unitC, bill_ids: [billThree], amount: 1500,
          utr_reference: `UTR-${runId}-2`, paid_on: today, screenshot_object_key: `claims/${societyId}/${unitC}/2.jpg`,
          status: 'rejected', submitted_by: residentUserId, reviewed_by: adminUserId, review_note: 'Amount mismatch',
        },
      ]),
      'create resident_payment_claims',
    );

    // Levy obligations (migration 067). Seeded with a part-settled row so the
    // drill proves amount_settled and status survive a restore — a levy that
    // came back as unowed would silently re-bill every resident who had paid.
    await expectSetup(
      await svc.from('levy_assessments').insert([
        { id: id(), society_id: societyId, unit_id: unitB, levy_label: `AMC-${currentYear}`, amount: 5000, amount_settled: 5000, status: 'PAID' },
        { id: id(), society_id: societyId, unit_id: unitC, levy_label: `AMC-${currentYear}`, amount: 5000, amount_settled: 1500, status: 'PENDING' },
      ]),
      'create levy_assessments',
    );

    // Import provenance (migration 063). Seeded so the drill proves these
    // round-trip with real rows, not merely that the table names resolve — and
    // so the batch→record foreign key exercises TABLE_ORDER, since restore keeps
    // constraints enforced while triggers are suppressed.
    const importBatchId = id();
    await expectSetup(
      await svc.from('society_import_batches').insert({
        id: importBatchId, society_id: societyId, stage: 'payments', status: 'COMMITTED',
        object_key: `imports/${societyId}/${importBatchId}.csv`, sha256: `sha-${runId}`,
        row_count: 3, valid_count: 2, error_count: 1,
        validated_payload_sha256: `payload-${runId}`,
        validation_summary: { totals: { accepted: 2, rejected: 1 } },
        committed_ids: { committed: 2, skipped: 0 },
        created_by: adminUserId,
      }),
      'create society_import_batches',
    );
    await expectSetup(
      await svc.from('society_import_records').insert([
        { id: id(), batch_id: importBatchId, row_number: 3, raw: { flat: 'B-101', amount: '1500' }, status: 'ERROR', errors: { amount: 'not a number' } },
        { id: id(), batch_id: importBatchId, row_number: 4, raw: { flat: 'B-102', amount: '1500' }, status: 'DUPLICATE_SKIP' },
      ]),
      'create society_import_records',
    );

    await expectSetup(
      await svc.from('treasurer_handovers').insert({
        id: id(), society_id: societyId, handover_date: today,
        outgoing_treasurer: `Outgoing Treasurer ${runId}`, incoming_treasurer: `Incoming Treasurer ${runId}`,
        bank_balance: 100000, cash_in_hand: 5000,
      }),
      'create treasurer_handovers',
    );

    // advance_settlements.advance_id has no DB-level FK (migration 027 comment:
    // it can point at either payments or expenditures depending on advance_kind),
    // so any real id from the referenced table keeps the fixture honest without
    // the app-level RPC's own validation applying here.
    await expectSetup(
      await svc.from('advance_settlements').insert({
        id: id(), society_id: societyId, advance_kind: 'EXPENSE', advance_id: expenditures[0].id as string,
        settled_amount: 500, settled_against: `Settled against ${runId} misc expense`, settled_date: today,
      }),
      'create advance_settlements',
    );

    const bankBatchId = id();
    await expectSetup(
      await svc.from('bank_statement_batches').insert({
        id: bankBatchId, society_id: societyId, filename: `statement-${runId}.csv`,
        statement_from: today, statement_to: today, line_count: 1, uploaded_by: adminUserId,
      }),
      'create bank_statement_batches',
    );
    // No society_id here by design (028/030) — scoped only through batch_id.
    await expectSetup(
      await svc.from('bank_statement_lines').insert({
        id: id(), batch_id: bankBatchId, line_date: today, description: `Test deposit ${runId}`, amount: 1500,
      }),
      'create bank_statement_lines',
    );

    // created_by is NOT NULL DEFAULT auth.uid() on every migration-055 table below —
    // the service role has no auth.uid(), so it must be passed explicitly.
    const documentId = id();
    await expectSetup(
      await svc.from('society_documents').insert({
        id: documentId, society_id: societyId, title: `Bylaws ${runId}`, category: 'BYLAWS', created_by: adminUserId,
      }),
      'create society_documents',
    );

    const assetId = id();
    await expectSetup(
      await svc.from('assets').insert({
        id: assetId, society_id: societyId, name: `Lift ${runId}`, category: 'Lift', created_by: adminUserId,
      }),
      'create assets',
    );

    const assetServiceRecordId = id();
    await expectSetup(
      await svc.from('asset_service_records').insert({
        id: assetServiceRecordId, society_id: societyId, asset_id: assetId, service_date: today,
        description: `Annual lift service ${runId}`, created_by: adminUserId,
      }),
      'create asset_service_records',
    );

    // operational_link_exactly_one_parent (migration 055) requires exactly one of
    // vendor_contract_id/asset_id/asset_service_record_id — using the service record here.
    await expectSetup(
      await svc.from('operational_expense_links').insert({
        id: id(), society_id: societyId, expenditure_id: expenditures[0].id as string,
        asset_service_record_id: assetServiceRecordId, created_by: adminUserId,
      }),
      'create operational_expense_links',
    );

    // attachment_exactly_one_parent + attachment_canonical_key (migration 055):
    // object_key must equal attachments/{society_id}/{id} exactly, and sha256
    // must match ^[a-f0-9]{64}$ — two concatenated UUIDs (32 lowercase hex each)
    // satisfy the pattern without a real hashing import.
    const attachmentId = id();
    const fakeSha256 = id().replace(/-/g, '') + id().replace(/-/g, '');
    await expectSetup(
      await svc.from('society_attachments').insert({
        id: attachmentId, society_id: societyId, document_id: documentId,
        filename: `bylaws-${runId}.pdf`, content_type: 'application/pdf', byte_size: 102400,
        sha256: fakeSha256, object_key: `attachments/${societyId}/${attachmentId}`, created_by: adminUserId,
      }),
      'create society_attachments',
    );

    await expectSetup(
      await svc.from('access_requests').insert({
        id: id(), society_id: societyId, email: `access-request-${runId}@example.test`, unit_id: unitB,
      }),
      'create access_requests',
    );

    await expectSetup(
      await svc.from('fy_treasurers').insert({
        id: id(), society_id: societyId, fy_start_year: currentYear, resident_id: residentForUnitA,
      }),
      'create fy_treasurers',
    );

    await expectSetup(
      await svc.from('resident_payment_links').insert({
        id: id(), society_id: societyId, unit_id: unitA, bill_ids: [billOne], amount: 1500,
        razorpay_link_id: `plink_${runId}`, short_url: `https://rzp.io/i/${runId}`, created_by: adminUserId,
      }),
      'create resident_payment_links',
    );

    const snapshot = await buildBackupSnapshot(societyId, { includeAttachmentInventory: false });
    const record = snapshot as unknown as Record<string, unknown>;
    const serialized = serializeSnapshot(record);
    const contentHash = snapshotContentHash(record);
    const rowCounts = rowCountsOf(record);
    const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);

    expect(snapshot.manifest.society_id).toBe(societyId);
    expect(totalRows).toBeGreaterThan(25);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- REHEARSAL_DIR is an operator-supplied env var, not request input.
    if (!existsSync(REHEARSAL_DIR!)) mkdirSync(REHEARSAL_DIR!, { recursive: true });
    const expected: ExpectedManifest = { societyId, contentHash, rowCounts };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- writing under the operator-supplied REHEARSAL_DIR, the file this whole drill exists to produce.
    writeFileSync(snapshotPath(), serialized.gzipped);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same REHEARSAL_DIR justification as above.
    writeFileSync(expectedPath(), JSON.stringify(expected, null, 2));
  }, 120_000);
});

describe('snapshot restore verification', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(
        `Snapshot rehearsal requires: ${missing.join(', ')}. `
        + 'Run only against a disposable local Supabase, never production.',
      );
    }
  });

  it('verifies the restored database reproduces a byte-identical snapshot', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the fingerprint capture stage wrote under the operator-supplied REHEARSAL_DIR.
    if (!existsSync(expectedPath())) {
      throw new Error(`No expected.json in REHEARSAL_DIR (${REHEARSAL_DIR}) — the capture stage did not run first.`);
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same REHEARSAL_DIR justification as above.
    const expected = JSON.parse(readFileSync(expectedPath(), 'utf8')) as ExpectedManifest;

    const restored = await buildBackupSnapshot(expected.societyId, { includeAttachmentInventory: false });
    const record = restored as unknown as Record<string, unknown>;
    const recomputedHash = snapshotContentHash(record);
    const recomputedCounts = rowCountsOf(record);

    const tableNames = new Set([...Object.keys(expected.rowCounts), ...Object.keys(recomputedCounts)]);
    const mismatches: string[] = [];
    for (const table of tableNames) {
      const before = expected.rowCounts[table] ?? 0;
      const after = recomputedCounts[table] ?? 0;
      if (before !== after) mismatches.push(`${table}: expected ${before}, got ${after} (${after - before >= 0 ? '+' : ''}${after - before})`);
    }
    expect(mismatches).toEqual([]);

    // The hash alone only proves "something differs"; the row-count diff above
    // says where. Asserting both means a passing test rules out both a
    // wholesale row loss/gain and a subtler per-row corruption (e.g. an
    // audit/hash trigger firing again on restore and rewriting row_hash).
    expect(recomputedHash).toBe(expected.contentHash);
  }, 120_000);
});
