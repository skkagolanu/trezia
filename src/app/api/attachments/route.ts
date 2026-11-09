import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireOperationsOperator, requirePublishedDocumentsReader } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, uploadPrivateAttachment } from '@/lib/storage/r2';
import { newAttachmentIdentity, validateAttachment } from '@/lib/operations/attachments';
import { MultipartLimitError, parseBoundedMultipart } from '@/lib/uploads/multipart';
import { check, clientIp } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const parentColumns = {
  document: 'document_id', contract: 'vendor_contract_id', asset: 'asset_id',
  service: 'asset_service_record_id', notice: 'notice_id',
} as const;

const metadataSchema = z.object({
  parent_type: z.enum(['document','contract','asset','service','notice']),
  parent_id: z.string().uuid(),
});
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: NextRequest) {
  const auth = await requirePublishedDocumentsReader();
  if (auth.unauthorized) return auth.unauthorized;
  const url = new URL(request.url);
  const parsed = metadataSchema.safeParse({ parent_type: url.searchParams.get('parent_type'), parent_id: url.searchParams.get('parent_id') });
  if (!parsed.success) return Response.json({ error: 'A valid parent_type and parent_id are required' }, { status: 422 });
  const pagination = paginationSchema.safeParse({ page: url.searchParams.get('page') ?? undefined, limit: url.searchParams.get('limit') ?? undefined });
  if (!pagination.success) return Response.json({ error: 'page must be a positive integer and limit must be between 1 and 100' }, { status: 422 });
  const { page, limit } = pagination.data;
  const offset = (page - 1) * limit;
  const supabase = await createClient();
  if (auth.role === 'resident') {
    if (!['document', 'notice'].includes(parsed.data.parent_type)) return Response.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await supabase.rpc('list_resident_attachments', {
      p_parent_type: parsed.data.parent_type,
      p_parent_id: parsed.data.parent_id,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return Response.json({ error: 'Failed to load attachments' }, { status: 500 });
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown> & { total_count?: number }>;
    const total = Number(rows[0]?.total_count ?? 0);
    const items = rows.map(row => {
      const item = { ...row };
      delete item.total_count;
      return item;
    });
    return Response.json({ items, page, limit, total, has_more: offset + items.length < total });
  }
  const { data, error, count } = await supabase.from('society_attachments')
    .select('id,filename,content_type,byte_size,sha256,created_at', { count: 'exact' })
    .eq('society_id', auth.societyId)
    .eq(parentColumns[parsed.data.parent_type], parsed.data.parent_id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return Response.json({ error: 'Failed to load attachments' }, { status: 500 });
  const items = data ?? [];
  return Response.json({ items, page, limit, total: count ?? 0, has_more: offset + items.length < (count ?? 0) });
}

export async function POST(request: NextRequest) {
  const auth = await requireOperationsOperator();
  if (auth.unauthorized) return auth.unauthorized;
  const uploadLimit = check(`attachment-upload:${auth.societyId}:${auth.userId}`, 10, 60_000);
  const ipLimit = check(`attachment-upload:ip:${clientIp(request.headers)}`, 30, 60_000);
  if (!uploadLimit.allowed || !ipLimit.allowed) return Response.json({ error: 'Too many uploads. Please wait before trying again.' }, { status: 429 });
  let multipart: Awaited<ReturnType<typeof parseBoundedMultipart>>;
  try { multipart = await parseBoundedMultipart(request, { fileField: 'file', maxFileBytes: 4 * 1024 * 1024 }); }
  catch (error) {
    return Response.json(
      { error: error instanceof MultipartLimitError ? 'Attachments must be 4 MiB or smaller' : 'Invalid multipart form' },
      { status: error instanceof MultipartLimitError ? 413 : 400 },
    );
  }
  const parsed = metadataSchema.safeParse({ parent_type: multipart.fields.parent_type, parent_id: multipart.fields.parent_id });
  if (!parsed.success) return Response.json({ error: 'Validation failed' }, { status: 422 });
  const { file } = multipart;
  const bytes = file.bytes;
  let verified: ReturnType<typeof validateAttachment>;
  try { verified = validateAttachment(bytes, file.contentType); }
  catch { return Response.json({ error: 'Only genuine PDF, JPEG, or PNG files up to 4 MiB are accepted' }, { status: 422 }); }

  const identity = newAttachmentIdentity(auth.societyId);
  try { await uploadPrivateAttachment(identity.key, bytes, verified.contentType); }
  catch { return Response.json({ error: 'Failed to store attachment' }, { status: 502 }); }

  const parent = { [parentColumns[parsed.data.parent_type]]: parsed.data.parent_id };
  const supabase = await createClient();
  const { data, error } = await supabase.from('society_attachments').insert({
    id: identity.id, society_id: auth.societyId, ...parent, filename: file.filename,
    content_type: verified.contentType, byte_size: bytes.length, sha256: verified.sha256,
    object_key: identity.key, created_by: auth.userId,
  }).select('id,filename,content_type,byte_size,sha256,created_at').single();
  if (error) {
    try { await deletePrivateAttachment(identity.key); } catch { console.error('[attachments] cleanup failed'); }
    return Response.json({ error: error.code === '23503' ? 'Parent record not found in this society' : 'Failed to save attachment' }, { status: error.code === '23503' ? 422 : 500 });
  }
  return Response.json({ data }, { status: 201 });
}
