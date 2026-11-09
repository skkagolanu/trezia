'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { formatDate } from '@/lib/utils/date';
import { formatBytes } from '@/lib/utils/bytes';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import AdminAuthorizationsModal from './AdminAuthorizationsModal';

type SocietyCard = {
  id: string; slug: string; name: string; shortName: string | null;
  status: 'active' | 'suspended'; role: string;
  metrics: {
    access: { unitCount: number; accountCount: number } | null;
    backups: {
      lastSnapshotAt: string | null;
      usage: {
        measuredAt: string; dbRowCount: number; artifactBytes: number; snapshotBytes: number;
        snapshotCount: number; lastSnapshotResult: string | null; lastSnapshotRatio: number | null;
      } | null;
    } | null;
    agent: { enabled: boolean; used: number; limit: number } | null;
  } | null;
};

export default function SocietiesDashboard({ isPlatformOwner }: { isPlatformOwner: boolean }) {
  const [societies, setSocieties] = useState<SocietyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTarget, setStatusTarget] = useState<SocietyCard | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [adminTarget, setAdminTarget] = useState<SocietyCard | null>(null);

  async function load() {
    setLoading(true);
    const response = await fetch('/api/me/societies');
    const body = await response.json().catch(() => ({}));
    if (!response.ok) toast.error(body.error ?? 'Could not load societies');
    else setSocieties(body.societies ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function changeStatus(society: SocietyCard) {
    const action = society.status === 'active' ? 'suspend' : 'reactivate';
    setStatusSaving(true);
    const response = await fetch(`/api/platform/societies/${society.id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: statusReason }),
    });
    const body = await response.json().catch(() => ({}));
    setStatusSaving(false);
    if (!response.ok) return toast.error(body.error ?? `${action} failed`);
    toast.success(society.status === 'active' ? 'Society suspended' : 'Society reactivated');
    setStatusTarget(null);
    setStatusReason('');
    await load();
  }

  if (loading) return <p className="text-sm text-sf-label3">Loading societies…</p>;

  return (
    <div className="space-y-4">
      {isPlatformOwner && (
        <div className="flex justify-end">
          <Link href="/societies/new" className="rounded-[10px] bg-sf-blue px-4 py-2 text-sm font-semibold text-white no-underline">+ Create Society</Link>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {societies.map(society => (
          <article key={society.id} className="rounded-2xl border border-black/[0.07] bg-sf-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-sf-label">{society.name}</h2>
                <p className="mt-0.5 text-xs text-sf-label3">/s/{society.slug} · {society.role}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${society.status === 'active' ? 'bg-sf-green/10 text-sf-green' : 'bg-sf-orange/10 text-sf-orange'}`}>
                {society.status}
              </span>
            </div>
            {society.metrics?.access && (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-sf-label3">Flats</dt><dd className="font-semibold text-sf-label">{society.metrics.access.unitCount}</dd></div>
                <div><dt className="text-xs text-sf-label3">Accounts</dt><dd className="font-semibold text-sf-label">{society.metrics.access.accountCount}</dd></div>
              </dl>
            )}
            {society.metrics?.backups && (
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-black/[0.06] pt-3 text-sm">
                <div className="col-span-2"><dt className="text-xs text-sf-label3">Last snapshot</dt><dd className="text-sf-label2">{society.metrics.backups.lastSnapshotAt ? formatDate(society.metrics.backups.lastSnapshotAt.slice(0, 10)) : 'Not recorded'}</dd></div>
                {society.metrics.backups.usage && (
                  <>
                    <div><dt className="text-xs text-sf-label3">Database rows</dt><dd className="font-semibold text-sf-label">{society.metrics.backups.usage.dbRowCount.toLocaleString('en-IN')}</dd></div>
                    <div><dt className="text-xs text-sf-label3">Artifact storage</dt><dd className="font-semibold text-sf-label">{formatBytes(society.metrics.backups.usage.artifactBytes)}</dd></div>
                    <div>
                      <dt className="text-xs text-sf-label3">Snapshots</dt>
                      <dd className="text-sf-label2">{society.metrics.backups.usage.snapshotCount} · {formatBytes(society.metrics.backups.usage.snapshotBytes)}{society.metrics.backups.usage.lastSnapshotRatio != null ? ` · ${Math.round(society.metrics.backups.usage.lastSnapshotRatio * 100)}%` : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-sf-label3">Last backup</dt>
                      <dd className="text-sf-label2">{society.metrics.backups.usage.lastSnapshotResult === 'SKIPPED_UNCHANGED' ? 'Unchanged' : society.metrics.backups.usage.lastSnapshotResult === 'UPLOADED' ? 'Uploaded' : society.metrics.backups.usage.lastSnapshotResult ?? '—'}</dd>
                    </div>
                  </>
                )}
              </dl>
            )}
            {society.metrics?.agent && (
              <dl className="mt-3 border-t border-black/[0.06] pt-3 text-sm">
                <div>
                  <dt className="text-xs text-sf-label3">Assistant today</dt>
                  <dd className="text-sf-label2">{society.metrics.agent.enabled ? `${society.metrics.agent.used} / ${society.metrics.agent.limit} used` : 'Disabled'}</dd>
                </div>
              </dl>
            )}
            {/* Entering a society is a full load, not a <Link>: /societies shares the (app)
                layout with every scoped page, and the slug arrives as a proxy-set request
                header. A soft navigation reuses the layout, leaving the unscoped
                capability-less role in the chrome — an empty top nav inside the society. */}
            <div className="mt-5 flex items-center gap-2">
              {society.status === 'active' || isPlatformOwner ? (
                <a href={`/s/${society.slug}/payments`} className="flex-1 rounded-[9px] bg-sf-blue px-3 py-2 text-center text-sm font-semibold text-white no-underline">
                  {society.status === 'active' ? 'Open Society' : 'Open read-only'}
                </a>
              ) : (
                <span className="flex-1 rounded-[9px] bg-sf-bg px-3 py-2 text-center text-sm font-medium text-sf-label3">Access suspended</span>
              )}
              {isPlatformOwner && (
                <div className="flex gap-2">
                  <button onClick={() => setAdminTarget(society)} className="rounded-[9px] border border-sf-border px-3 py-2 text-sm text-sf-label2">Admins</button>
                  <button onClick={() => setStatusTarget(society)} className="rounded-[9px] border border-sf-border px-3 py-2 text-sm text-sf-label2">
                    {society.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <Modal open={!!statusTarget} onClose={() => { setStatusTarget(null); setStatusReason(''); }} title={statusTarget ? `${statusTarget.status === 'active' ? 'Suspend' : 'Reactivate'} ${statusTarget.name}` : 'Change society status'} size="sm">
        <form onSubmit={event => { event.preventDefault(); if (statusTarget) void changeStatus(statusTarget); }} className="space-y-4">
          <Input label="Reason" value={statusReason} onChange={event => setStatusReason(event.target.value)} minLength={10} maxLength={500} required hint="At least 10 characters; this is retained in the platform audit trail." />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setStatusTarget(null)}>Cancel</Button><Button type="submit" variant={statusTarget?.status === 'active' ? 'danger' : 'primary'} loading={statusSaving}>{statusTarget?.status === 'active' ? 'Suspend' : 'Reactivate'}</Button></div>
        </form>
      </Modal>
      <AdminAuthorizationsModal society={adminTarget} open={!!adminTarget} readOnly={adminTarget?.status === 'suspended'} onClose={() => setAdminTarget(null)} onChanged={load} />
    </div>
  );
}
