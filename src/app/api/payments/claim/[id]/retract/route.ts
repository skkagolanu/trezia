import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';

export const runtime = 'nodejs';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  // Resident self-service action only, on their own claim. Operators reject
  // instead of retracting — this is not a moderation path.
  if (auth.role !== 'resident' || !auth.unitId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Service client — resident_payment_claims has no client write policy at all,
  // so the RPC is the only enforcement point. p_unit_id is the caller's own
  // authenticated membership, never request data, so a resident cannot name
  // another flat's claim.
  const service = await createServiceClient();
  const { error } = await service.rpc('retract_resident_payment_claim', {
    p_claim_id: id,
    p_unit_id: auth.unitId,
    p_user_id: auth.userId,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('CLAIM_NOT_FOUND') || message.includes('NOT_AUTHORIZED')) {
      return Response.json({ error: 'Claim not found' }, { status: 404 });
    }
    if (message.includes('CLAIM_NOT_PENDING')) {
      return Response.json({ error: 'This claim has already been reviewed' }, { status: 409 });
    }
    console.error('[payments/claim/retract] retraction failed');
    return Response.json({ error: 'Could not withdraw the claim' }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
