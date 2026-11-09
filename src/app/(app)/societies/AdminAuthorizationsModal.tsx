'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

type Authorization = {
  id: string;
  email: string;
  created_at: string;
  claimed_at: string | null;
};

export default function AdminAuthorizationsModal({
  society,
  open,
  readOnly,
  onClose,
  onChanged,
}: {
  society: { id: string; name: string } | null;
  open: boolean;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [loginUrl, setLoginUrl] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!society) return;
    setLoading(true);
    setLoadError('');
    const response = await fetch(`/api/platform/societies/${society.id}/admins`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error ?? 'Could not load Admin access';
      setLoadError(message);
      toast.error(message);
    }
    else {
      setAuthorizations(body.authorizations ?? []);
      setLoginUrl(body.login_url ?? '');
    }
    setLoading(false);
  }, [society]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  async function authorize(event: React.FormEvent) {
    event.preventDefault();
    if (!society) return;
    setSaving(true);
    const response = await fetch(`/api/platform/societies/${society.id}/admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(body.error ?? 'Could not authorize Admin access');
    setEmail('');
    setLoginUrl(body.login_url ?? loginUrl);
    toast.success('Admin access authorized');
    await Promise.all([load(), onChanged()]);
  }

  async function revoke(authorization: Authorization) {
    if (!society) return;
    const response = await fetch(`/api/platform/societies/${society.id}/admins/${authorization.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return toast.error(body.error ?? 'Could not revoke Admin access');
    }
    toast.success('Admin access revoked');
    await Promise.all([load(), onChanged()]);
  }

  return (
    <Modal open={open} onClose={onClose} title={society ? `${society.name} Admins` : 'Society Admins'}>
      <div className="space-y-5">
        {readOnly ? (
          <p className="rounded-[10px] border border-sf-orange/20 bg-sf-orange/[0.08] p-3 text-sm text-sf-orange">Reactivate this society before changing Admin access.</p>
        ) : <form onSubmit={authorize} className="flex items-end gap-2">
          <div className="flex-1"><Input label="Admin email" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
          <Button type="submit" loading={saving}>Authorize</Button>
        </form>}
        <p className="text-xs text-sf-label3">No email is sent. Ask the Admin to request a magic link at {loginUrl || '/login'} using the authorized address.</p>
        {loadError && <p role="alert" className="text-sm text-sf-red">{loadError}</p>}
        <div aria-live="polite" className="max-h-72 space-y-2 overflow-y-auto">
          {loading ? <p className="text-sm text-sf-label3">Loading…</p> : authorizations.length === 0 ? (
            <p className="rounded-[10px] bg-sf-bg p-3 text-sm text-sf-label3">No additional Admin authorizations.</p>
          ) : authorizations.map(authorization => (
            <div key={authorization.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-sf-border px-3 py-2">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-sf-label">{authorization.email}</p><p className="text-xs text-sf-label3">{authorization.claimed_at ? 'Active account' : 'Awaiting first login'}</p></div>
              {!readOnly && <Button type="button" size="sm" variant="danger" onClick={() => void revoke(authorization)}>Revoke</Button>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
