'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { societyFetch } from '@/lib/society-path';

type Props = {
  claimId: string;
};

// A resident withdrawing their own PENDING submission — e.g. they uploaded the
// wrong screenshot or want to correct the amount before the treasurer reviews
// it. Retraction is terminal (migration 066); the resident submits a fresh
// claim afterward rather than editing this one.
export default function RetractClaimButton({ claimId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleRetract() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await societyFetch(`/api/payments/claim/${claimId}/retract`, { method: 'POST' });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? 'Could not withdraw this submission.');
    } catch {
      setError('Could not withdraw this submission.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleRetract()}
        disabled={busy}
        className="text-[var(--text-xs)] font-medium text-[var(--sf-label3)] underline decoration-dotted underline-offset-2 hover:text-[var(--sf-red)] disabled:opacity-50"
      >
        {busy ? 'Withdrawing…' : 'Withdraw'}
      </button>
      {error && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{error}</p>}
    </div>
  );
}
