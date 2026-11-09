import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { pushEnabled, getVapidPublicKey, hasValidPushKeys, isAllowedPushEndpoint } from '@/lib/notifications/push';
import { check, clientIp } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function GET(request?: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  const enabled = pushEnabled();
  const vapidPublicKey = getVapidPublicKey();
  const endpoint = request ? new URL(request.url).searchParams.get('endpoint') : null;
  if (!enabled || !vapidPublicKey || !endpoint) {
    return Response.json(
      { vapidPublicKey, enabled, subscribed: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return Response.json({ error: 'Unsupported push subscription' }, { status: 422 });
  }

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .eq('user_id', auth.userId)
    .eq('society_id', auth.societyId)
    .maybeSingle();
  if (error) {
    console.error('[notifications/subscribe] status lookup failed:', error.code ?? 'unknown');
    return Response.json({ error: 'Failed to check subscription' }, { status: 500 });
  }

  return Response.json(
    { vapidPublicKey, enabled, subscribed: data !== null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  if (!pushEnabled()) {
    return Response.json({ error: 'Notifications not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 422 });
  }

  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }
  if (!isAllowedPushEndpoint(parsed.data.endpoint) || !hasValidPushKeys(parsed.data.keys)) {
    return Response.json({ error: 'Unsupported push subscription' }, { status: 422 });
  }
  const limit = check(`push-subscribe:${auth.userId}`, 10, 60_000);
  const ipLimit = check(`push-subscribe:ip:${clientIp(request.headers)}`, 30, 60_000);
  if (!limit.allowed || !ipLimit.allowed) return Response.json({ error: 'Too many subscription changes' }, { status: 429 });

  const supabase = await createServiceClient();
  const { error } = await supabase.rpc('upsert_push_subscription', {
    p_user_id: auth.userId,
    p_society_id: auth.societyId,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: parsed.data.userAgent?.slice(0, 300) ?? null,
  });

  if (error) {
    if ((error.message ?? '').includes('PUSH_ENDPOINT_OWNED_BY_ANOTHER_USER')) {
      return Response.json({ error: 'This browser subscription belongs to another signed-in account. Sign out there first.' }, { status: 409 });
    }
    console.error('[notifications/subscribe] upsert failed:', error.code ?? 'unknown');
    return Response.json({ error: 'Failed to save subscription' }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 422 });
  }

  const parsed = UnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', parsed.data.endpoint)
    .eq('user_id', auth.userId);

  if (error) {
    console.error('[notifications/subscribe] delete failed:', error.code ?? 'unknown');
    return Response.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
