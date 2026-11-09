import { PAYABLE_BILL_STATUSES } from '@/lib/utils/billing';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, uploadPrivateAttachment } from '@/lib/storage/r2';
import { validateAttachment } from '@/lib/operations/attachments';
import { MultipartLimitError, parseBoundedMultipart } from '@/lib/uploads/multipart';
import { check, clientIp } from '@/lib/utils/rate-limit';
import { notifySocietyOperators } from '@/lib/notifications/notify';
import { MAX_PAYMENT_PROOF_BYTES } from '@/lib/payments/proof';
import { paiseToRupees, parseRupeesToPaise } from '@/lib/payments/money';

export const runtime = 'nodejs';

const ClaimFieldsSchema = z.object({
  // Empty is valid (migration 066): it means "apply to my oldest dues" /
  // record as an advance when there is nothing outstanding. Non-empty keeps
  // the exact-payable-total contract, enforced at approval time.
  bill_ids: z.array(z.string().uuid()).max(60),
  amount_paise: z.number().int().positive().max(50_000_000),
  utr: z.string().trim().min(1).max(64).optional(),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function isRealNonFutureDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return false;
  return value <= new Date().toISOString().slice(0, 10);
}

function formString(fields: Record<string, string>, key: string): string | undefined {
  const value = fields[key];
  return value?.trim() ? value.trim() : undefined;
}

function parseBillIds(fields: Record<string, string>): unknown {
  const raw = fields.bill_ids;
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON — fall through to comma-separated parsing.
  }
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  // Resident self-service action only — operators approve/reject through the
  // review routes below, they never submit a claim themselves.
  if (auth.role !== 'resident' || !auth.unitId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const uploadLimit = check(`claim-upload:${auth.societyId}:${auth.userId}`, 5, 60_000);
  const ipLimit = check(`claim-upload:ip:${clientIp(request.headers)}`, 20, 60_000);
  if (!uploadLimit.allowed || !ipLimit.allowed) {
    const resetAt = Math.max(uploadLimit.resetAt, ipLimit.resetAt);
    return Response.json({ error: 'Too many uploads. Please wait before trying again.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)) },
    });
  }

  let multipart: Awaited<ReturnType<typeof parseBoundedMultipart>>;
  try {
    multipart = await parseBoundedMultipart(request, { fileField: 'screenshot', maxFileBytes: MAX_PAYMENT_PROOF_BYTES });
  } catch (error) {
    const message = error instanceof MultipartLimitError
      ? 'Payment screenshots must be 4 MiB or smaller'
      : 'Invalid multipart form';
    return Response.json({ error: message }, { status: error instanceof MultipartLimitError ? 413 : 400 });
  }

  const amountRaw = formString(multipart.fields, 'amount');
  const amountPaise = parseRupeesToPaise(amountRaw);
  const parsed = ClaimFieldsSchema.safeParse({
    bill_ids: parseBillIds(multipart.fields),
    amount_paise: amountPaise,
    utr: formString(multipart.fields, 'utr'),
    paid_on: formString(multipart.fields, 'paid_on'),
  });
  if (!parsed.success) {
    return Response.json({ error: 'Check the payment submission details and try again' }, { status: 422 });
  }
  if (parsed.data.paid_on && !isRealNonFutureDate(parsed.data.paid_on)) {
    return Response.json({ error: 'Payment date must be a real date and cannot be in the future' }, { status: 422 });
  }

  const { file } = multipart;
  const bytes = file.bytes;
  let verified: ReturnType<typeof validateAttachment>;
  try {
    verified = validateAttachment(bytes, file.contentType);
  } catch {
    return Response.json({ error: 'Only genuine JPEG or PNG screenshots up to 4 MiB are accepted' }, { status: 422 });
  }
  if (verified.contentType !== 'image/jpeg' && verified.contentType !== 'image/png') {
    return Response.json({ error: 'Only genuine JPEG or PNG screenshots up to 4 MiB are accepted' }, { status: 422 });
  }

  // so this doubles as the ownership check. An empty bill_ids array means
  // "apply to my oldest dues" / advance (migration 066) — nothing to verify,
  // and the RPC below accepts it directly.
  if (parsed.data.bill_ids.length > 0) {
    const supabase = await createClient();
    const { data: bills, error: billsError } = await supabase
      .from('bills')
      .select('id')
      .in('id', parsed.data.bill_ids)
      .eq('unit_id', auth.unitId)
      .eq('is_voided', false)
      .in('status', PAYABLE_BILL_STATUSES);

    if (billsError) {
      console.error('[payments/claim] bill lookup failed');
      return Response.json({ error: 'The payment submission was not saved. Refresh and try again.' }, { status: 500 });
    }
    if (!bills || bills.length !== parsed.data.bill_ids.length) {
      return Response.json({ error: "Some of those bills aren't yours or are already paid" }, { status: 400 });
    }
  }

  const extension = verified.contentType === 'image/png' ? 'png' : 'jpg';
  const objectKey = `claims/${auth.societyId}/${crypto.randomUUID()}.${extension}`;
  try {
    await uploadPrivateAttachment(objectKey, bytes, verified.contentType);
  } catch {
    console.error('[payments/claim] screenshot upload failed');
    return Response.json({ error: 'Could not store the screenshot. Please try again.' }, { status: 502 });
  }

  // Service client — residents have no insert policy on this table by design.
  const service = await createServiceClient();
  const { data: claimId, error: rpcError } = await service.rpc('submit_resident_payment_claim', {
    p_unit_id: auth.unitId,
    p_society_id: auth.societyId,
    p_bill_ids: parsed.data.bill_ids,
    p_amount: paiseToRupees(parsed.data.amount_paise),
    p_utr: parsed.data.utr ?? null,
    p_paid_on: parsed.data.paid_on ?? null,
    p_screenshot_key: objectKey,
    p_user_id: auth.userId,
    p_screenshot_sha256: verified.sha256,
  });

  if (rpcError) {
    try { await deletePrivateAttachment(objectKey); }
    catch { console.error('[payments/claim] orphan cleanup failed'); }
    const message = rpcError.message ?? '';
    if (message.includes('PENDING_CLAIM_EXISTS')) {
      return Response.json({ error: 'You already have a pending payment submission for one of these months' }, { status: 409 });
    }
    if (message.includes('BILL_NOT_CLAIMABLE')) {
      return Response.json({ error: "Some of those bills aren't yours or are already paid" }, { status: 400 });
    }
    // Wording assumes an honest mistake (resubmitting the same screenshot or
    // reusing a reference number by accident) — this is the common case, and
    // a rejected claim can legitimately be resubmitted with the same
    // screenshot and a corrected amount, so this must not read as an accusation.
    if (message.includes('DUPLICATE_SCREENSHOT')) {
      return Response.json({ error: "You've already submitted this screenshot" }, { status: 409 });
    }
    if (message.includes('DUPLICATE_UTR')) {
      return Response.json({ error: 'That reference number has already been submitted' }, { status: 409 });
    }
    console.error('[payments/claim] submit failed');
    return Response.json({ error: 'The payment submission was not saved. Refresh and try again.' }, { status: 500 });
  }

  // Operators discover claims by pulling /claims or the attention card; without
  // this alert a payment submission can sit unreviewed indefinitely. Best-effort by
  // design — the claim is already committed, so a push failure must not turn a
  // successful submission into an error the resident would retry.
  // No amount, flat or UTR in the payload (PWA privacy rule).
  await notifySocietyOperators(auth.societyId, {
    title: 'New payment proof to review',
    body: 'A resident submitted a payment proof for approval.',
    url: auth.societySlug ? `/s/${auth.societySlug}/claims` : '/claims',
  }).catch(() => {});

  return Response.json({ claim_id: claimId }, { status: 201 });
}
