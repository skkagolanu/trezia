import { createServiceClient } from '@/lib/supabase/server';
import { listPrivateAttachmentObjects, listSocietyArtifactObjects, uploadGzip, snapshotKeyGz } from '@/lib/storage/r2';
import { serializeSnapshot } from '@/lib/snapshots/serialize';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { buildAttachmentInventory, buildClaimObjectInventory, buildRestorationExpectations, EXPORT_FORMAT, EXPORT_VERSION } from '@/lib/export/manifest';
import type { ResidentPaymentClaim, SocietyAttachment } from '@/types/database';

export type BackupSnapshot = Awaited<ReturnType<typeof buildBackupSnapshot>>;

// Stable ordering and unique tie-breakers keep paginated snapshots deterministic.
export async function buildBackupSnapshot(societyId: string, options: { includeAttachmentInventory?: boolean } = {}) {
  const supabase = await createServiceClient();

  const [payments, expenses, bills, residents, units, levies, snapshots, handovers, config, otherIncome, levyConfigs, levyAssessments, openingBalances, fundEntries, advanceSettlements, bankBatches, notices, documents, vendors, contracts, assets, serviceRecords, expenseLinks, attachments, memberships, invites, accessRequests, fyTreasurers, auditLog, residentPaymentLinks, importBatches, residentPaymentClaims, society] = await Promise.all([
    fetchAll((f, t) => supabase.from('payments').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('expenditures').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('bills').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('residents').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('units').select('*').eq('society_id', societyId).order('flat_number').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('amc_collections').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('balance_snapshots').select('*').eq('society_id', societyId).order('snapshot_date').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('treasurer_handovers').select('*').eq('society_id', societyId).order('handover_date').order('id').range(f, t)),
    supabase.from('society_config').select('*').eq('society_id', societyId).single(),
    fetchAll((f, t) => supabase.from('other_income').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('levy_configs').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    // Migration 067. The per-unit levy obligation — without it a restored
    // society would show every levy as unowed. created_at and id both exist on
    // this table (verified against the migration before writing this ordering:
    // ordering by a column that does not exist makes PostgREST reject the
    // request and throws out of the entire backup).
    fetchAll((f, t) => supabase.from('levy_assessments').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('opening_balances').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('fund_ledger_entries').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('advance_settlements').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('bank_statement_batches').select('*').eq('society_id', societyId).order('uploaded_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('society_notices').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('society_documents').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('vendors').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('vendor_contracts').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('assets').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('asset_service_records').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('operational_expense_links').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('society_attachments').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('society_memberships').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('resident_invites').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('access_requests').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('fy_treasurers').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('audit_log').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    fetchAll((f, t) => supabase.from('resident_payment_links').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    // Import provenance (migration 063). These record which CSV produced which
    // financial rows, so they belong in a tenant backup even though the staged
    // CSV object itself is swept after seven days.
    fetchAll((f, t) => supabase.from('society_import_batches').select('*').eq('society_id', societyId).order('created_at').order('id').range(f, t)),
    // submitted_at, not created_at: migration 059 gave this table a submission
    // timestamp and no created_at. Ordering by a column that does not exist makes
    // PostgREST reject the request, which threw out of the whole snapshot build.
    fetchAll((f, t) => supabase.from('resident_payment_claims').select('*').eq('society_id', societyId).order('submitted_at').order('id').range(f, t)),
    supabase.from('societies').select('*').eq('id', societyId).single(),
  ]);

  if (society.error || !society.data) {
    throw new Error(`Required society record unavailable: ${society.error?.message ?? 'row not found'}`);
  }
  if (config.error || !config.data) {
    throw new Error(`Required society_config record unavailable: ${config.error?.message ?? 'row not found'}`);
  }

  const bankStatementLines = (await Promise.all(bankBatches.map(batch => fetchAll((f, t) => supabase.from('bank_statement_lines').select('*').eq('batch_id', batch.id).order('created_at').order('id').range(f, t))))).flat();
  // society_import_records is keyed by batch_id and carries no society_id, so it
  // is gathered per batch — the same shape as bank_statement_lines above.
  const importRecords = (await Promise.all((importBatches as Array<{ id: string }>).map(batch => fetchAll((f, t) => supabase.from('society_import_records').select('*').eq('batch_id', batch.id).order('created_at').order('id').range(f, t))))).flat();
  const societyObjects = options.includeAttachmentInventory ? await listSocietyArtifactObjects(societyId) : [];
  const attachmentInventory = options.includeAttachmentInventory
    ? buildAttachmentInventory(attachments as SocietyAttachment[], await listPrivateAttachmentObjects(societyId))
    : undefined;
  const objectInventory = options.includeAttachmentInventory
    ? societyObjects.map(object => ({ storage: object.storage, key: object.key, size: object.size, last_modified: object.lastModified?.toISOString() ?? null }))
    : undefined;
  const claimObjectInventory = options.includeAttachmentInventory
    ? buildClaimObjectInventory(
      residentPaymentClaims as ResidentPaymentClaim[],
      societyObjects.filter(object => object.storage === 'PRIVATE_ARTIFACTS' && object.key.startsWith(`claims/${societyId}/`)),
    )
    : undefined;

  return {
    manifest: {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      society_id: societyId,
      includes_private_object_inventory: options.includeAttachmentInventory === true,
      artifact_delivery: options.includeAttachmentInventory ? {
        mode: 'AUTHENTICATED_BATCH_DOWNLOAD',
        bundled_bytes: false,
        single_archive_complete: false,
        inventory_download_plan_complete: society.data?.legacy_storage_layout !== 'unscoped-v1',
        endpoint_template: '/api/export?type=artifact&storage={storage}&key={encoded_key}',
        reason: 'Objects are delivered individually to keep serverless memory and response size bounded on the free tier.',
        limitations: society.data?.legacy_storage_layout === 'unscoped-v1'
          ? ['Legacy unscoped objects cannot be safely attributed to one society; complete the reviewed storage migration before offboarding.']
          : [],
      } : null,
      restoration: buildRestorationExpectations(),
    },
    exported_at:         new Date().toISOString(),
    society:             society.data,
    society_config:      config.data,
    units,
    residents,
    payments,
    expenditures:        expenses,
    bills,
    amc_collections:     levies,
    balance_snapshots:   snapshots,
    treasurer_handovers: handovers,
    other_income: otherIncome,
    levy_configs: levyConfigs,
    levy_assessments: levyAssessments,
    opening_balances: openingBalances,
    fund_ledger_entries: fundEntries,
    advance_settlements: advanceSettlements,
    bank_statement_batches: bankBatches,
    bank_statement_lines: bankStatementLines,
    society_notices: notices,
    society_documents: documents,
    vendors,
    vendor_contracts: contracts,
    assets,
    asset_service_records: serviceRecords,
    operational_expense_links: expenseLinks,
    society_attachments: attachments,
    attachment_inventory: attachmentInventory,
    object_inventory: objectInventory,
    claim_object_inventory: claimObjectInventory,
    society_memberships: memberships,
    resident_invites: invites,
    access_requests: accessRequests,
    fy_treasurers: fyTreasurers,
    audit_log: auditLog,
    resident_payment_links: residentPaymentLinks,
    resident_payment_claims: residentPaymentClaims,
    society_import_batches: importBatches,
    society_import_records: importRecords,
  };
}

// Browser push endpoints and operational usage counters are recreated rather than restored.
const INVENTORY_KEYS = new Set(['attachment_inventory', 'object_inventory', 'claim_object_inventory']);

function countDbRows(snapshot: Record<string, unknown>): number {
  let total = 0;
  for (const [key, value] of Object.entries(snapshot)) {
    if (INVENTORY_KEYS.has(key)) continue;
    if (Array.isArray(value)) total += value.length;
    else if ((key === 'society' || key === 'society_config') && value) total += 1;
  }
  return total;
}

export interface SnapshotResult {
  key: string | null;
  exported_at: string;
  result: 'UPLOADED' | 'SKIPPED_UNCHANGED';
  sha256: string;
  bytes: number;
  ratio: number | null;
  db_row_count: number;
}

// Scheduled + manual snapshots. Stored gzip-compressed with a stable content
// hash so an unchanged society payload skips the upload (still recording a
// successful check), and every run refreshes the society's capacity
export async function createSnapshot(societyId: string): Promise<SnapshotResult> {
  try {
    return await runSnapshot(societyId);
  } catch (err) {

    await recordSnapshotFailure(societyId);
    throw err;
  }
}

// record_society_usage overwrites every column with its EXCLUDED value, so a
// failure write has to carry the prior measurement forward rather than zeroing it.
// Two fields in particular must be preserved:
//
//   last_snapshot_at   — means "when the last SUCCESSFUL snapshot happened".
//                        Stamping now() here would reset isBackupStale()'s age
//                        clock and hide the very outage this is meant to expose.
//   db_row_count etc.  — capacity measurement shown on /societies; zeroing it
//                        would report the society as empty.
//
// Only last_snapshot_result changes. isBackupStale() already treats 'FAILED' as
// stale regardless of age, so flipping that one field is sufficient and honest.
async function recordSnapshotFailure(societyId: string): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const { data: prior } = await supabase
      .from('society_usage_current')
      .select('db_row_count, artifact_bytes, snapshot_bytes, snapshot_count, last_snapshot_at, last_snapshot_ratio, last_snapshot_hash')
      .eq('society_id', societyId)
      .maybeSingle();

    const { error } = await supabase.rpc('record_society_usage', {
      p_society_id: societyId,
      p_db_row_count: prior?.db_row_count ?? 0,
      p_artifact_bytes: prior?.artifact_bytes ?? 0,
      p_snapshot_bytes: prior?.snapshot_bytes ?? 0,
      p_snapshot_count: prior?.snapshot_count ?? 0,
      p_last_snapshot_at: prior?.last_snapshot_at ?? null,
      p_last_snapshot_result: 'FAILED',
      p_last_snapshot_ratio: prior?.last_snapshot_ratio ?? null,
      p_last_snapshot_hash: prior?.last_snapshot_hash ?? null,
    });
    // Error code only, never the message — a PostgREST error can echo row content.
    if (error) console.error('[snapshots/create] failure record failed:', error.code ?? 'unknown');
  } catch (recordErr) {
    // Recording the failure must never mask the original failure.
    console.error('[snapshots/create] failure record threw:', recordErr instanceof Error ? recordErr.name : 'unknown');
  }
}

async function runSnapshot(societyId: string): Promise<SnapshotResult> {
  const supabase = await createServiceClient();
  const snapshot = await buildBackupSnapshot(societyId, { includeAttachmentInventory: true });
  const record = snapshot as unknown as Record<string, unknown>;
  const serialized = serializeSnapshot(record);
  const dbRowCount = countDbRows(record);

  const inventory = (snapshot.object_inventory ?? []) as Array<{ key: string; size: number }>;
  const priorSnapshotObjects = inventory.filter(object => object.key.startsWith('snapshots/'));
  const artifactBytes = inventory
    .filter(object => !object.key.startsWith('snapshots/'))
    .reduce((sum, object) => sum + (object.size ?? 0), 0);
  let snapshotBytes = priorSnapshotObjects.reduce((sum, object) => sum + (object.size ?? 0), 0);
  let snapshotCount = priorSnapshotObjects.length;

  const { data: prior, error: priorError } = await supabase
    .from('society_usage_current')
    .select('last_snapshot_hash, last_snapshot_at, last_snapshot_ratio, last_snapshot_result')
    .eq('society_id', societyId)
    .maybeSingle();
  if (priorError) throw new Error(`Snapshot usage lookup failed: ${priorError.message}`);
  const priorSucceeded = !!prior && (prior.last_snapshot_result === 'UPLOADED' || prior.last_snapshot_result === 'SKIPPED_UNCHANGED');
  const unchanged = priorSucceeded && prior!.last_snapshot_hash === serialized.sha256;

  const timestamp = snapshot.exported_at.replace(/[:.]/g, '-').slice(0, 19);
  let key: string | null = null;
  let result: SnapshotResult['result'];
  let lastSnapshotAt: string;
  let ratio: number | null;

  if (unchanged) {
    result = 'SKIPPED_UNCHANGED';
    lastSnapshotAt = prior!.last_snapshot_at ?? snapshot.exported_at;
    ratio = prior!.last_snapshot_ratio ?? null;
  } else {
    key = snapshotKeyGz(societyId, timestamp);
    await uploadGzip(key, serialized.gzipped);
    result = 'UPLOADED';
    lastSnapshotAt = snapshot.exported_at;
    ratio = serialized.ratio;
    snapshotBytes += serialized.gzippedSize;
    snapshotCount += 1;
  }

  // Measurement is best-effort: a failed usage write must never fail the day's
  // backup (same guarantee as billing/prune failures in the cron).
  const { error: usageError } = await supabase.rpc('record_society_usage', {
    p_society_id: societyId,
    p_db_row_count: dbRowCount,
    p_artifact_bytes: artifactBytes,
    p_snapshot_bytes: snapshotBytes,
    p_snapshot_count: snapshotCount,
    p_last_snapshot_at: lastSnapshotAt,
    p_last_snapshot_result: result,
    p_last_snapshot_ratio: ratio,
    p_last_snapshot_hash: serialized.sha256,
  });
  if (usageError) console.error('[snapshots/create] record_society_usage failed:', usageError);

  return {
    key,
    exported_at: snapshot.exported_at,
    result,
    sha256: serialized.sha256,
    bytes: key ? serialized.gzippedSize : 0,
    ratio,
    db_row_count: dbRowCount,
  };
}
