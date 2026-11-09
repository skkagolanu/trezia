import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { AdvanceSettlementSchema, VoidSchema } from '@/lib/validation/schemas';

// Migration 066 added an 8th, optional parameter to create_advance_settlement:
// p_bill_id. Extended locally rather than in the shared schema file, which
// this workstream does not own — AdvanceSettlementSchema itself is unchanged.
const AdvanceSettlementWithBillSchema = AdvanceSettlementSchema.extend({
  bill_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'settled_amount' in body) {
    (body as Record<string, unknown>).settled_amount = Number((body as Record<string, unknown>).settled_amount);
  }

  const parsed = AdvanceSettlementWithBillSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_advance_settlement', {
    p_society_id: auth.societyId,
    p_advance_kind: parsed.data.advance_kind,
    p_advance_id: parsed.data.advance_id,
    p_settled_amount: parsed.data.settled_amount,
    p_settled_against: parsed.data.settled_against,
    p_settled_date: parsed.data.settled_date,
    p_notes: parsed.data.notes ?? null,
    p_bill_id: parsed.data.bill_id ?? null,
  });

  if (error) {
    if (error.message.includes('NOT_AUTHORIZED')) {
      return Response.json({ error: 'Advance not found' }, { status: 404 });
    }
    if (error.message.includes('PAYMENT_ADVANCE_NOT_FOUND')) {
      return Response.json({ error: 'Payment advance not found' }, { status: 404 });
    }
    if (error.message.includes('EXPENSE_ADVANCE_NOT_FOUND')) {
      return Response.json({ error: 'Expense advance not found' }, { status: 404 });
    }
    if (error.message.includes('SETTLEMENT_EXCEEDS_REMAINING')) {
      return Response.json({ error: 'Settlement amount exceeds the remaining advance balance' }, { status: 422 });
    }
    // Migration 066: settling against a bill now pays that bill inside the
    // same transaction, so these guard the bill side of the settlement.
    if (error.message.includes('BILL_NOT_FOUND')) {
      return Response.json({ error: 'Selected bill could not be found' }, { status: 404 });
    }
    if (error.message.includes('BILL_ALREADY_PAID')) {
      return Response.json({ error: 'That bill has already been paid in full' }, { status: 409 });
    }
    if (error.message.includes('BILL_NOT_PAYABLE')) {
      return Response.json({ error: 'That bill is not currently payable' }, { status: 422 });
    }
    if (error.message.includes('BILL_UNIT_MISMATCH')) {
      return Response.json({ error: 'This advance belongs to a different flat than the selected bill' }, { status: 422 });
    }
    if (error.message.includes('SETTLEMENT_EXCEEDS_BILL')) {
      return Response.json({ error: 'Settlement amount exceeds what is still owed on the selected bill' }, { status: 422 });
    }
    if (error.message.includes('EXPENSE_ADVANCE_HAS_NO_BILL')) {
      return Response.json({ error: 'An expense advance cannot be settled against a bill' }, { status: 422 });
    }
    if (error.message.includes('INVALID_SETTLEMENT')) {
      return Response.json({ error: 'Invalid settlement details' }, { status: 422 });
    }
    console.error(error);
    return Response.json({ error: 'Failed to record advance settlement' }, { status: 500 });
  }

  return Response.json({ data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('void_advance_settlement', {
    p_society_id: auth.societyId,
    p_settlement_id: parsed.data.id,
    p_reason: parsed.data.void_reason,
  });

  if (error) {
    if (error.message.includes('NOT_AUTHORIZED') || error.message.includes('SETTLEMENT_NOT_ACTIVE')) {
      return Response.json({ error: 'Settlement not found' }, { status: 404 });
    }
    if (error.message.includes('INVALID_VOID_REASON')) {
      return Response.json({ error: 'Invalid void reason' }, { status: 422 });
    }
    console.error(error);
    return Response.json({ error: 'Failed to void advance settlement' }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function GET() {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('advance_settlements')
    .select('*')
    .eq('is_voided', false)
    .order('settled_date', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data });
}
