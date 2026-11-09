import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { AccessRequestSchema } from '@/lib/validation/schemas';
import { check, clientIp } from '@/lib/utils/rate-limit';
import { notifySocietyOperators } from '@/lib/notifications/notify';
import { societyPath } from '@/lib/society-path';


export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!check(`access-req:${ip}`, 5, 60 * 60 * 1000).allowed) {
    return Response.json({ error: 'Too many requests — please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = AccessRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });

  const { society_id, unit_id, email, name, phone } = parsed.data;
  const service = await createServiceClient();

  const [{ data: society, error: societyError }, { data: unit, error: unitError }] = await Promise.all([
    service
      .from('societies')
      .select('id, slug')
      .eq('id', society_id)
      .eq('status', 'active')
      .eq('is_active', true)
      .maybeSingle(),
    service
      .from('units')
      .select('id')
      .eq('id', unit_id)
      .eq('society_id', society_id)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .maybeSingle(),
  ]);

  if (societyError || unitError) {
    console.error(societyError ?? unitError);
    return Response.json({ error: 'Could not submit request' }, { status: 500 });
  }
  if (!society || !unit) {
    return Response.json({ error: 'That society and flat selection is not available.' }, { status: 422 });
  }

  const { error } = await service.rpc('submit_access_request', {
    p_society_id: society_id,
    p_unit_id: unit_id,
    p_email: email,
    p_name: name ?? '',
    p_phone: phone ?? '',
  });

  if (error) { console.error(error); return Response.json({ error: 'Could not submit request' }, { status: 500 }); }

  // The request is already committed — a push failure here must not turn a
  // successful submission into an error for the (unauthenticated) requester,
  // and operators would otherwise only discover this by polling the approval
  // queue. No email, phone or name in the payload (PWA privacy rule).
  await notifySocietyOperators(society_id, {
    title: 'New access request',
    body: 'Someone requested access to a flat in your society.',
    url: societyPath((society as { slug?: string }).slug ?? null, '/settings'),
  }).catch(() => {});

  return Response.json({ ok: true }, { status: 201 });
}

// Admin: pending requests for the caller's society (the approval queue).
export async function GET() {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  const service = await createServiceClient();
  const { data, error } = await service
    .from('access_requests')
    .select('id, email, unit_id, submitted_name, submitted_phone, created_at, units!requests_unit_same_society(flat_number)')
    .eq('status', 'PENDING')
    .eq('society_id', auth.societyId)
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return Response.json({ error: 'Failed to load requests' }, { status: 500 }); }
  return Response.json({ requests: data ?? [] });
}
