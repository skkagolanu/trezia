'use client';
import { societyFetch } from '@/lib/society-path';
import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { formatINR } from '@/lib/utils/currency';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type Props = {
  unitId: string;
  flatNumber: string;
  levyLabel: string;
  defaultAmount: number;
  residentId?: string | null;
};

const MODES = ['UPI','MANUAL_COLLECTION','BANK_TRANSFER','OTHER'] as const;
const inputCls = 'w-full h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]';

export default function RecordLevyPaymentButton({ unitId, flatNumber, levyLabel, defaultAmount, residentId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    amount_paid:  defaultAmount > 0 ? String(defaultAmount) : '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_mode: 'MANUAL_COLLECTION',
    notes:        '',
  });

  async function handleSave() {
    setSaving(true);
    setError('');
    setOpen(false);
    try {
      const res = await societyFetch('/api/levies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId, levy_label: levyLabel, resident_id: residentId ?? undefined, ...form }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
      toast.success(`${levyLabel} recorded for flat ${flatNumber}`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        data-society-write
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] border border-[var(--sf-blue)]/30 bg-[var(--sf-blue)]/[0.06] px-3 py-1 text-[var(--text-xs)] font-semibold text-[var(--sf-blue)] hover:bg-[var(--sf-blue)]/[0.12] transition-colors duration-75"
      >
        {flatNumber} — Record
      </button>

      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`Record ${levyLabel}`} size="sm">
        <div className="space-y-3">
          <p className="text-[var(--text-xs)] text-[var(--sf-label3)] -mt-2">Flat {flatNumber} · Default {formatINR(defaultAmount)}</p>
          <div>
            <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Amount (₹)</label>
            <input type="number" value={form.amount_paid}
              onChange={e => setForm(f => ({ ...f, amount_paid: e.target.value }))}
              className={inputCls} autoFocus />
          </div>
          <div>
            <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Payment Date</label>
            <input type="date" value={form.payment_date}
              onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Payment Mode</label>
            <select value={form.payment_mode}
              onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}
              className={inputCls}>
              {MODES.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[var(--text-xs)] text-[var(--sf-label3)] mb-1">Notes (optional)</label>
            <input type="text" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. partial payment, cheque no."
              className={inputCls} />
          </div>
          {error && <p role="alert" className="text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button onClick={handleSave} loading={saving} className="flex-1">Save Payment</Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
