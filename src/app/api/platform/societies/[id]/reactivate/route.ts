import { SocietySuspensionSchema } from '@/lib/validation/schemas';
import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  const parsed = SocietySuspensionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A clear reactivation reason is required', issues: parsed.error.issues }, { status: 422 });
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_society_suspension', {
    p_society_id: id, p_suspended: false, p_reason: parsed.data.reason, p_actor_id: auth.userId,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ ok: true });
}
