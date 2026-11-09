import { CreateSocietySchema } from '@/lib/validation/schemas';
import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import { createClient } from '@/lib/supabase/server';
import { platformCreationEnabled } from '@/lib/features';

export async function POST(request: Request) {
  if (!platformCreationEnabled()) {
    return Response.json({ error: 'Society creation is not enabled yet' }, { status: 503 });
  }
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const parsed = CreateSocietySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_platform_society', {
    p_payload: parsed.data,
    p_actor_id: auth.userId,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json(data, { status: 201 });
}
