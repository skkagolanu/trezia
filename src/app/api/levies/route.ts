import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { LevySchema } from '@/lib/validation/schemas';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';
import { generateAndStoreLevyReceipt } from '@/lib/pdf/generate-and-store-levy-receipt';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'amount_paid' in body) {
    (body as Record<string, unknown>).amount_paid = Number((body as Record<string, unknown>).amount_paid);
  }

  const parsed = LevySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();

  // Resolve tenant ownership from the selected flat instead of relying on the
  // database default. Migration 030 made amc_collections.society_id NOT NULL.
  const { data: unit, error: unitError } = await supabase
    .from('units')
    .select('id, society_id')
    .eq('id', parsed.data.unit_id)
    .eq('society_id', auth.societyId)
    .single();
  if (unitError || !unit?.society_id) {
    return NextResponse.json({ error: 'Unknown flat' }, { status: 422 });
  }

  if (parsed.data.resident_id) {
    const { data: resident, error: residentError } = await supabase
      .from('residents')
      .select('id')
      .eq('id', parsed.data.resident_id)
      .eq('society_id', auth.societyId)
      .eq('unit_id', unit.id)
      .maybeSingle();
    if (residentError || !resident) {
      return NextResponse.json({ error: 'Resident does not belong to the selected flat' }, { status: 422 });
    }
  }

  const recordedBy = await treasurerNameForDate(
    supabase,
    auth.societyId,
    parsed.data.payment_date ?? new Date().toISOString().slice(0, 10),
  );

  // Migration 067: record_levy_collection replaces a direct table insert so
  // the write also applies to the matching levy_assessments row (if one
  // exists) under the same per-unit advisory lock the resident levy-claim
  // path takes. Without that shared lock this direct-entry path and a
  // resident's claim approval for the same flat could both credit the same
  // assessment past its amount.
  const { data, error } = await supabase.rpc('record_levy_collection', {
    p_society_id:   auth.societyId,
    p_unit_id:      parsed.data.unit_id,
    p_resident_id:  parsed.data.resident_id ?? null,
    p_levy_label:   parsed.data.levy_label,
    p_amount_paid:  parsed.data.amount_paid,
    p_payment_date: parsed.data.payment_date ?? null,
    p_payment_mode: parsed.data.payment_mode,
    p_notes:        parsed.data.notes ?? null,
    p_recorded_by:  recordedBy,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('INVALID_LEVY_COLLECTION')) {
      return NextResponse.json({ error: 'Enter a valid AMC payment' }, { status: 422 });
    }
    if (message.includes('LEVY_ALREADY_SETTLED')) {
      return NextResponse.json({ error: 'This AMC is already paid' }, { status: 409 });
    }
    if (message.includes('LEVY_LABEL_INACTIVE')) {
      return NextResponse.json({ error: 'Choose an active AMC year' }, { status: 409 });
    }
    if (message.includes('COLLECTION_EXCEEDS_ASSESSMENT')) {
      return NextResponse.json({ error: 'Payment exceeds the outstanding AMC amount' }, { status: 409 });
    }
    console.error('[levies] record failed');
    return NextResponse.json({ error: 'Failed to record AMC payment' }, { status: 500 });
  }

  // The hand-written Database type declares Functions loosely, so an rpc()
  // result is untyped — cast at the boundary rather than widening that type.
  const collection = data as { id?: string } | null;
  if (collection?.id) {
    try { await generateAndStoreLevyReceipt(collection.id, auth.societyId); } catch { /* non-fatal */ }
  }

  return NextResponse.json(data, { status: 201 });
}
