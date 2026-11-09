import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { LevyConfigPatchSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && 'default_amount' in body) {
    (body as Record<string, unknown>).default_amount = Number((body as Record<string, unknown>).default_amount);
  }

  const parsed = LevyConfigPatchSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Validation failed';
    return NextResponse.json({ error: message, issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('levy_configs')
    .update({ default_amount: parsed.data.default_amount })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}
