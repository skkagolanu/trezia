import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifyUser } from '@/lib/notifications/notify';

export const runtime = 'nodejs';

const RejectBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = RejectBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed' }, { status: 422 });
  }

  // Service client — claim rows carry no operator-facing RLS write policy;
  // every mutation goes through the transactional RPC below.
  const service = await createServiceClient();
  const { data: claim, error: claimError } = await service
    .from('resident_payment_claims')
    .select('submitted_by, society_id, societies(slug)')
    .eq('id', id)
    .maybeSingle();

  if (claimError) {
    console.error('[payments/claim/reject] claim lookup failed');
    return Response.json({ error: 'Could not load the claim' }, { status: 500 });
  }
  if (!claim || claim.society_id !== auth.societyId) {
    return Response.json({ error: 'Claim not found' }, { status: 404 });
  }

  const note = parsed.data.note ?? null;
  const { error } = await service.rpc('reject_resident_payment_claim', {
    p_claim_id: id,
    p_reviewer_id: auth.userId,
    p_note: note,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('CLAIM_NOT_PENDING')) {
      return Response.json({ error: 'This claim has already been reviewed' }, { status: 409 });
    }
    console.error('[payments/claim/reject] rejection failed');
    return Response.json({ error: 'Could not reject the claim' }, { status: 500 });
  }

  if (claim.submitted_by) {
    const society = claim.societies as unknown as { slug?: string } | Array<{ slug?: string }> | null;
    const slug = Array.isArray(society) ? society[0]?.slug : society?.slug;
    await notifyUser(claim.submitted_by, {
      title: 'Payment needs attention',
      body: note?.slice(0, 120) || 'Your uploaded payment could not be approved — please check with the treasurer.',
      url: slug ? `/s/${slug}/my-flat` : '/my-flat',
    }).catch(() => {});
  }

  return Response.json({ ok: true }, { status: 200 });
}
