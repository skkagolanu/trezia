'use client';
import { societyApiPath, societyFetch } from '@/lib/society-path';
import { startTransition, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

const PAYMENT_MODES = ['UPI', 'MANUAL_COLLECTION', 'BANK_TRANSFER', 'OTHER'] as const;

type Props = {
  id: string;
  amountPaid: number;
  paymentDate: string | null;
  notes: string | null;
  paymentMode: string;
  onOptimisticVoid?: () => void;
  onVoidFail?: () => void;
};

export default function LevyRowActions({ id, amountPaid, paymentDate, notes, paymentMode, onOptimisticVoid, onVoidFail }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm-void'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [form, setForm] = useState({
    amount_paid:  String(amountPaid),
    payment_date: paymentDate ?? '',
    notes:        notes ?? '',
    payment_mode: paymentMode,
  });

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await societyFetch(`/api/levies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
      setMode('idle');
      toast.success('Payment updated');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid() {
    if (voidReason.trim().length < 10) { setError('Enter a reason (min 10 characters)'); return; }
    setSaving(true);
    setError('');
    setMode('idle');
    onOptimisticVoid?.();
    try {
      const res = await societyFetch(`/api/levies/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ void_reason: voidReason.trim() }),
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json();
        throw new Error(j.error ?? 'Void failed');
      }
      toast.success('Payment voided');
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Void failed');
      onVoidFail?.();
      setSaving(false);
    }
  }

  const pdfHref = societyApiPath(pathname, `/api/pdf/levy?id=${id}`);

  return (
    <>
      <div className="flex items-center gap-0.5">
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors"
          title="View receipt PDF"
        >
          PDF
        </a>
        <button
          data-society-write
          onClick={() => setMode('edit')}
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors"
        >
          Edit
        </button>
        <button
          data-society-write
          onClick={() => { setVoidReason(''); setError(''); setMode('confirm-void'); }}
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-red hover:bg-sf-red/[0.08] transition-colors"
        >
          Void
        </button>
      </div>

      {mode === 'edit' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setMode('idle')}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-xl)] bg-[var(--sf-surface)] p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[var(--text-md)] font-semibold text-[var(--sf-label)] mb-4">Edit AMC Payment</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={form.amount_paid}
                  onChange={e => setForm(f => ({ ...f, amount_paid: e.target.value }))}
                  className="w-full h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]"
                />
              </div>
              <div>
                <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Payment Date</label>
                <input
                  type="date"
                  value={form.payment_date}
                  onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
                  className="w-full h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]"
                />
              </div>
              <div>
                <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Mode</label>
                <div className="relative">
                  <select
                    value={form.payment_mode}
                    onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}
                    className="w-full h-9 appearance-none rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] pl-3 pr-7 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]"
                  >
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--sf-label3)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 6 8 10 12 6" /></svg>
                </div>
              </div>
              <div>
                <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional note"
                  className="w-full h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]"
                />
              </div>
            </div>
            {error && <p role="alert" className="mt-3 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-9 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setMode('idle'); setError(''); }}
                disabled={saving}
                className="h-9 px-4 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'confirm-void' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setMode('idle')}
        >
          <div
            className="w-full max-w-xs rounded-[var(--radius-xl)] bg-[var(--sf-surface)] p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[var(--text-md)] font-semibold text-[var(--sf-label)] mb-2">Void AMC payment?</p>
            <p className="text-[var(--text-sm)] text-[var(--sf-label2)] mb-4">
              This cannot be undone. Please give a reason.
            </p>
            <textarea
              value={voidReason}
              onChange={e => { setVoidReason(e.target.value); setError(''); }}
              rows={2}
              placeholder="e.g. Entered by mistake, wrong amount"
              className="w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)] resize-none"
            />
            {error && <p role="alert" className="mt-2 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleVoid}
                disabled={saving}
                className="flex-1 h-9 rounded-[var(--radius-md)] bg-[var(--sf-red)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? 'Voiding…' : 'Void'}
              </button>
              <button
                onClick={() => { setMode('idle'); setError(''); setVoidReason(''); }}
                disabled={saving}
                className="h-9 px-4 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
