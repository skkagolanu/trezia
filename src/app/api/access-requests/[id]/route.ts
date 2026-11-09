import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { AccessRequestDecisionSchema } from '@/lib/validation/schemas';

// Admin approves or declines a pending request. Approval either creates access
// for an existing Auth user or seeds an authorization that the shared callback
// claims into a society membership on the resident's next magic-link login.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = AccessRequestDecisionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });

  const service = await createServiceClient();
  const { error } = await service.rpc('decide_access_request', {
    p_request_id: id,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason ?? '',
    p_society_id: auth.societyId,
    p_actor_id: auth.userId,
  });

  if (error) {
    if (error.message.includes('REQUEST_NOT_FOUND')) return Response.json({ error: 'Request not found' }, { status: 404 });
    if (
      error.message.includes('REQUEST_ALREADY_HANDLED')
      || error.message.includes('ACTIVE_ACCESS_EXISTS')
      || error.message.includes('CONFLICTING_ACCESS_EXISTS')
    ) {
      return Response.json({ error: 'This request conflicts with existing access' }, { status: 409 });
    }
    console.error(error);
    return Response.json({ error: 'Could not update request' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
