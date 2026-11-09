import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { readPrivateAttachment } from '@/lib/storage/r2';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Service client — claims carry no client-facing SELECT-by-id shortcut for
  // this proof image; authorization is enforced explicitly below instead.
  const service = await createServiceClient();
  const { data: claim, error } = await service
    .from('resident_payment_claims')
    .select('society_id, unit_id, screenshot_object_key')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[payments/claim/screenshot] claim lookup failed');
    return Response.json({ error: 'Could not load the claim' }, { status: 500 });
  }
  if (!claim || claim.society_id !== auth.societyId) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const isOperator = hasCapability(auth.role, 'finance_read');
  const isOwningResident = auth.role === 'resident' && auth.unitId === claim.unit_id;
  if (!isOperator && !isOwningResident) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const bytes = await readPrivateAttachment(claim.screenshot_object_key);
    const contentType = claim.screenshot_object_key.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Screenshot unavailable' }, { status: 404 });
  }
}
