import { NextRequest, NextResponse } from 'next/server';
import { createSnapshot } from '@/lib/snapshots/create';
import { listSnapshotObjects, deleteObject, deleteImportCsv } from '@/lib/storage/r2';
import { selectTieredSnapshots } from '@/lib/snapshots/retention-tiered';
import { timingSafeEqualString } from '@/lib/utils/timing-safe';
import { runBillingLifecycle } from '@/lib/billing/lifecycle';
import { runMonthlyBillGeneration } from '@/lib/billing/auto-generate';
import { createServiceClient } from '@/lib/supabase/server';
import { mapWithConcurrency, settleWithConcurrency } from '@/lib/concurrency';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';

// These worker-pool helpers moved to src/lib/concurrency.ts so the monthly bill
// generator can reuse them rather than owning a second copy. Re-exported here
// because this module was their original home and existing importers point at it.
export { mapWithConcurrency, settleWithConcurrency } from '@/lib/concurrency';
export type { SettledItem } from '@/lib/concurrency';

// Prune snapshots according to the configured retention schedule.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqualString(provided, `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    let billing = { overdue_updated: 0 };
    let billingError = false;
    try {
      billing = await runBillingLifecycle();
    } catch (err) {
      billingError = true;
      console.error('[cron/snapshot] billing lifecycle failed:', err);
      Sentry.captureException(err, { tags: { cron: 'snapshot', operation: 'billing_lifecycle' } });
    }

    // Monthly bill generation rides this daily cron rather than claiming a third
    // Vercel cron slot (Hobby caps at 2). The 1st-of-month guard lives here, not
    // in runMonthlyBillGeneration, so the generator stays directly testable for
    // any period. Generation is idempotent — it upserts with ignoreDuplicates on
    // (unit_id, period) — so a same-day retry cannot double-bill.
    const today = new Date().toISOString().slice(0, 10);
    const isFirstOfMonth = new Date(`${today}T00:00:00Z`).getUTCDate() === 1;
    let billsGenerated = 0;
    let billGenerationError = false;
    let billGenerationSkipped: string[] = [];
    if (isFirstOfMonth) {
      try {
        const generation = await runMonthlyBillGeneration(today);
        billsGenerated = generation.societies
          .reduce((sum, society) => sum + (society.status === 'generated' ? society.created : 0), 0);
        billGenerationSkipped = generation.societies
          .filter(society => society.status !== 'generated')
          .map(society => society.society_id);
        billGenerationError = generation.societies.some(society => society.status === 'failed');
        if (billGenerationError) {
          Sentry.captureMessage('Snapshot cron monthly bill generation partially failed', {
            level: 'error',
            tags: { cron: 'snapshot', operation: 'monthly_bill_generation' },
            extra: { failed_count: generation.societies.filter(society => society.status === 'failed').length },
          });
        }
      } catch (err) {
        // Same isolation as the billing lifecycle above: unattended bill
        // generation must never cost the society that night's backup.
        billGenerationError = true;
        console.error('[cron/snapshot] monthly bill generation failed:', err);
        Sentry.captureException(err, { tags: { cron: 'snapshot', operation: 'monthly_bill_generation' } });
      }
    }

    const service = await createServiceClient();
    const { data: societies, error: societiesError } = await service
      .from('society_config')
      .select('society_id');
    if (societiesError) throw societiesError;

    const societyIds = (societies ?? []).map(({ society_id }) => society_id);
    const snapshotAttempts = await settleWithConcurrency(societyIds, createSnapshot);
    const snapshots = snapshotAttempts.map(attempt => attempt.ok
      ? { society_id: attempt.item, ok: true as const, ...attempt.value }
      : { society_id: attempt.item, ok: false as const, error: attempt.error });
    for (const snapshot of snapshots) {
      if (!snapshot.ok) console.error(`[cron/snapshot] society ${snapshot.society_id} failed:`, snapshot.error);
    }
    const failedCount = snapshots.filter(snapshot => !snapshot.ok).length;
    if (failedCount > 0) {
      Sentry.captureMessage('Snapshot cron society snapshots partially failed', {
        level: 'error',
        tags: { cron: 'snapshot', operation: 'create_snapshot' },
        extra: { attempted_count: snapshots.length, failed_count: failedCount },
      });
    }

    // Retain seven daily, four weekly and twelve monthly snapshots.
    const pruningEnabled = process.env.SNAPSHOT_TIERED_PRUNING_ENABLED === 'true';
    let pruned = 0;
    let pruneCandidates = 0;
    try {
      const bySociety = await mapWithConcurrency(societyIds, listSnapshotObjects);
      const candidates = bySociety.flatMap(objects => selectTieredSnapshots(objects).prune);
      pruneCandidates = candidates.length;
      if (pruningEnabled) {
        await mapWithConcurrency(candidates, obj => deleteObject(obj.key));
        pruned = candidates.length;
      }
    } catch (pruneErr) {
      // Pruning failure must never fail the day's backup — log and move on.
      console.error('[cron/snapshot] prune failed:', pruneErr);
    }

    // Remove expired staged-import CSV objects.
    let importObjectsCleaned = 0;
    let importObjectDeletionFailures = 0;
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleBatches, error: staleBatchesError } = await service
        .from('society_import_batches')
        .select('object_key, updated_at')
        .lt('updated_at', cutoff)
        .order('updated_at')
        .limit(500);
      if (staleBatchesError) {
        Sentry.captureMessage('Snapshot cron staged import cleanup select failed', {
          level: 'error',
          tags: { cron: 'snapshot', operation: 'staged_import_cleanup_select' },
        });
        console.error('[cron/snapshot] import cleanup select failed');
      }
      await mapWithConcurrency(staleBatches ?? [], async batch => {
        try { await deleteImportCsv(batch.object_key); importObjectsCleaned++; } catch { importObjectDeletionFailures++; }
      });
      if (importObjectDeletionFailures > 0) {
        Sentry.captureMessage('Snapshot cron staged import cleanup deletions failed', {
          level: 'error',
          tags: { cron: 'snapshot', operation: 'staged_import_cleanup_delete' },
          extra: { failed_count: importObjectDeletionFailures },
        });
      }
    } catch (importErr) {
      console.error('[cron/snapshot] import cleanup failed:', importErr);
    }

    // Return an error status when every society snapshot fails.
    const allFailed = snapshots.length > 0 && failedCount === snapshots.length;

    return NextResponse.json({
      ok: !allFailed,
      snapshots,
      societies_attempted: snapshots.length,
      societies_failed: failedCount,
      pruned,
      prune_candidates: pruneCandidates,
      pruning_enabled: pruningEnabled,
      import_objects_cleaned: importObjectsCleaned,
      bills_generated: billsGenerated,
      bill_generation_ran: isFirstOfMonth,
      bill_generation_skipped: billGenerationSkipped,
      bill_generation_error: billGenerationError,
      ...billing,
      billing_error: billingError,
    }, { status: allFailed ? 500 : 200 });
  } catch (err) {
    console.error('[cron/snapshot] failed:', err);
    Sentry.captureException(err, { tags: { cron: 'snapshot', operation: 'run' } });
    return NextResponse.json({ ok: false, error: 'Snapshot failed' }, { status: 500 });
  }
}
