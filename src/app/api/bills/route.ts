import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { billingDatesForPeriod } from '@/lib/utils/billing';
import { invoiceNumber } from '@/lib/billing/invoice-number';
import { notifySocietyResidents } from '@/lib/notifications/notify';
import { z } from 'zod';

const BillGenerateSingleSchema = z.object({
  unit_id:           z.string().uuid(),
  bill_period_year:  z.number().int().min(2020).max(2099),
  bill_period_month: z.number().int().min(1).max(12),
  base_amount:       z.number().positive().max(500_000),
  previous_due:      z.number().min(0).default(0),
  penalty_amount:    z.number().min(0).default(0),
  cheque_dishonour:  z.number().min(0).default(0),
  cgst_percent:      z.number().min(0).default(0),
  sgst_percent:      z.number().min(0).default(0),
  notes:             z.string().max(500).optional(),
});

const BillGenerateBulkSchema = z.object({
  bill_period_year:  z.number().int().min(2020).max(2099),
  bill_period_month: z.number().int().min(1).max(12),
  base_amount_override: z.number().positive().max(500_000).optional(),
  overrides:         z.record(z.string().uuid(), z.number().positive()).optional(),

  cgst_percent:      z.number().min(0).default(0),
  sgst_percent:      z.number().min(0).default(0),
  previous_due:      z.number().min(0).default(0),
  penalty_amount:    z.number().min(0).default(0),
});

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const supabase = await createClient();

  if (typeof body === 'object' && body !== null && 'bill_period_year' in body && !('unit_id' in body)) {
    const parsed = BillGenerateBulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Check the bill generation details and try again', issues: parsed.error.issues }, { status: 422 });
    }

    const { data: config } = await supabase
      .from('society_config')
      .select('monthly_maintenance_amount, maintenance_payment_window_days')
      .eq('society_id', auth.societyId)
      .single();

    const { bill_period_year, bill_period_month, base_amount_override, overrides } = parsed.data;
    if (config?.monthly_maintenance_amount == null) {
      return NextResponse.json(
        { error: 'Society maintenance amount is not configured — set it in Settings.' },
        { status: 422 },
      );
    }
    if (config.maintenance_payment_window_days == null) {
      return NextResponse.json(
        { error: 'Society maintenance payment window is not configured — set it in Settings.' },
        { status: 422 },
      );
    }
    const defaultAmount = Number(config.monthly_maintenance_amount);

    const { data: units, error: unitsErr } = await supabase
      .from('units')
      .select('id, flat_number')
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number');

    if (unitsErr) {
      console.error(unitsErr);
      return NextResponse.json({ error: 'Bills were not generated. Refresh the preview and try again.' }, { status: 500 });
    }

    const {
      cgst_percent, sgst_percent, previous_due, penalty_amount,
    } = parsed.data;
    const { invoiceDate, dueDate } = billingDatesForPeriod(
      bill_period_year,
      bill_period_month,
      config.maintenance_payment_window_days,
    );

    const insertRows = (units ?? []).map(unit => ({
      unit_id:           unit.id,
      society_id:        auth.societyId,
      bill_period_year,
      bill_period_month,
      invoice_number:    invoiceNumber(unit.flat_number, bill_period_year, bill_period_month),
      invoice_date:      invoiceDate,
      due_date:          dueDate,
      base_amount:       overrides?.[unit.id] ?? base_amount_override ?? defaultAmount,
      cgst_percent,
      sgst_percent,
      previous_due,
      penalty_amount,
      status:            'ISSUED' as const,
    }));

    const { data, error } = await supabase
      .from('bills')
      .upsert(insertRows, { onConflict: 'unit_id,bill_period_year,bill_period_month', ignoreDuplicates: true })
      .select('id, invoice_number, unit_id');

    if (error) {
      console.error(error);
      return NextResponse.json({ error: 'Bills were not generated. Refresh the preview and try again.' }, { status: 500 });
    }

    const created = data?.length ?? 0;
    // One notification per society per run, not one per bill, and nothing
    // when the batch produced no new bills (e.g. a re-submit that hit the
    // ignoreDuplicates conflict for every row). Best-effort — the bills are
    // already committed, so a push failure must not turn this into an error.
    // No amount or flat detail in the payload (PWA privacy rule).
    // requireFinancialOperator's AdminAuthResult carries no slug, so it's
    // fetched here for the notification link only.
    if (created > 0) {
      const { data: society } = await supabase.from('societies').select('slug').eq('id', auth.societyId).single();
      await notifySocietyResidents(auth.societyId, {
        title: 'New bill posted',
        body: 'A new maintenance bill has been posted to your flat.',
        url: society?.slug ? `/s/${society.slug}/my-flat` : '/my-flat',
      }).catch(() => {});
    }

    return NextResponse.json({ created, bills: data }, { status: 201 });
  }

  const parsed = BillGenerateSingleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the bill details and try again', issues: parsed.error.issues }, { status: 422 });
  }

  const { data: unit } = await supabase
    .from('units')
    .select('flat_number')
    .eq('id', parsed.data.unit_id)
    .eq('society_id', auth.societyId)
    .single();

  const { data: config } = await supabase
    .from('society_config')
    .select('maintenance_payment_window_days')
    .eq('society_id', auth.societyId)
    .single();
  if (config?.maintenance_payment_window_days == null) {
    return NextResponse.json(
      { error: 'Society maintenance payment window is not configured — set it in Settings.' },
      { status: 422 },
    );
  }
  const { invoiceDate, dueDate } = billingDatesForPeriod(
    parsed.data.bill_period_year,
    parsed.data.bill_period_month,
    config.maintenance_payment_window_days,
  );
  const { data, error } = await supabase
    .from('bills')
    .upsert({
      unit_id:           parsed.data.unit_id,
      society_id:        auth.societyId,
      bill_period_year:  parsed.data.bill_period_year,
      bill_period_month: parsed.data.bill_period_month,
      invoice_number:    invoiceNumber(unit?.flat_number ?? parsed.data.unit_id.slice(0, 6), parsed.data.bill_period_year, parsed.data.bill_period_month),
      invoice_date:      invoiceDate,
      due_date:          dueDate,
      base_amount:       parsed.data.base_amount,
      previous_due:      parsed.data.previous_due,
      penalty_amount:    parsed.data.penalty_amount,
      cheque_dishonour:  parsed.data.cheque_dishonour,
      cgst_percent:      parsed.data.cgst_percent,
      sgst_percent:      parsed.data.sgst_percent,
      notes:             parsed.data.notes ?? null,
      status:            'ISSUED' as const,
    }, { onConflict: 'unit_id,bill_period_year,bill_period_month' })
    .select()
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'The bill was not generated. Refresh the form and try again.' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const page   = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit  = 50;
  const offset = (page - 1) * limit;

  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from('bills')
    .select('*, units!bills_unit_same_society(flat_number)', { count: 'exact' })
    .order('bill_period_year', { ascending: false })
    .order('bill_period_month', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Bills could not be loaded. Refresh the page before taking action.' }, { status: 500 });
  }

  return NextResponse.json({ data, count, page, limit });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const schema = z.object({
    id:          z.string().uuid(),
    void_reason: z.string().min(10).max(500),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Give a clear void reason and try again', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('bills')
    .update({ is_voided: true, void_reason: parsed.data.void_reason, voided_at: new Date().toISOString(), status: 'CANCELLED' })
    .eq('id', parsed.data.id)
    .eq('society_id', auth.societyId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'The bill was not voided. Refresh its status before trying again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
