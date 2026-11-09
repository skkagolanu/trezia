import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireOperationsOperator, requirePublishedDocumentsReader } from '@/lib/supabase/require-auth';
import { attachmentKey, readPrivateAttachment } from '@/lib/storage/r2';
import { safeDownloadFilename } from '@/lib/operations/attachments';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePublishedDocumentsReader();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'Not found' }, { status: 404 });
  const supabase = await createClient();
  const result = auth.role === 'resident'
    ? await supabase.rpc('get_resident_attachment', { p_attachment_id: id })
    : await supabase.from('society_attachments').select('id,filename,content_type,byte_size,society_id').eq('id', id).eq('society_id', auth.societyId).is('archived_at', null).maybeSingle();
  const rpcData = auth.role === 'resident' ? (result.data as unknown as Array<{ id: string; filename: string; content_type: string; byte_size: number }> | null)?.[0] : result.data;
  const data = rpcData as { id: string; filename: string; content_type: string; byte_size: number; society_id?: string } | null;
  const { error } = result;
  if (error) return Response.json({ error: 'Failed to load attachment' }, { status: 500 });
  if (!data) return Response.json({ error: 'Attachment not found' }, { status: 404 });
  try {
    const societyId = auth.role === 'resident' ? auth.societyId : (data.society_id ?? auth.societyId);
    const bytes = await readPrivateAttachment(attachmentKey(societyId, data.id));
    return new Response(Buffer.from(bytes), { headers: {
      'Content-Type': data.content_type,
      'Content-Length': String(data.byte_size),
      'Content-Disposition': `attachment; filename="${safeDownloadFilename(data.filename)}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return Response.json({ error: 'Attachment object unavailable' }, { status: 502 }); }
}

export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsOperator();
  if (auth.unauthorized) return auth.unauthorized;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'Not found' }, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.from('society_attachments').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('society_id', auth.societyId).select('id,archived_at').maybeSingle();
  if (error) return Response.json({ error: 'Failed to archive attachment' }, { status: 500 });
  if (!data) return Response.json({ error: 'Attachment not found' }, { status: 404 });
  return Response.json({ data });
}
