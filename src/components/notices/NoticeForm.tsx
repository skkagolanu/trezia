'use client';

import { useEffect, useState } from 'react';
import { Archive, Pencil, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import { useSocietyRuntime } from '@/lib/context/SocietyRuntimeContext';
import { societyFetch } from '@/lib/society-path';
import AttachmentManager from '@/components/operations/AttachmentManager';

export type NoticeDraft = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  expires_at: string | null;
  archived_at: string | null;
  category: 'GENERAL' | 'MAINTENANCE' | 'SAFETY' | 'EVENT' | 'FINANCE' | 'GOVERNANCE';
  audience: 'ALL_MEMBERS' | 'RESIDENTS' | 'OPERATORS';
  is_pinned: boolean;
};

type Props = {
  notice?: NoticeDraft;
  mode: 'create' | 'edit';
};

function toDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

export default function NoticeForm({ notice, mode }: Props) {
  const router = useRouter();
  const { societySlug } = useSocietyRuntime();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [category, setCategory] = useState<NoticeDraft['category']>('GENERAL');
  const [audience, setAudience] = useState<NoticeDraft['audience']>('ALL_MEMBERS');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(notice?.title ?? '');
    setBody(notice?.body ?? '');
    setExpiresAt(toDateInput(notice?.expires_at));
    setCategory(notice?.category ?? 'GENERAL');
    setAudience(notice?.audience ?? 'ALL_MEMBERS');
    setIsPinned(notice?.is_pinned ?? false);
    setError('');
  }, [notice, open]);

  const isEdit = mode === 'edit';

  const noticesPath = societySlug ? '/api/notices' : null;

  async function request(path: string, init: RequestInit) {
    const response = await societyFetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const result = await response.json().catch(() => ({} as { error?: string }));
    if (!response.ok) throw new Error(result.error ?? 'Unable to save notice. Please try again.');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();
    if (!normalizedTitle || !normalizedBody) {
      setError('Add both a title and message.');
      return;
    }
    if (!noticesPath) {
      setError('Society context is unavailable. Refresh and try again.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await request(isEdit && notice ? `${noticesPath}/${encodeURIComponent(notice.id)}` : noticesPath, {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: normalizedTitle,
          body: normalizedBody,
          expires_at: expiresAt ? `${expiresAt}T23:59:59.999Z` : null,
          category,
          audience,
          is_pinned: isPinned,
        }),
      });
      toast.success(isEdit ? 'Notice updated' : 'Notice published');
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save notice. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!notice || archiving || !window.confirm('Archive this notice? Residents will no longer see it.')) return;
    if (!noticesPath) {
      toast.error('Society context is unavailable. Refresh and try again.');
      return;
    }
    setArchiving(true);
    try {
      await request(`${noticesPath}/${encodeURIComponent(notice.id)}`, { method: 'PATCH', body: JSON.stringify({ archive: true }) });
      toast.success('Notice archived');
      router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to archive notice.');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      {isEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </Button>
          {!notice?.archived_at && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 text-[var(--sf-red)] hover:text-[var(--sf-red)]" onClick={archive} isLoading={archiving}>
              <Archive size={14} aria-hidden="true" /> Archive
            </Button>
          )}
        </div>
      ) : (
        <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden="true" /> New notice
        </Button>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title={isEdit ? 'Edit notice' : 'New notice'}>
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <div>
            <label htmlFor="notice-title" className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Title</label>
            <input
              id="notice-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              maxLength={160}
              required
              className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] outline-none transition-colors placeholder:text-[var(--sf-label3)] focus:ring-2 focus:ring-[var(--sf-blue)]"
              placeholder="e.g. Water supply maintenance"
            />
            <p className="mt-1 text-right text-[var(--text-xs)] tabular-nums text-[var(--sf-label3)]">{title.length}/160</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="notice-category" className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Category</label>
              <select id="notice-category" value={category} onChange={event => setCategory(event.target.value as NoticeDraft['category'])} className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] focus:ring-2 focus:ring-[var(--sf-blue)]">
                {['GENERAL','MAINTENANCE','SAFETY','EVENT','FINANCE','GOVERNANCE'].map(value => <option key={value} value={value}>{value[0] + value.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="notice-audience" className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Audience</label>
              <select id="notice-audience" value={audience} onChange={event => setAudience(event.target.value as NoticeDraft['audience'])} className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] focus:ring-2 focus:ring-[var(--sf-blue)]">
                <option value="ALL_MEMBERS">All members</option><option value="RESIDENTS">Residents</option><option value="OPERATORS">Committee only</option>
              </select>
            </div>
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-[var(--radius-md)] bg-[var(--sf-bg)] p-3"><input type="checkbox" checked={isPinned} onChange={event => setIsPinned(event.target.checked)} className="mt-1 h-4 w-4"/><span><span className="block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Pin this notice</span><span className="text-[var(--text-xs)] text-[var(--sf-label3)]">Pinned notices stay above newer updates.</span></span></label>
          {isEdit && notice && <AttachmentManager parentType="notice" parentId={notice.id} canWrite />}
          <div>
            <label htmlFor="notice-body" className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Message</label>
            <textarea
              id="notice-body"
              value={body}
              onChange={event => setBody(event.target.value)}
              rows={7}
              maxLength={2_000}
              required
              className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-label)] outline-none transition-colors placeholder:text-[var(--sf-label3)] focus:ring-2 focus:ring-[var(--sf-blue)]"
              placeholder="Share the details residents need to know."
            />
            <p className="mt-1 text-right text-[var(--text-xs)] tabular-nums text-[var(--sf-label3)]">{body.length}/2,000</p>
          </div>
          <div>
            <label htmlFor="notice-expires" className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Hide after</label>
            <input
              id="notice-expires"
              type="date"
              value={expiresAt}
              onChange={event => setExpiresAt(event.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] outline-none transition-colors focus:ring-2 focus:ring-[var(--sf-blue)]"
            />
            <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label3)]">Optional. The notice stays visible until you archive it when this is blank.</p>
          </div>
          {error && <p role="alert" className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-red)_6%,var(--sf-surface))] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--sf-divider)] pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" className="min-h-11" isLoading={saving}>{isEdit ? 'Save changes' : 'Publish notice'}</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
