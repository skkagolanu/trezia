import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, readPrivateAttachment, uploadPrivateAttachment, upiQrKey } from '@/lib/storage/r2';
import { validateAttachment } from '@/lib/operations/attachments';
import { MultipartLimitError, parseBoundedMultipart } from '@/lib/uploads/multipart';
import { check, clientIp } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth.unauthorized;

  // society_config is admin/treasurer-only by policy, so a Resident reading it
  // directly gets nothing and could never load the QR their own dues page offers.
  // Migration 065 exposes just the resident-safe columns to any active member.
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc('get_resident_society_payment_info');
  const row = (Array.isArray(rows) ? rows[0] : rows) as { upi_qr_object_key: string | null } | null | undefined;
  const objectKey = row?.upi_qr_object_key ?? null;

  if (!objectKey) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const bytes = await readPrivateAttachment(objectKey);
    const contentType = objectKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'QR code unavailable' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  const uploadLimit = check(`upi-qr-upload:${auth.societyId}:${auth.userId}`, 5, 60_000);
  const ipLimit = check(`upi-qr-upload:ip:${clientIp(request.headers)}`, 20, 60_000);
  if (!uploadLimit.allowed || !ipLimit.allowed) {
    const resetAt = Math.max(uploadLimit.resetAt, ipLimit.resetAt);
    return Response.json({ error: 'Too many uploads. Please wait before trying again.' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)) },
    });
  }

  let multipart: Awaited<ReturnType<typeof parseBoundedMultipart>>;
  try {
    multipart = await parseBoundedMultipart(request, { fileField: 'qr', maxFileBytes: 1024 * 1024 });
  } catch (error) {
    const message = error instanceof MultipartLimitError
      ? 'The UPI QR image must be 1 MiB or smaller'
      : 'Invalid multipart form';
    return Response.json({ error: message }, { status: error instanceof MultipartLimitError ? 413 : 400 });
  }

  const { file } = multipart;
  const bytes = file.bytes;
  let verified: ReturnType<typeof validateAttachment>;
  try {
    verified = validateAttachment(bytes, file.contentType);
  } catch {
    return Response.json({ error: 'Only genuine JPEG or PNG images up to 1 MiB are accepted' }, { status: 422 });
  }
  // validateAttachment is shared with document-attachment uploads and also accepts
  // application/pdf — a UPI QR is scanned by a phone camera, so only images qualify here.
  if (verified.contentType !== 'image/jpeg' && verified.contentType !== 'image/png') {
    return Response.json({ error: 'Only genuine JPEG or PNG images up to 1 MiB are accepted' }, { status: 422 });
  }

  const supabase = await createClient();
  const extension = verified.contentType === 'image/png' ? 'png' : 'jpg';
  const objectKey = upiQrKey(auth.societyId, extension);
  try {
    await uploadPrivateAttachment(objectKey, bytes, verified.contentType);
  } catch {
    console.error('[society/upi-qr] upload failed');
    return Response.json({ error: 'Could not store the QR code. Please try again.' }, { status: 502 });
  }

  const { data: previousKey, error: updateError } = await supabase.rpc('set_financial_setup_qr', {
    p_society_id: auth.societyId,
    p_object_key: objectKey,
  });

  if (updateError) {
    try { await deletePrivateAttachment(objectKey); }
    catch { console.error('[society/upi-qr] orphan cleanup failed'); }
    console.error('[society/upi-qr] config update failed');
    return Response.json({ error: 'Could not save the QR code. Please try again.' }, { status: 500 });
  }

  // Delete the previous object only after the new key is durably referenced —
  // deleting first would risk residents hitting a dead link if the update above had failed.
  if (typeof previousKey === 'string' && previousKey) {
    try { await deletePrivateAttachment(previousKey); }
    catch { console.error('[society/upi-qr] previous object cleanup failed'); }
  }

  return Response.json({ ok: true });
}

export async function DELETE() {
  const auth = await requireFinancialSetupManager();
  if (auth.unauthorized) return auth.unauthorized;

  const supabase = await createClient();
  const { data: previousKey, error: updateError } = await supabase.rpc('set_financial_setup_qr', {
    p_society_id: auth.societyId,
    p_object_key: null,
  });

  if (updateError) {
    console.error('[society/upi-qr] config clear failed');
    return Response.json({ error: 'Could not remove the QR code. Please try again.' }, { status: 500 });
  }

  if (typeof previousKey === 'string' && previousKey) {
    try { await deletePrivateAttachment(previousKey); }
    catch { console.error('[society/upi-qr] object cleanup failed'); }
  }

  return Response.json({ ok: true });
}
