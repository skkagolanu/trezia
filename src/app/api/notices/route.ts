import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, requireFinancialOperator } from '@/lib/supabase/require-auth';
import { NoticeCreateSchema } from '@/lib/validation/schemas';
import { notifySocietyResidents } from '@/lib/notifications/notify';
import { societyPath } from '@/lib/society-path';

export async function GET(request?: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;
  if (!['admin', 'treasurer', 'resident'].includes(auth.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = request ? new URL(request.url) : null;
  const page = Math.max(1, Number.parseInt(url?.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url?.searchParams.get('limit') ?? '25', 10) || 25));
  const supabase = await createClient();
  let query = supabase
    .from('society_notices')
    .select('id, title, body, category, audience, is_pinned, published_at, expires_at, archived_at, created_at, updated_at')
    .eq('society_id', auth.societyId)
    .order('is_pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (auth.role === 'resident') {
    const now = new Date().toISOString();
    query = query
      .not('published_at', 'is', null)
      .is('archived_at', null)
      .in('audience', ['ALL_MEMBERS', 'RESIDENTS'])
      .or(`expires_at.is.null,expires_at.gt.${now}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[notices] list failed');
    return Response.json({ error: 'Failed to load notices' }, { status: 500 });
  }

  return Response.json({ notices: data, page, limit });
}

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = NoticeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('society_notices')
    .insert({
      society_id: auth.societyId,
      title: parsed.data.title,
      body: parsed.data.body,
      published_at: parsed.data.published_at ?? new Date().toISOString(),
      expires_at: parsed.data.expires_at ?? null,
      category: parsed.data.category,
      audience: parsed.data.audience,
      is_pinned: parsed.data.is_pinned,
      created_by: auth.userId,
    })
    .select('id, title, body, category, audience, is_pinned, published_at, expires_at, archived_at, created_at, updated_at')
    .single();

  if (error) {
    console.error('[notices] create failed');
    return Response.json({ error: 'Failed to create notice' }, { status: 500 });
  }

  // The notice is already committed — a push failure must not turn a
  // successful post into an error for the operator. Only fan out to
  // Residents when the chosen audience actually includes them; an
  // OPERATORS-only notice must not alert residents' devices. Title and body
  // are generic — no notice content (PWA privacy rule keeps this a link, not
  // a leak of what was posted).
  if (parsed.data.audience === 'RESIDENTS' || parsed.data.audience === 'ALL_MEMBERS') {
    // requireFinancialOperator()'s AdminAuthResult carries no societySlug, so
    // the slug comes straight off the request the proxy already stamped it
    // onto (the same header requireAuth() reads internally).
    const societySlug = request.headers.get('x-society-slug');
    await notifySocietyResidents(auth.societyId, {
      title: 'New notice posted',
      body: 'Open Trezia to read the latest notice for your society.',
      url: societyPath(societySlug, '/notices'),
    }).catch(() => {});
  }

  return Response.json({ data }, { status: 201 });
}
