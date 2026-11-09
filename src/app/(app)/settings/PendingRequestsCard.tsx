'use client';
import { societyFetch } from '@/lib/society-path';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils/date';
import Tooltip from '@/components/ui/Tooltip';

interface PendingRow {
  id: string;
  email: string;
  submitted_name: string | null;
  submitted_phone: string | null;
  created_at: string;
  units: { flat_number: string } | { flat_number: string }[] | null;
}

function flatOf(u: PendingRow['units']): string {
  const rel = Array.isArray(u) ? u[0] : u;
  return rel?.flat_number ?? '—';
}

export default function PendingRequestsCard() {
  const router = useRouter();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await societyFetch('/api/access-requests');
      if (!res.ok) return;
      const d = await res.json();
      setRows(d.requests ?? []);
    } catch { /* table not live / offline — stay hidden */ }
  }
  useEffect(() => { load(); }, []);

  async function decide(id: string, action: 'approve' | 'decline') {
    if (action === 'decline' && !confirm('Decline this access request?')) return;
    setBusy(id);
    try {
      const res = await societyFetch(`/api/access-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      setRows(rs => rs.filter(r => r.id !== id));
      router.refresh();
    } catch {
      alert('Could not update the request. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-sf-border bg-sf-surface p-5">
      <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-sf-label">
        Pending access requests
        {rows.length > 0 && (
          <span className="ml-1 rounded-full bg-sf-blue/[0.12] px-2 py-0.5 text-[12px] font-medium text-sf-blue">{rows.length}</span>
        )}
        <Tooltip text="Approving a request authorizes the person but sends them no email. You must tell them to sign in." />
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-[13px] text-sf-label2">Residents can request access from the public request-access page. Requests will appear here for you to approve.</p>
      ) : (
      <>
      <p className="mt-1 text-[13px] text-sf-label2">Residents who asked for access. Approve to let them sign in.</p>
      <ul className="mt-3 divide-y divide-sf-divider">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-sf-label">
                Flat {flatOf(r.units)}{r.submitted_name ? ` · ${r.submitted_name}` : ''}
              </p>
              <p className="truncate text-[12px] text-sf-label3">
                {r.email}{r.submitted_phone ? ` · ${r.submitted_phone}` : ''} · {formatDate(r.created_at)}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => decide(r.id, 'approve')} disabled={busy === r.id}
                className="rounded-[var(--radius-md)] bg-sf-blue px-3 py-1 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
                Approve
              </button>
              <button
                onClick={() => decide(r.id, 'decline')} disabled={busy === r.id}
                className="rounded-[var(--radius-md)] border border-sf-border px-3 py-1 text-[13px] font-medium text-sf-label2 hover:bg-black/[0.04] disabled:opacity-40 transition-colors">
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      </>
      )}
    </div>
  );
}
