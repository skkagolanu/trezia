import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fy_treasurers')
    .select('id, fy_start_year, resident_id')
    .order('fy_start_year', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Upsert one FY's treasurer (the resident who holds the role that year).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as { fy_start_year?: unknown; resident_id?: unknown };
  const fyStartYear = Number(b.fy_start_year);
  const residentId = typeof b.resident_id === 'string' ? b.resident_id : '';

  if (!Number.isInteger(fyStartYear) || fyStartYear < 2000 || fyStartYear > 2100) {
    return NextResponse.json({ error: 'Invalid financial year' }, { status: 422 });
  }
  if (!residentId) {
    return NextResponse.json({ error: 'Select a resident' }, { status: 422 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc('set_fy_treasurer_and_backfill', {
      p_society_id: auth.societyId,
      p_fy_start_year: fyStartYear,
      p_resident_id: residentId,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
