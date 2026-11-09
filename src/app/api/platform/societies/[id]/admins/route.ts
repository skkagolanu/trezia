import { platformCreationEnabled } from '@/lib/features';
import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { PlatformAdminAuthorizationSchema } from '@/lib/validation/schemas';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;
  const service = await createServiceClient();
  const { data: society } = await service.from('societies').select('id, status').eq('id', id).maybeSingle();
  if (!society) return Response.json({ error: 'Society not found' }, { status: 404 });
  const { data, error } = await service.from('resident_invites')
    .select('id, email, created_at, claimed_at, claimed_by, revoked_at')
    .eq('society_id', id)
    .eq('role', 'admin')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: 'Could not load Admin authorizations' }, { status: 500 });
  return Response.json({ authorizations: data ?? [], login_url: `${new URL(request.url).origin}/login`, read_only: society.status === 'suspended' });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!platformCreationEnabled()) {
    return Response.json({ error: 'Platform authorization changes are not enabled yet' }, { status: 503 });
  }
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  const parsed = PlatformAdminAuthorizationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid Admin email' }, { status: 422 });
  const { id } = await params;
  const service = await createServiceClient();
  const { data, error } = await service.rpc('create_platform_admin_authorization', {
    p_society_id: id,
    p_email: parsed.data.email.toLowerCase(),
    p_actor_id: auth.userId,
  });
  if (error) {
    const conflict = ['ACTIVE_ACCESS_EXISTS', 'PENDING_ACCESS_EXISTS'].some(code => error.message.includes(code));
    const suspended = error.message.includes('SOCIETY_SUSPENDED');
    return Response.json({ error: conflict ? 'Admin access already exists for this email' : suspended ? 'Society is suspended' : 'Could not authorize Admin access' }, { status: conflict ? 409 : suspended ? 423 : 500 });
  }
  return Response.json({ id: data, login_url: `${new URL(request.url).origin}/login` }, { status: 201 });
}
