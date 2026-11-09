export const metadata = { title: 'Notices · Trezia' };

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import NoticeForm from '@/components/notices/NoticeForm';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { roleHome } from '@/lib/auth/roles';
import { societyPath } from '@/lib/society-path';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { SocietyNotice } from '@/types/database';
import AttachmentManager from '@/components/operations/AttachmentManager';
import Badge from '@/components/ui/Badge';

type Notice = Pick<SocietyNotice, 'id' | 'title' | 'body' | 'published_at' | 'expires_at' | 'archived_at' | 'created_at' | 'category' | 'audience' | 'is_pinned'>;

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Recently' : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function NoticeCard({ notice, canManage }: { notice: Notice; canManage: boolean }) {
  const archived = Boolean(notice.archived_at);
  return (
    <article className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-[var(--text-md)] font-semibold text-[var(--sf-label)]">{notice.title}</h2>
            {notice.is_pinned && <Badge color="yellow">Pinned</Badge>}
            <Badge>{notice.category[0] + notice.category.slice(1).toLowerCase()}</Badge>
            {canManage && <Badge>{notice.audience === 'OPERATORS' ? 'Committee only' : notice.audience === 'RESIDENTS' ? 'Residents' : 'All members'}</Badge>}
            {archived && <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[var(--text-xs)] font-medium text-[var(--sf-label3)]">Archived</span>}
          </div>
          <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label3)]">
            Published {formatDate(notice.published_at)}
            {notice.expires_at && ` · Hides after ${formatDate(notice.expires_at)}`}
          </p>
        </div>
        {canManage && <NoticeForm notice={notice} mode="edit" />}
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words text-[var(--text-sm)] leading-6 text-[var(--sf-label2)]">{notice.body}</p>
      {!canManage && <AttachmentManager parentType="notice" parentId={notice.id} canWrite={false} />}
    </article>
  );
}

// Thin shell — auth + data fetching live inside NoticesSection so the
// skeleton shows immediately on navigation, mirroring /payments and /reports.
export default async function NoticesPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <NoticesSection />
    </Suspense>
  );
}

async function NoticesSection() {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  const canManage = auth.role === 'admin' || auth.role === 'treasurer';
  if (!canManage && auth.role !== 'resident') redirect(societyPath(auth.societySlug, roleHome(auth.role)));

  const supabase = await createClient();
  // society_notices has no page size limit in this list (no pagination UI — the page
  // splits the full set into active/archived below), so a single un-paged select would
  // silently truncate at PostgREST's 1,000-row cap. fetchAll pages past it.
  let data: Notice[] | null = null;
  let error: unknown = null;
  try {
    data = await fetchAll<Notice>((from, to) =>
      supabase
        .from('society_notices')
        .select('id, title, body, published_at, expires_at, archived_at, created_at, category, audience, is_pinned')
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
  } catch (caught) {
    error = caught;
  }

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Notices" />
        <div role="status" className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-6 text-[var(--text-sm)] text-[var(--sf-label2)]">
          Notices are unavailable right now. Please refresh and try again.
        </div>
      </div>
    );
  }

  const notices = data ?? [];
  const active = notices.filter(notice => !notice.archived_at);
  const archived = notices.filter(notice => notice.archived_at);
  // Resident RLS returns only published, current notices. Operators retain the
  // complete active list for management, including records nearing expiry.
  const visible = active;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notices"
        subtitle={canManage ? 'Keep residents informed with clear, timely updates.' : 'Updates from your society.'}
        action={canManage ? <NoticeForm mode="create" /> : undefined}
      />

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-8 text-center sm:px-6">
          <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{canManage ? 'No active notices' : 'No notices right now'}</p>
          <p className="mx-auto mt-1 max-w-md text-[var(--text-sm)] text-[var(--sf-label2)]">
            {canManage ? 'Publish an update when residents need to know about maintenance, meetings, or services.' : 'Your society has not published any current updates.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(notice => <NoticeCard key={notice.id} notice={notice} canManage={canManage} />)}
        </div>
      )}

      {canManage && archived.length > 0 && (
        <section className="space-y-3 pt-2" aria-labelledby="archived-notices-heading">
          <div>
            <h2 id="archived-notices-heading" className="text-[var(--text-base)] font-semibold text-[var(--sf-label)]">Archived notices</h2>
            <p className="mt-0.5 text-[var(--text-sm)] text-[var(--sf-label2)]">These are kept for your records and are not visible to residents.</p>
          </div>
          <div className="space-y-3 opacity-80">
            {archived.map(notice => <NoticeCard key={notice.id} notice={notice} canManage={canManage} />)}
          </div>
        </section>
      )}
    </div>
  );
}
