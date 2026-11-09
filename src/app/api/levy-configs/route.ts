import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { LevyConfigSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('levy_configs')
    .select('id, levy_label, default_amount, created_at, is_active_for_new_collections')
    .eq('is_active_for_new_collections', true)
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'default_amount' in body) {
    (body as Record<string, unknown>).default_amount = Number((body as Record<string, unknown>).default_amount);
  }

  const parsed = LevyConfigSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Validation failed';
    return NextResponse.json({ error: message, issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('levy_configs')
    .insert({ society_id: auth.societyId, levy_label: parsed.data.levy_label, default_amount: parsed.data.default_amount })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'AMC is already configured for that year' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
