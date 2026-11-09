import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { z } from 'zod';

const UnitCreateSchema = z.object({
  flat_number:    z.string().min(1).max(20).toUpperCase(),
  flat_area_sqft: z.number().positive().max(10_000).optional(),
  monthly_amount: z.number().min(0).max(500_000, 'Amount too large — check for typos').optional(),
  notes:          z.string().max(300).optional(),
});

const BatchUnitDraftSchema = z.object({
  flat_number:    z.string().trim().min(1).max(20),
  flat_area_sqft: z.number().positive().max(10_000).optional(),
  monthly_amount: z.number().min(0).max(500_000, 'Amount too large — check for typos').optional(),
});

const UnitBatchCreateSchema = z.object({
  units: z.array(BatchUnitDraftSchema).min(1).max(2_000).superRefine((units, ctx) => {
    const seen = new Set<string>();
    units.forEach((unit, index) => {
      const normalized = unit.flat_number.toLocaleLowerCase('en-IN');
      if (seen.has(normalized)) ctx.addIssue({ code: 'custom', path: [index, 'flat_number'], message: 'Duplicate flat number' });
      seen.add(normalized);
    });
  }),
});

const UnitUpdateSchema = z.object({
  id:             z.string().uuid(),
  flat_number:    z.string().min(1).max(20).toUpperCase().optional(),
  flat_area_sqft: z.number().positive().max(10_000).nullable().optional(),
  monthly_amount: z.number().min(0).max(500_000, 'Amount too large — check for typos').nullable().optional(),
  notes:          z.string().max(300).nullable().optional(),
  is_active:      z.boolean().optional(),
});

export async function GET() {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .order('flat_number');

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'units' in (body as Record<string, unknown>)) {
    return handleBatchCreate(body, auth.societyId);
  }

  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if ('flat_area_sqft' in b && b.flat_area_sqft !== '') b.flat_area_sqft = Number(b.flat_area_sqft);
    if ('monthly_amount' in b && b.monthly_amount !== '') b.monthly_amount = Number(b.monthly_amount);
  }

  const parsed = UnitCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('units')
    .select('id')
    .eq('flat_number', parsed.data.flat_number)
    .single();

  if (existing) {
    return Response.json({ error: `Flat ${parsed.data.flat_number} already exists` }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('units')
    .insert({
      society_id:     auth.societyId,
      flat_number:    parsed.data.flat_number,
      flat_area_sqft: parsed.data.flat_area_sqft ?? null,
      monthly_amount: parsed.data.monthly_amount ?? null,
      notes:          parsed.data.notes ?? null,
      is_active:      true,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ data }, { status: 201 });
}

async function handleBatchCreate(body: unknown, societyId: string) {
  const parsed = UnitBatchCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();

  const { data: existingUnits, error: existingError } = await supabase
    .from('units')
    .select('flat_number')
    .eq('society_id', societyId);

  if (existingError) return Response.json({ error: existingError.message }, { status: 500 });

  const existingNormalized = new Set(
    (existingUnits ?? []).map(unit => (unit.flat_number as string).toLocaleLowerCase('en-IN'))
  );

  const skipped: string[] = [];
  const toInsert = parsed.data.units.filter(unit => {
    const normalized = unit.flat_number.toLocaleLowerCase('en-IN');
    if (existingNormalized.has(normalized)) {
      skipped.push(unit.flat_number);
      return false;
    }
    existingNormalized.add(normalized);
    return true;
  });

  if (toInsert.length === 0) {
    return Response.json({ created: 0, skipped }, { status: 200 });
  }

  const { data: inserted, error } = await supabase
    .from('units')
    .insert(toInsert.map(unit => ({
      society_id:     societyId,
      flat_number:    unit.flat_number.toUpperCase(),
      flat_area_sqft: unit.flat_area_sqft ?? null,
      monthly_amount: unit.monthly_amount ?? null,
      notes:          null,
      is_active:      true,
    })))
    .select();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ created: inserted?.length ?? 0, skipped }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if ('flat_area_sqft' in b && b.flat_area_sqft !== '' && b.flat_area_sqft !== null) b.flat_area_sqft = Number(b.flat_area_sqft);
    if ('monthly_amount' in b && b.monthly_amount !== '' && b.monthly_amount !== null) b.monthly_amount = Number(b.monthly_amount);
  }

  const parsed = UnitUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const { id, ...updates } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from('units')
    .update(updates)
    .eq('id', id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
