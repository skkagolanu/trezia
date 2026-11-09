import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { PaymentSchema, VoidSchema } from '@/lib/validation/schemas';
import { generateAndStoreReceipt } from '@/lib/pdf/generate-and-store-receipt';
import { findPaymentMonthOverlaps, parseMonthsDetail } from '@/lib/utils/months';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';
import { notifyUnitResidents } from '@/lib/notifications/notify';

export async function POST(req: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check the payment details and try again', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const supabase = await createClient();

  const allowMonthOverlap = typeof body === 'object'
    && body !== null
    && (body as Record<string, unknown>).allow_month_overlap === true;

  const existingPayments = await fetchAll<{
    id: string;
    unit_id: string;
    months_detail: string | null;
    receipt_number: string | null;
    payment_date: string;
    amount_paid: number;
  }>((from, to) => supabase
    .from('payments')
    .select('id, unit_id, months_detail, receipt_number, payment_date, amount_paid')
    .eq('society_id', auth.societyId)
    .eq('unit_id', parsed.data.unit_id)
    .eq('is_voided', false)
    .not('months_detail', 'is', null)
    .order('payment_date', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));

  const candidateId = '__candidate__';
  const conflicts = findPaymentMonthOverlaps([
    ...existingPayments,
    {
      id: candidateId,
      unit_id: parsed.data.unit_id,
      months_detail: parsed.data.months_detail ?? null,
      receipt_number: null,
      payment_date: parsed.data.payment_date,
      amount_paid: parsed.data.amount_paid,
    },
  ])
    .filter(overlap => overlap.payments.some(payment => payment.id === candidateId))
    .map(overlap => ({
      month: overlap.label,
      payments: overlap.payments
        .filter(payment => payment.id !== candidateId)
        .map(payment => ({
          id: payment.id,
          receipt_number: payment.receipt_number,
          payment_date: payment.payment_date,
          amount_paid: payment.amount_paid,
        })),
    }));

  if (conflicts.length > 0 && !allowMonthOverlap) {
    return NextResponse.json({
      code: 'MONTH_OVERLAP',
      error: 'One or more selected months already have an active payment.',
      overlaps: conflicts,
    }, { status: 409 });
  }

  // Migration 030 made payments.society_id NOT NULL but added no default; 035
  // added a DB default, but we set it explicitly from the paying flat's society
  // so inserts succeed regardless of whether that interim default is present.
  // units.society_id is NOT NULL (030), so this is always resolvable.
  const { data: unitRow, error: unitErr } = await supabase
    .from('units')
    .select('society_id')
    .eq('id', parsed.data.unit_id)
    .eq('society_id', auth.societyId)
    .single();
  if (unitErr || !unitRow) {
    return NextResponse.json({ error: 'Unknown flat' }, { status: 422 });
  }

  if ((parsed.data.bill_ids?.length ?? 0) > 0) {
    const { data: selectedBills } = await supabase
      .from('bills').select('id')
      .eq('society_id', auth.societyId)
      .eq('unit_id', parsed.data.unit_id)
      .in('id', parsed.data.bill_ids!);
    if ((selectedBills?.length ?? 0) !== parsed.data.bill_ids!.length) {
      return NextResponse.json({ error: 'One or more bills do not belong to this flat and society' }, { status: 422 });
    }
  }

  const societyId = auth.societyId;
  const recordedBy = await treasurerNameForDate(supabase, societyId, parsed.data.payment_date);

  const insertData = {
    unit_id:        parsed.data.unit_id,
    society_id:     societyId,
    resident_id:    parsed.data.resident_id ?? null,
    amount_paid:    parsed.data.amount_paid,
    payment_mode:   parsed.data.payment_mode,
    payment_date:   parsed.data.payment_date,
    payment_time:   parsed.data.payment_time ?? null,
    utr_reference:  parsed.data.utr_reference ?? null,
    collector_name: parsed.data.collector_name ?? null,
    recorded_by:    recordedBy,
    months_covered: parsed.data.months_covered,
    months_detail:  parsed.data.months_detail ?? null,
    notes:          parsed.data.notes ?? null,
    bill_ids:       parsed.data.bill_ids ?? [],
    // The payment form posts months, never bills (it shows a month grid), and
    // before migration 069 record_manual_payment ignored them entirely — the
    // money was recorded and no bill was ever settled, so the flat's dues never
    // moved. The month labels are parsed here, in the tested pure module, and
    // the RPC resolves them to bills under FOR UPDATE. An empty list leaves the
    // RPC to appropriate oldest-first (Contract Act s.61).
    month_periods:  parseMonthsDetail(parsed.data.months_detail ?? null)
      .map(({ year, month }) => ({ year, month })),
  };

  const service = await createServiceClient();
  const { data: paymentId, error: recordError } = await service.rpc('record_manual_payment', {
    p_society_id: auth.societyId,
    p_actor_id: auth.userId,
    p_payload: insertData,
  });

  if (recordError) {
    const message = recordError.message ?? '';
    if (message.includes('PAYMENT_AMOUNT_MISMATCH')) {
      return NextResponse.json({ error: 'Payment amount must exactly match the selected bills' }, { status: 422 });
    }
    if (message.includes('BILL_NOT_PAYABLE') || message.includes('DUPLICATE_OR_EMPTY_BILL_IDS')) {
      return NextResponse.json({ error: 'One or more selected bills can no longer be paid' }, { status: 409 });
    }
    console.error('[payments] transactional record failed');
    return NextResponse.json({ error: 'The payment was not recorded. Refresh the bills and try again.' }, { status: 500 });
  }
  if (typeof paymentId !== 'string') {
    console.error('[payments] transactional record returned no payment id');
    return NextResponse.json({ error: 'The payment was not recorded. Refresh the bills and try again.' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('payments')
    .select('id, receipt_number, amount_paid, payment_mode, payment_date, is_voided, created_at')
    .eq('id', paymentId)
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'The payment was not recorded. Refresh the bills and try again.' }, { status: 500 });
  }

  let receiptStored = false;
  let whatsappUrl: string | null = null;
  if (data?.id) {
    try {
      const result = await generateAndStoreReceipt(data.id, auth.societyId);
      receiptStored = result.pdfUrl !== null;
      whatsappUrl = result.whatsappUrl;
    } catch {
      // PDF generation failure is non-fatal — payment is already recorded
    }
  }

  // The payment is already committed, so a push failure here must not turn a
  // successful record into an error the treasurer would retry. Push only —
  // the consent-gated email above is unrelated and untouched. No amount,
  // flat number or reference in the payload (PWA privacy rule).
  // requireFinancialOperator's AdminAuthResult carries no slug, so it's
  // fetched here for the notification link only.
  const { data: society } = await supabase.from('societies').select('slug').eq('id', auth.societyId).single();
  await notifyUnitResidents(auth.societyId, [parsed.data.unit_id], {
    title: 'Payment recorded',
    body: 'A payment for your flat has been recorded by the treasurer.',
    url: society?.slug ? `/s/${society.slug}/my-flat` : '/my-flat',
  }).catch(() => {});

  return NextResponse.json({ ...data, receipt_stored: receiptStored, whatsapp_url: whatsappUrl }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Give a clear void reason and try again', issues: parsed.error.issues }, { status: 422 });
  }

  const service = await createServiceClient();
  const { error } = await service.rpc('void_payment_transactional', {
    p_payment_id: parsed.data.id,
    p_society_id: auth.societyId,
    p_actor_id: auth.userId,
    p_reason: parsed.data.void_reason,
  });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'The payment was not voided. Refresh its status before trying again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);
  const offset = Number(searchParams.get('offset') ?? 0);

  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from('payments')
    .select(
      'id, receipt_number, amount_paid, payment_mode, payment_date, is_voided, created_at, units!payments_unit_same_society(flat_number), residents!payments_resident_same_society(full_name)',
      { count: 'exact' }
    )
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Payments could not be loaded. Refresh the page before taking action.' }, { status: 500 });
  }

  return NextResponse.json({ data, count, limit, offset });
}
