import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

const UnitQuery = z.string().uuid().optional();

export async function GET(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const parsedUnitId = UnitQuery.safeParse(request.nextUrl.searchParams.get('unit_id') ?? undefined);
  if (!parsedUnitId.success) {
    return Response.json({ error: 'Invalid flat' }, { status: 422 });
  }

  const supabase = await createClient();
  const unitId = parsedUnitId.data;

  if (!unitId) {
    const [unitsResult, leviesResult] = await Promise.all([
      supabase
        .from('units')
        .select('id, flat_number')
        .eq('society_id', auth.societyId)
        .eq('is_active', true)
        .order('flat_number'),
      supabase
        .from('levy_configs')
        .select('levy_label')
        .eq('society_id', auth.societyId)
        .eq('is_active_for_new_collections', true)
        .order('created_at', { ascending: false }),
    ]);
    const error = unitsResult.error ?? leviesResult.error;
    if (error) return Response.json({ error: 'Could not load payment form options' }, { status: 500 });

    return Response.json({
      units: unitsResult.data ?? [],
      levy_labels: (leviesResult.data ?? []).map((row) => row.levy_label),
    });
  }

  const { data: unit, error: unitError } = await supabase
    .from('units')
    .select('id')
    .eq('id', unitId)
    .eq('society_id', auth.societyId)
    .eq('is_active', true)
    .maybeSingle();
  if (unitError) return Response.json({ error: 'Could not load flat details' }, { status: 500 });
  if (!unit) return Response.json({ error: 'Flat not found' }, { status: 404 });

  const [residentResult, collectionsResult] = await Promise.all([
    supabase
      .from('residents')
      .select('id, full_name, phone')
      .eq('society_id', auth.societyId)
      .eq('unit_id', unitId)
      .eq('is_primary', true)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('amc_collections')
      .select('levy_label, amount_paid')
      .eq('society_id', auth.societyId)
      .eq('unit_id', unitId)
      .eq('is_voided', false),
  ]);
  const detailError = residentResult.error ?? collectionsResult.error;
  if (detailError) return Response.json({ error: 'Could not load flat details' }, { status: 500 });

  const paidByLevy: Record<string, number> = {};
  for (const row of collectionsResult.data ?? []) {
    paidByLevy[row.levy_label] = (paidByLevy[row.levy_label] ?? 0) + row.amount_paid;
  }

  return Response.json({ resident: residentResult.data, paid_by_levy: paidByLevy });
}
