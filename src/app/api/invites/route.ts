import { requireAdmin } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

const schema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('resident'), resident_id: z.string().uuid() }),
  z.object({
    source: z.literal('manual'),
    unit_id: z.string().uuid(),
    email: z.string().email(),
    confirm_email_mismatch: z.boolean().optional(),
  }),
  z.object({ source: z.literal('treasurer'), email: z.string().email() }),
]);

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const service = await createServiceClient();
  let email: string;
  let unitId: string | null = null;
  let role: 'resident' | 'treasurer';

  if (parsed.data.source === 'resident') {
    const { data: resident } = await service.from('residents')
      .select('id, email, unit_id, is_active')
      .eq('id', parsed.data.resident_id)
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .single();
    if (!resident?.email) return Response.json({ error: 'Active resident with email not found' }, { status: 404 });
    unitId = resident.unit_id;
    email = resident.email.trim().toLowerCase();
    role = 'resident';
  } else if (parsed.data.source === 'manual') {
    unitId = parsed.data.unit_id;
    email = parsed.data.email.trim().toLowerCase();
    role = 'resident';

    const { data: residentEmails } = await service.from('residents')
      .select('email')
      .eq('unit_id', unitId)
      .eq('society_id', auth.societyId)
      .eq('is_active', true)
      .not('email', 'is', null);
    const known = (residentEmails ?? []).map(row => row.email?.trim().toLowerCase()).filter(Boolean);
    if (known.length > 0 && !known.includes(email) && !parsed.data.confirm_email_mismatch) {
      return Response.json({
        error: 'This email does not match an active resident on the selected flat.',
        code: 'EMAIL_MISMATCH',
      }, { status: 409 });
    }
  } else {
    email = parsed.data.email.trim().toLowerCase();
    role = 'treasurer';
  }

  if (unitId) {
    const { data: unit } = await service.from('units').select('id, society_id')
      .eq('id', unitId).eq('society_id', auth.societyId).single();
    if (!unit) return Response.json({ error: 'Flat not found for this society' }, { status: 404 });
  }

  const { data, error } = await service.rpc('create_access_invite', {
    p_society_id: auth.societyId,
    p_email: email,
    p_role: role,
    p_unit_id: unitId,
    p_actor_id: auth.userId,
  });

  if (error) {
    if (error.code === '23505' || ['ACTIVE_ACCESS_EXISTS', 'PENDING_ACCESS_EXISTS'].some(code => error.message.includes(code))) {
      let existingRole: string | null = null;
      try {
        const { data: existingInvite } = await service.from('resident_invites')
          .select('role')
          .eq('society_id', auth.societyId)
          .eq('email', email)
          .maybeSingle();
        existingRole = existingInvite?.role ?? null;
      } catch {
        existingRole = null;
      }
      return Response.json({
        error: 'Access already exists for this email',
        code: 'ACCESS_EXISTS',
        existingRole,
      }, { status: 409 });
    }
    console.error(error);
    return Response.json({
      error: 'Failed to authorize access',
      code: 'ACCESS_AUTHORIZATION_FAILED',
    }, { status: 500 });
  }
  return Response.json({ id: data, login_url: `${new URL(request.url).origin}/login` }, { status: 201 });
}
