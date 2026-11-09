import { createServiceClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { billingDatesForPeriod } from '@/lib/utils/billing';
import { invoiceNumber } from '@/lib/billing/invoice-number';
import { mapWithConcurrency } from '@/lib/concurrency';
import { notifySocietyResidents } from '@/lib/notifications/notify';

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

type ConfigRow = {
  society_id: string;
  monthly_maintenance_amount: number | null;
  maintenance_payment_window_days: number | null;
  societies: { slug: string } | null;
};

type UnitRow = { id: string; flat_number: string };

export type SocietyBillGenerationResult =
  | { society_id: string; status: 'skipped'; reason: string }
  | { society_id: string; status: 'generated'; created: number }
  | { society_id: string; status: 'failed'; error: string };

export type MonthlyBillGenerationSummary = {
  bill_period_year: number;
  bill_period_month: number;
  societies: SocietyBillGenerationResult[];
};

// Called on the 1st of the month by the billing cron (owned by the cron route,
// not this module). Mirrors the manual bulk-generation path in
// src/app/api/bills/route.ts: same active-unit filter, same invoice-number
// format, same single-upsert-per-society write with ignoreDuplicates so a cron
// retry (or overlap with a manual generation) is a no-op rather than a
// collision. A society missing required config is skipped, never thrown —
// one society's problem must not block every other society's bills.
export async function runMonthlyBillGeneration(
  asOn = new Date().toISOString().slice(0, 10),
): Promise<MonthlyBillGenerationSummary> {
  const supabase = await createServiceClient();
  const periodDate = new Date(`${asOn}T00:00:00Z`);
  const billPeriodYear = periodDate.getUTCFullYear();
  const billPeriodMonth = periodDate.getUTCMonth() + 1;

  const { data: configs, error: configError } = await supabase
    .from('society_config')
    .select('society_id, monthly_maintenance_amount, maintenance_payment_window_days, societies!inner(status, slug)')
    .eq('societies.status', 'active');
  if (configError) throw configError;

  // The hand-written Database type's Relationships field isn't a literal FK
  // tuple, so postgrest-js can't statically resolve the societies!inner(...)
  // embed and types it as SelectQueryError. Cast through unknown first (same
  // pattern as src/app/auth/callback/route.ts) rather than lying about the
  // shape directly.
  const societies = await mapWithConcurrency(
    (configs ?? []) as unknown as ConfigRow[],
    config => generateForSociety(supabase, config, billPeriodYear, billPeriodMonth),
  );

  return { bill_period_year: billPeriodYear, bill_period_month: billPeriodMonth, societies };
}

async function generateForSociety(
  supabase: SupabaseServiceClient,
  config: ConfigRow,
  billPeriodYear: number,
  billPeriodMonth: number,
): Promise<SocietyBillGenerationResult> {
  try {
    if (config.monthly_maintenance_amount == null) {
      return {
        society_id: config.society_id,
        status: 'skipped',
        reason: 'monthly_maintenance_amount not configured',
      };
    }
    if (config.maintenance_payment_window_days == null) {
      return {
        society_id: config.society_id,
        status: 'skipped',
        reason: 'maintenance_payment_window_days not configured',
      };
    }

    const units = await fetchAll<UnitRow>((from, to) => supabase
      .from('units')
      .select('id, flat_number')
      .eq('society_id', config.society_id)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));

    if (units.length === 0) {
      return { society_id: config.society_id, status: 'generated', created: 0 };
    }

    const { invoiceDate, dueDate } = billingDatesForPeriod(
      billPeriodYear,
      billPeriodMonth,
      config.maintenance_payment_window_days,
    );
    const baseAmount = Number(config.monthly_maintenance_amount);

    const insertRows = units.map(unit => ({
      unit_id: unit.id,
      society_id: config.society_id,
      bill_period_year: billPeriodYear,
      bill_period_month: billPeriodMonth,
      invoice_number: invoiceNumber(unit.flat_number, billPeriodYear, billPeriodMonth),
      invoice_date: invoiceDate,
      due_date: dueDate,
      base_amount: baseAmount,
      cgst_percent: 0,
      sgst_percent: 0,
      previous_due: 0,
      penalty_amount: 0,
      status: 'ISSUED' as const,
    }));

    // Single batched upsert per society — a cron retry (or overlap with a
    // manual bulk generation for the same period) re-hits the same
    // (unit_id, bill_period_year, bill_period_month) conflict and is silently
    // ignored rather than duplicated or thrown.
    const { data, error } = await supabase
      .from('bills')
      .upsert(insertRows, { onConflict: 'unit_id,bill_period_year,bill_period_month', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;

    const created = data?.length ?? 0;
    // One notification per society per run, not one per bill — and nothing
    // at all when a retry hit the ignoreDuplicates conflict and created
    // nothing new. Best-effort: this must never turn a successful bill run
    // into a 'failed' result. No amount or flat detail in the payload (PWA
    // privacy rule).
    if (created > 0) {
      await notifySocietyResidents(config.society_id, {
        title: 'New bill posted',
        body: 'A new maintenance bill has been posted to your flat.',
        url: config.societies?.slug ? `/s/${config.societies.slug}/my-flat` : '/my-flat',
      }).catch(() => {});
    }

    return { society_id: config.society_id, status: 'generated', created };
  } catch (error) {
    return {
      society_id: config.society_id,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown billing generation error',
    };
  }
}
