import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import type { SocietyNotice } from '@/types/database';
import { NoticePatchSchema } from '@/lib/validation/schemas';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Notice not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = NoticePatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const update: Partial<Pick<SocietyNotice, 'title' | 'body' | 'published_at' | 'expires_at' | 'archived_at' | 'category' | 'audience' | 'is_pinned'>> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.body !== undefined) update.body = parsed.data.body;
  if (parsed.data.published_at !== undefined) update.published_at = parsed.data.published_at;
  if (parsed.data.expires_at !== undefined) update.expires_at = parsed.data.expires_at;
  if (parsed.data.category !== undefined) update.category = parsed.data.category;
  if (parsed.data.audience !== undefined) update.audience = parsed.data.audience;
  if (parsed.data.is_pinned !== undefined) update.is_pinned = parsed.data.is_pinned;
  if (parsed.data.archive) update.archived_at = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('society_notices')
    .update(update)
    .eq('id', id)
    .eq('society_id', auth.societyId)
    .select('id, title, body, category, audience, is_pinned, published_at, expires_at, archived_at, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[notices] update failed');
    return Response.json({ error: 'Failed to update notice' }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'Notice not found' }, { status: 404 });

  return Response.json({ data });
}
