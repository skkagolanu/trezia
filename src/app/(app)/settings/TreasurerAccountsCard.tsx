'use client';
import { societyFetch } from '@/lib/society-path';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ResidentInvite } from '@/types/database';
import { InviteTable } from './AccessManagementCard';
import Tooltip from '@/components/ui/Tooltip';

type InviteRow = Pick<ResidentInvite, 'id' | 'email' | 'role' | 'unit_id' | 'created_at' | 'claimed_at'>;

function accessExistsMessage(existingRole?: string | null): string {
  if (existingRole === 'treasurer') return 'This email is already authorized as Treasurer. Revoke it in the list below first if you want to change the role.';
  if (existingRole === 'resident') return 'This email is already authorized as a Resident. Revoke it in the list below first if you want to change the role.';
  return 'This email is already authorized here. Revoke it in the list below first if you want to change the role.';
}

export default function TreasurerAccountsCard({ invites, loadError }: { invites: InviteRow[]; loadError?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoginUrl(null);
    if (!email) return;
    if (!confirm(`Give ${email} full Treasurer access to all society money?\n\nThey will be able to record payments, record expenses, and see every report. Only continue for a committee finance handler.`)) return;
    const res = await societyFetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'treasurer', email }) });
    const body = await res.json().catch(() => ({})) as { error?: string; login_url?: string; code?: string; existingRole?: string | null };
    if (!res.ok) {
      if (res.status === 409 && body.code === 'ACCESS_EXISTS') { setError(accessExistsMessage(body.existingRole)); return; }
      setError(body.error ?? 'Failed to authorize Treasurer'); return;
    }
    setEmail(''); setLoginUrl(body.login_url ?? `${window.location.origin}/login`); startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    const res = await societyFetch(`/api/invites/${id}`, { method: 'DELETE' });
    if (!res.ok) { setError('Failed to revoke Treasurer access'); return; }
    startTransition(() => router.refresh());
  }

  return <div className="rounded-2xl border border-black/[0.07] bg-sf-surface"><div className="border-b border-black/[0.06] px-6 py-4"><h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-sf-label">Treasurer Accounts — full financial access<Tooltip text="A Treasurer can record payments and expenses and see reports. A Treasurer cannot manage access, society settings, flats, or backups." /></h3><p className="mt-0.5 text-[13px] text-sf-label3">Authorize an email as Treasurer. No email is sent; give them the login link. Treasurers can operate the books but cannot manage access or policy settings.</p></div><div className="space-y-4 p-6"><div className="rounded-[10px] border border-sf-orange/20 bg-[color-mix(in_srgb,var(--sf-orange)_8%,transparent)] p-3 text-[13px] text-sf-orange"><strong className="font-semibold">High-trust access:</strong> Treasurers can view AND edit all society money — payments, expenses, bills, and reports. Only authorize a committee member who handles the society&apos;s finances.</div><form onSubmit={add} className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-wide text-sf-label3">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="h-9 w-64 rounded-[var(--radius-md)] border border-sf-border px-3 text-[14px]" /></label><button disabled={pending} className="h-9 rounded-[var(--radius-md)] bg-sf-blue px-4 text-[14px] font-semibold text-white disabled:opacity-40">Authorize Treasurer</button></form>{loginUrl && <p className="text-[13px] text-sf-label2">Authorized. <button className="font-semibold text-sf-blue underline" onClick={() => navigator.clipboard.writeText(loginUrl)}>Copy login link</button></p>}{error && <p className="text-[13px] text-sf-red">{error}</p>}<InviteTable invites={invites} onRemove={remove} disabled={pending} loadError={loadError} /></div></div>;
}
