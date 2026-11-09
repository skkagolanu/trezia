'use client';
import { societyFetch } from '@/lib/society-path';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OccupancyType, ResidentInvite, Unit } from '@/types/database';
import Tooltip from '@/components/ui/Tooltip';

type InviteRow = Pick<ResidentInvite, 'id' | 'email' | 'role' | 'unit_id' | 'created_at' | 'claimed_at'> & {
  flat_number?: string | null;
};

function accessExistsMessage(existingRole?: string | null): string {
  if (existingRole === 'treasurer') return 'This email is already authorized as Treasurer. Revoke it in the list below first if you want to change the role.';
  if (existingRole === 'resident') return 'This email is already authorized as a Resident. Revoke it in the list below first if you want to change the role.';
  return 'This email is already authorized here. Revoke it in the list below first if you want to change the role.';
}

export type AccessResidentOption = {
  id: string;
  unit_id: string;
  full_name: string;
  occupancy_type: OccupancyType;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

export default function AccessManagementCard({ invites, units, residents, loadError }: {
  invites: InviteRow[];
  units: Pick<Unit, 'id' | 'flat_number'>[];
  residents: AccessResidentOption[];
  loadError?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [source, setSource] = useState<'resident' | 'manual'>('resident');
  const [unitId, setUnitId] = useState('');
  const [residentId, setResidentId] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const eligible = useMemo(() => residents.filter(r => r.unit_id === unitId && r.email), [residents, unitId]);
  useEffect(() => {
    if (source !== 'resident') return;
    const preferred = eligible.find(r => r.is_primary) ?? eligible[0];
    setResidentId(preferred?.id ?? '');
  }, [eligible, source]);

  async function submit(confirmMismatch = false) {
    const payload = source === 'resident'
      ? { source, resident_id: residentId }
      : { source, unit_id: unitId, email, confirm_email_mismatch: confirmMismatch };
    try {
      const res = await societyFetch('/api/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null) as { error?: string; code?: string; login_url?: string; existingRole?: string | null } | null;
      if (res.status === 409 && body?.code === 'EMAIL_MISMATCH' && !confirmMismatch) {
        if (confirm(`${body.error ?? 'This email does not match an active resident on this flat.'}\n\nAuthorize it anyway?`)) return submit(true);
        return false;
      }
      if (res.status === 409 && body?.code === 'ACCESS_EXISTS') {
        setSubmitError(accessExistsMessage(body.existingRole));
        return false;
      }
      if (!res.ok) {
        if (body?.error) setSubmitError(res.status >= 500 ? `${body.error} Please try again.` : body.error);
        else setSubmitError('Failed to authorize resident access. Check your connection and try again.');
        return false;
      }
      setSuccess(body?.login_url ?? `${window.location.origin}/login`);
      setEmail(''); setResidentId('');
      startTransition(() => router.refresh());
      return true;
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try authorizing again.');
      return false;
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSubmitError(null); setSuccess(null); setAdding(true);
    try { await submit(); } finally { setAdding(false); }
  }

  async function handleRemove(id: string) {
    setListActionError(null);
    try {
      const res = await societyFetch(`/api/invites/${id}`, { method: 'DELETE' });
      if (!res.ok) { setListActionError('Failed to revoke access. Check your connection and try again.'); return; }
      startTransition(() => router.refresh());
    } catch {
      setListActionError('Could not reach the server. Check your connection and try revoking again.');
    }
  }

  const inputCls = 'h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]';
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
      <div className="border-b border-black/[0.06] px-4 py-4 sm:px-6">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-sf-label">
          Resident Access
          <Tooltip text="A resident gets access two ways: you authorize them here, or they submit a request from the public request-access page which you approve. Either way, the resident then signs in themselves." />
        </h3>
        <p className="mt-0.5 text-[13px] text-sf-label3">Authorize an email for one flat. No email is sent; give the resident the login link.</p>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex gap-2">
          {(['resident', 'manual'] as const).map(value => (
            <button key={value} type="button" onClick={() => { setSource(value); setSubmitError(null); }}
              className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium sm:flex-none ${source === value ? 'bg-sf-blue text-white' : 'bg-sf-bg text-sf-label2'}`}>
              {value === 'resident' ? 'Use resident on file' : 'Enter email manually'}
            </button>
          ))}
        </div>
        <form onSubmit={handleAdd} className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex w-full flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-sf-label3 sm:w-auto">
            Flat
            <select required value={unitId} onChange={e => setUnitId(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
              <option value="">Select flat…</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.flat_number}</option>)}
            </select>
          </label>
          {source === 'resident' ? (
            <label className="flex w-full min-w-0 flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-sf-label3 sm:w-auto sm:min-w-72">
              Resident
              <select required value={residentId} onChange={e => setResidentId(e.target.value)} className={`${inputCls} w-full sm:w-auto`} disabled={!eligible.length}>
                <option value="">{unitId && !eligible.length ? 'No active resident with email' : 'Select resident…'}</option>
                {eligible.map(r => <option key={r.id} value={r.id}>{r.full_name} · {r.occupancy_type.toLowerCase()} · {r.email}{r.phone ? ` · ${r.phone}` : ''}</option>)}
              </select>
            </label>
          ) : (
            <label className="flex w-full flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-sf-label3 sm:w-auto">
              Email
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className={`${inputCls} w-full sm:w-64`} placeholder="resident@example.com" />
            </label>
          )}
          <button disabled={adding || isPending || (source === 'resident' && !residentId)} className="h-9 w-full rounded-[var(--radius-md)] bg-sf-blue px-4 text-[14px] font-semibold text-white disabled:opacity-40 sm:w-auto">
            {adding ? 'Authorizing…' : 'Authorize resident'}
          </button>
        </form>
        {submitError && <p role="alert" aria-live="assertive" className="text-[13px] text-sf-red">{submitError}</p>}
        {unitId && source === 'resident' && !eligible.length && <p className="text-[13px] text-sf-orange">Add an email to an active resident record, or use manual email entry.</p>}
        {success && <div className="rounded-[10px] bg-sf-green/[0.08] p-3 text-[13px] text-sf-label2">Access authorized. Ask them to open <button type="button" className="font-semibold text-sf-blue underline" onClick={() => navigator.clipboard.writeText(success)}>copy login link</button> and use the authorized email.<Tooltip text="This copies the app's normal sign-in page, not a personal magic link. The resident enters their own authorized email there and gets their own one-tap login link." /></div>}
        {listActionError && <p role="alert" aria-live="assertive" className="text-[13px] text-sf-red">{listActionError}</p>}
        <InviteTable invites={invites} onRemove={handleRemove} disabled={isPending} loadError={loadError} />
      </div>
    </div>
  );
}

export function InviteTable({ invites, onRemove, disabled, loadError }: { invites: InviteRow[]; onRemove: (id: string) => void; disabled: boolean; loadError?: string | null }) {
  if (loadError) return <p className="text-[13px] text-sf-red">{loadError}</p>;
  if (!invites.length) return <p className="text-[13px] text-sf-label3">No authorized accounts yet.</p>;
  return <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--sf-border)]"><table className="w-full text-[13px]"><thead><tr className="bg-sf-bg text-left text-sf-label2"><th className="px-4 py-2">Email</th><th className="px-4 py-2">Flat</th><th className="px-4 py-2"><span className="inline-flex items-center gap-1.5">Status<Tooltip text="Pending means the person has been authorized but has not signed in yet. Active means they have signed in and their access is live." /></span></th><th /></tr></thead><tbody className="divide-y divide-sf-divider">{invites.map(inv => <tr key={inv.id}><td className="px-4 py-3">{inv.email}</td><td className="px-4 py-3">{inv.flat_number ?? '—'}</td><td className="px-4 py-3">{inv.claimed_at ? 'Active' : 'Pending'}</td><td className="px-4 py-3 text-right"><button disabled={disabled} onClick={() => onRemove(inv.id)} className="text-sf-red disabled:opacity-40">Revoke</button></td></tr>)}</tbody></table></div>;
}
