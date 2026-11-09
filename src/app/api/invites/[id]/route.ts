import { requireAdmin } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  const service = await createServiceClient();

  const { data, error } = await service.rpc('revoke_access_invite', {
    p_invite_id: id,
    p_society_id: auth.societyId,
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
    return Response.json({ error: 'Failed to revoke access' }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'Invite not found' }, { status: 404 });

  return new Response(null, { status: 204 });
}
