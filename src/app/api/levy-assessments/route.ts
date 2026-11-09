import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { isWholePaise } from '@/lib/payments/money';
import { LEVY_LABEL_PATTERN } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

const LEVY_LABEL_MESSAGE = 'Choose a valid AMC year.';

const RaiseLevySchema = z.object({
  levy_label: z.string().trim().regex(LEVY_LABEL_PATTERN, LEVY_LABEL_MESSAGE),
  amount: z.number()
    .positive('Amount must be positive')
    .max(1_000_000, 'Amount too large')
    .refine(isWholePaise, 'Amount must use whole paise'),
});

// Raises a configured levy into a per-unit obligation row for every active,
// non-test flat in the caller's society (migration 067's raise_levy_assessment).
// That RPC is service_role-only because it writes across every unit in the
// society regardless of the caller's row-level policies — requireFinancialOperator
// above is what stands in for authorization, and society_id always comes from
export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RaiseLevySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const service = await createServiceClient();
  const { data, error } = await service.rpc('raise_levy_assessment', {
    p_society_id: auth.societyId,
    p_levy_label: parsed.data.levy_label,
    p_amount: parsed.data.amount,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('INVALID_LEVY_ASSESSMENT')) {
      return NextResponse.json({ error: 'Choose an active AMC year and enter a valid positive amount' }, { status: 422 });
    }
    if (message.includes('INVALID_PAISE_AMOUNT')) {
      return NextResponse.json({ error: 'Amount must use whole paise' }, { status: 422 });
    }
    console.error('[levy-assessments] raise failed');
    return NextResponse.json({ error: 'Could not raise the AMC' }, { status: 500 });
  }

  // rpc() on a set-returning function comes back as an array of one row; the
  // hand-written Database type declares Functions loosely, so cast at the boundary.
  const result = (Array.isArray(data) ? data[0] : data) as
    { created_count: number; skipped_count: number; total_units: number } | null;

  return NextResponse.json(result, { status: 201 });
}

const PreviewQuerySchema = z.object({
  levy_label: z.string().trim().regex(LEVY_LABEL_PATTERN, LEVY_LABEL_MESSAGE),
});

// Read-only preview so a treasurer can see how many flats a levy will reach
// nothing here writes, so there is no need for the service role.
export async function GET(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const parsed = PreviewQuerySchema.safeParse({ levy_label: searchParams.get('levy_label') ?? '' });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  const supabase = await createClient();
  const [
    { count: totalUnits, error: unitsError },
    { count: alreadyAssessed, error: assessedError },
  ] = await Promise.all([
    supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .eq('is_test_unit', false),
    supabase
      .from('levy_assessments')
      .select('id', { count: 'exact', head: true })
      .eq('society_id', auth.societyId)
      .eq('levy_label', parsed.data.levy_label)
      .eq('is_voided', false),
  ]);

  if (unitsError || assessedError) {
    console.error('[levy-assessments] preview lookup failed');
    return NextResponse.json({ error: 'Could not load a preview' }, { status: 500 });
  }

  const total = totalUnits ?? 0;
  const already = alreadyAssessed ?? 0;
  return NextResponse.json({ totalUnits: total, alreadyAssessed: already, toCreate: Math.max(0, total - already) });
}
