import { createServiceClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { overdueBillUpdate } from '@/lib/utils/billing';
import { notifyUnitResidents } from '@/lib/notifications/notify';
import type { BillStatus } from '@/types/database';

type ConfigRow = {
  society_id: string;
  penalty_rate_percent: number | null;
  societies: { slug: string } | null;
};
type DueBillRow = {
  id: string;
  society_id: string;
  status: BillStatus;
  due_date: string;
  base_amount: number;
  penalty_amount: number;
};

export async function runBillingLifecycle(asOn = new Date().toISOString().slice(0, 10)) {
  const supabase = await createServiceClient();
  const { data: configs, error: configError } = await supabase
    .from('society_config')
    .select('society_id, penalty_rate_percent, societies!inner(status, slug)')
    .eq('societies.status', 'active');
  if (configError) throw configError;

  // The hand-written Database type's Relationships field isn't a literal FK
  // tuple, so postgrest-js can't statically resolve the societies!inner(...)
  // embed and types it as SelectQueryError. Cast through unknown first (same
  // pattern as src/app/auth/callback/route.ts) rather than lying about the
  // shape directly.
  const configRows = (configs ?? []) as unknown as ConfigRow[];
  const rates = new Map(configRows.map(config => [
    config.society_id,
    Number(config.penalty_rate_percent ?? 0),
  ]));
  const slugBySociety = new Map(configRows.map(config => [
    config.society_id,
    config.societies?.slug ?? null,
  ]));

  const { data: realUnits, error: unitsError } = await supabase
    .from('units')
    .select('id')
    .eq('is_test_unit', false);
  if (unitsError) throw unitsError;
  const realUnitIds = new Set((realUnits ?? []).map(unit => unit.id));

  const bills = await fetchAll<DueBillRow>((from, to) => supabase
    .from('bills')
    .select('id, society_id, unit_id, status, due_date, base_amount, penalty_amount')
    .eq('status', 'ISSUED')
    .eq('is_voided', false)
    .lt('due_date', asOn)
    .order('due_date', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)) as Array<DueBillRow & { unit_id: string }>;

  // Bills can compute different penalties (manual penalty already set vs. a
  // freshly computed automaticPenalty, or different rates per society), so a
  // single blanket UPDATE isn't possible. Instead group bills that resolve to
  // an identical update payload and issue one UPDATE per distinct payload —
  // still N-query-bound by the number of *distinct outcomes*, not the number
  // of bills, which collapses the common case (one society, one rate, mostly
  // matching base amounts) to a handful of round trips instead of one per bill.
  const groups = new Map<string, { change: { status: 'OVERDUE'; penalty_amount: number }; ids: string[] }>();
  for (const bill of bills) {
    if (!rates.has(bill.society_id)) continue;
    if (!realUnitIds.has(bill.unit_id)) continue;
    const change = overdueBillUpdate({
      status: bill.status,
      due_date: bill.due_date,
      base_amount: Number(bill.base_amount),
      penalty_amount: Number(bill.penalty_amount),
    }, rates.get(bill.society_id)!, asOn);
    if (!change) continue;

    const key = JSON.stringify(change);
    const group = groups.get(key);
    if (group) {
      group.ids.push(bill.id);
    } else {
      groups.set(key, { change, ids: [bill.id] });
    }
  }

  const billById = new Map(bills.map(bill => [bill.id, bill]));

  let updated = 0;
  // Populated from the rows the UPDATE below actually touched — not from the
  // intended `ids` — so a bill that lost the race (paid/voided between the
  // SELECT and this UPDATE, and therefore left untouched) never triggers an
  // "overdue" notification for a bill that isn't really overdue.
  const overdueUnitsBySociety = new Map<string, Set<string>>();
  for (const { change, ids } of groups.values()) {
    // Same guard as the previous per-row UPDATE: a bill that was paid or
    // voided between the SELECT above and this UPDATE is left untouched
    // rather than clobbered.
    const { data: updatedRows, error } = await supabase
      .from('bills')
      .update(change)
      .in('id', ids)
      .eq('status', 'ISSUED')
      .eq('is_voided', false)
      .select('id');
    if (error) throw error;
    updated += ids.length;

    for (const row of (updatedRows ?? []) as Array<{ id: string }>) {
      const bill = billById.get(row.id);
      if (!bill) continue;
      const units = overdueUnitsBySociety.get(bill.society_id) ?? new Set<string>();
      units.add(bill.unit_id);
      overdueUnitsBySociety.set(bill.society_id, units);
    }
  }

  // Best-effort — a notification failure must never fail the nightly billing
  // lifecycle (and the backup that follows it in the same cron run). One
  // notification per unit per run regardless of how many of that unit's
  // bills went overdue: notifyUnitResidents dedupes by resident user id.
  // No amount, flat number or bill reference in the payload (PWA privacy rule).
  try {
    for (const [societyId, unitIds] of overdueUnitsBySociety) {
      const slug = slugBySociety.get(societyId) ?? null;
      await notifyUnitResidents(societyId, [...unitIds], {
        title: 'Bill overdue',
        body: 'A bill for your flat is now overdue.',
        url: slug ? `/s/${slug}/my-flat` : '/my-flat',
      });
    }
  } catch (err) {
    console.error('[billing-lifecycle] overdue notification failed:', err);
  }

  return { overdue_updated: updated };
}
