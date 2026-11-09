import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { LevyPatchSchema } from '@/lib/validation/schemas';
import { treasurerNameForDate } from '@/lib/treasurer/for-date';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'amount_paid' in body) {
    (body as Record<string, unknown>).amount_paid = Number((body as Record<string, unknown>).amount_paid);
  }

  const parsed = LevyPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const updatePayload: {
    amount_paid: number;
    payment_date: string | null;
    notes: string | null;
    payment_mode?: string;
    recorded_by?: string | null;
  } = {
    amount_paid:  parsed.data.amount_paid,
    payment_date: parsed.data.payment_date ?? null,
    notes:        parsed.data.notes ?? null,
  };
  if (parsed.data.payment_mode) updatePayload.payment_mode = parsed.data.payment_mode;

  const supabase = await createClient();
  if (parsed.data.payment_date) {
    updatePayload.recorded_by = await treasurerNameForDate(
      supabase,
      auth.societyId,
      parsed.data.payment_date,
    );
  }
  const { data, error } = await supabase.rpc('update_levy_collection_transactional', {
    p_society_id: auth.societyId,
    p_collection_id: id,
    p_amount_paid: updatePayload.amount_paid,
    p_payment_date: updatePayload.payment_date,
    p_payment_mode: updatePayload.payment_mode ?? null,
    p_notes: updatePayload.notes,
    p_recorded_by: updatePayload.recorded_by ?? null,
  });

  if (error) {
    if (error.message.includes('NOT_AUTHORIZED') || error.message.includes('LEVY_COLLECTION_NOT_FOUND')) {
      return NextResponse.json({ error: 'AMC payment not found' }, { status: 404 });
    }
    if (error.message.includes('COLLECTION_EXCEEDS_ASSESSMENT')) {
      return NextResponse.json({ error: 'Payment exceeds the outstanding AMC amount' }, { status: 409 });
    }
    if (error.message.includes('LEVY_BALANCE_CONFLICT')) {
      return NextResponse.json({ error: 'That edit conflicts with later allocations on this AMC' }, { status: 409 });
    }
    if (error.message.includes('INVALID_LEVY_COLLECTION')) {
      return NextResponse.json({ error: 'Enter valid AMC payment details' }, { status: 422 });
    }
    return NextResponse.json({ error: 'Failed to update AMC payment' }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;

  // Soft void — hard deletes are blocked by DB trigger (migration 011).
  // void_reason defaults to 'Deleted by treasurer' if caller omits it.
  let void_reason = 'Deleted by treasurer';
  try {
    const body = await request.json() as { void_reason?: string };
    if (body.void_reason && body.void_reason.trim().length >= 10) {
      void_reason = body.void_reason.trim();
    }
  } catch {
    // no body is fine — use default reason
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('void_levy_collection_transactional', {
    p_society_id: auth.societyId,
    p_collection_id: id,
    p_reason: void_reason,
  });

  if (error) {
    if (error.message.includes('NOT_AUTHORIZED') || error.message.includes('LEVY_COLLECTION_NOT_FOUND')) {
      return NextResponse.json({ error: 'AMC payment not found' }, { status: 404 });
    }
    if (error.message.includes('INVALID_VOID_REASON')) {
      return NextResponse.json({ error: 'Please give a clear reason (at least 10 characters)' }, { status: 422 });
    }
    return NextResponse.json({ error: 'Failed to void AMC payment' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
