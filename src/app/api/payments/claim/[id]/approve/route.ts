import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifyUser } from '@/lib/notifications/notify';

export const runtime = 'nodejs';

const ApproveBodySchema = z.object({
  method: z.enum(['upi', 'other']).optional(),
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
  const parsed = ApproveBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Choose a valid payment method before approving this submission' }, { status: 422 });
  }

  // Service client — claim rows carry no operator-facing RLS write policy;
  // every mutation goes through the transactional RPC below.
  const service = await createServiceClient();
  const { data: claim, error: claimError } = await service
    .from('resident_payment_claims')
    .select('submitted_by, society_id, levy_assessment_ids, societies(slug)')
    .eq('id', id)
    .maybeSingle();

  if (claimError) {
    console.error('[payments/claim/approve] claim lookup failed');
    return Response.json({ error: 'The payment submission could not be loaded. Refresh before reviewing it.' }, { status: 500 });
  }
  if (!claim || claim.society_id !== auth.societyId) {
    return Response.json({ error: 'Payment submission not found' }, { status: 404 });
  }

  // A levy claim MUST go to the levy RPC. Sending it to the bill one is not a
  // no-op: that function sees zero bill_ids, treats the claim as undirected,
  // runs oldest-first appropriation over maintenance bills, and books the money
  // as an unapplied maintenance advance — while the levy the resident actually
  // paid stays outstanding. The database refuses this too (migration 067 raises
  // CLAIM_IS_LEVY_CLAIM), so a future caller that forgets cannot misroute money.
  const isLevyClaim = (claim.levy_assessment_ids ?? []).length > 0;

  const { data: recordId, error } = isLevyClaim
    ? await service.rpc('approve_resident_levy_claim', {
      p_claim_id: id,
      p_reviewer_id: auth.userId,
      p_method: parsed.data.method ?? 'upi',
    })
    : await service.rpc('approve_resident_payment_claim', {
      p_claim_id: id,
      p_reviewer_id: auth.userId,
      p_method: parsed.data.method ?? 'upi',
    });
  const paymentId = recordId;

  if (error) {
    const message = error.message ?? '';
    if (message.includes('CLAIM_NOT_FOUND')) {
      return Response.json({ error: 'Payment submission not found' }, { status: 404 });
    }
    if (message.includes('CLAIM_NOT_PENDING')) {
      return Response.json({ error: 'This payment submission has already been reviewed' }, { status: 409 });
    }
    if (message.includes('PAYMENT_AMOUNT_MISMATCH')) {
      return Response.json({
        error: isLevyClaim
          ? 'Claimed amount no longer matches the selected AMC dues'
          : 'Claimed amount no longer matches the selected bills',
      }, { status: isLevyClaim ? 422 : 409 });
    }
    if (isLevyClaim && message.includes('NOT_A_LEVY_CLAIM')) {
      return Response.json({ error: 'This submission does not name an AMC due' }, { status: 422 });
    }
    if (isLevyClaim && (
      message.includes('ASSESSMENT_NOT_PAYABLE')
      || message.includes('LEVY_ALREADY_SETTLED')
      || message.includes('COLLECTION_EXCEEDS_ASSESSMENT')
    )) {
      return Response.json({ error: 'One or more AMC dues can no longer be approved' }, { status: 409 });
    }
    if (message.includes('BILL_NOT_PAYABLE') || message.includes('DUPLICATE_OR_EMPTY_BILL_IDS')) {
      return Response.json({ error: 'One or more selected bills can no longer be approved' }, { status: 409 });
    }
    console.error('[payments/claim/approve] approval failed');
    return Response.json({ error: 'The payment submission was not approved. Refresh and review it again.' }, { status: 500 });
  }

  if (claim.submitted_by) {
    const society = claim.societies as unknown as { slug?: string } | Array<{ slug?: string }> | null;
    const slug = Array.isArray(society) ? society[0]?.slug : society?.slug;
    await notifyUser(claim.submitted_by, {
      title: 'Payment approved',
      body: isLevyClaim ? 'Your AMC payment was approved and recorded.' : 'Your maintenance payment was approved and recorded.',
      url: slug ? `/s/${slug}/my-flat` : '/my-flat',
    }).catch(() => {});
  }

  return Response.json({ payment_id: paymentId }, { status: 200 });
}
