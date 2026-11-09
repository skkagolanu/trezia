import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { platformCreationEnabled } from '@/lib/features';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  if (!platformCreationEnabled()) {
    return Response.json({ error: 'Platform authorization changes are not enabled yet' }, { status: 503 });
  }
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  const { id, inviteId } = await params;
  const service = await createServiceClient();
  const { data: society } = await service.from('societies').select('status').eq('id', id).maybeSingle();
  if (!society) return Response.json({ error: 'Society not found' }, { status: 404 });
  if (society.status === 'suspended') return Response.json({ error: 'Society is suspended' }, { status: 423 });
  const { data, error } = await service.rpc('revoke_access_invite', {
    p_invite_id: inviteId,
    p_society_id: id,
    p_actor_id: auth.userId,
  });
  if (error) {
    console.error(error);
    if (error.message.includes('FINAL_ADMIN_REQUIRED')) {
      return Response.json({
        error: 'This is the last Admin for this society. Access cannot be removed. Authorize another Admin first, then try again.',
      }, { status: 409 });
    }
    if (error.message.includes('PLATFORM_OWNER_ADMIN_REQUIRED')) {
      return Response.json({
        error: 'This Admin membership is required by the platform owner and cannot be removed.',
      }, { status: 409 });
    }
    return Response.json({ error: 'Could not revoke Admin access' }, { status: 409 });
  }
  if (!data) return Response.json({ error: 'Admin authorization not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}
