'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { societyApiPath, societyFetch } from '@/lib/society-path';
import { usePathname } from 'next/navigation';
import type { AttachmentSummary, ParentType } from './types';

export default function AttachmentManager({ parentType, parentId, canWrite }: { parentType: ParentType; parentId: string; canWrite: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const [items, setItems] = useState<AttachmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const limit = 20;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await societyFetch(`/api/attachments?parent_type=${parentType}&parent_id=${encodeURIComponent(parentId)}&page=${page}&limit=${limit}`);
      const body = await response.json() as { items?: AttachmentSummary[]; total?: number; has_more?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to load files');
      setItems(body.items ?? []);
      setPagination({ total: body.total ?? 0, hasMore: body.has_more === true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load files'); }
    finally { setLoading(false); }
  }, [page, parentId, parentType]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [parentId, parentType]);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setError('Choose a PDF, JPEG, or PNG no larger than 4 MiB.'); return; }
    setBusy(true); setError('');
    const form = new FormData(); form.set('parent_type', parentType); form.set('parent_id', parentId); form.set('file', file);
    try {
      const response = await societyFetch('/api/attachments', { method: 'POST', body: form });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to upload file');
      if (input.current) input.current.value = '';
      toast.success('File attached'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to upload file'); }
    finally { setBusy(false); }
  }

  async function archive(id: string) {
    if (!window.confirm('Archive this file? It will no longer be available for download.')) return;
    setBusy(true);
    try {
      const response = await societyFetch(`/api/attachments/${encodeURIComponent(id)}`, { method: 'PATCH' });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to archive file');
      toast.success('File archived'); await load();
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Unable to archive file'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 border-t border-[var(--sf-divider)] pt-3">
      <p className="flex items-center gap-2 text-[var(--text-sm)] font-medium text-[var(--sf-label)]"><Paperclip size={15} aria-hidden /> Files</p>
      {loading ? <p role="status" className="text-[var(--text-xs)] text-[var(--sf-label3)]">Loading files…</p> : items.length === 0 ? <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">No file attached.</p> : (
        <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--sf-bg)] p-2">
          <span className="min-w-0 flex-1 truncate text-[var(--text-xs)] text-[var(--sf-label2)]" title={item.filename}>{item.filename} · {(item.byte_size / 1024).toFixed(0)} KB</span>
          <a aria-label={`Download ${item.filename}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--sf-blue)] hover:bg-[var(--sf-nav-hover)]" href={societyApiPath(pathname, `/api/attachments/${item.id}`)}><Download size={16} aria-hidden /></a>
          {canWrite && <button type="button" disabled={busy} aria-label={`Archive ${item.filename}`} onClick={() => archive(item.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--sf-red)] hover:bg-[var(--sf-nav-hover)] disabled:opacity-50"><Archive size={15} aria-hidden /></button>}
        </li>)}</ul>
      )}
      {!loading && pagination.total > limit && <div className="flex items-center justify-between gap-2 text-[var(--text-xs)] text-[var(--sf-label3)]">
        <span>Page {page} of {Math.ceil(pagination.total / limit)}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy || page === 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy || !pagination.hasMore} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>
      </div>}
      {canWrite && items.length === 0 && <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" aria-label="Choose attachment" className="min-w-0 flex-1 text-[var(--text-xs)] text-[var(--sf-label2)] file:mr-2 file:min-h-11 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--sf-nav-active)] file:px-3 file:text-[var(--sf-blue)]" /><Button type="button" variant="secondary" className="min-h-11" loading={busy} onClick={upload}>Attach</Button></div>}
      {canWrite && items.length > 0 && <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">Archive the current file before attaching a replacement.</p>}
      <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">PDF, JPEG or PNG · maximum 4 MiB · private, role-checked download</p>
      {error && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{error} <button type="button" onClick={load} className="min-h-11 underline">Try again</button></p>}
    </div>
  );
}
