'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { todayISO } from '@/lib/utils/date';
import type { AdvanceKind } from '@/types/database';

export type BillOption = { id: string; label: string; remaining: number };

interface Props {
  advanceKind: AdvanceKind;
  advanceId: string;
  remaining: number;
  /** Candidate bills this advance could settle. Empty for expense advances — the
   * RPC rejects a bill_id on those (EXPENSE_ADVANCE_HAS_NO_BILL). */
  bills?: BillOption[];
}

// Records one settlement event against an advance. Mirrors
// VoidButton's self-contained modal pattern — router.refresh() on success,
// no parent state needed.
export default function SettleAdvanceButton({ advanceKind, advanceId, remaining, bills = [] }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    settled_amount:  String(remaining),
    settled_against: '',
    settled_date:    todayISO(),
    bill_id:         '',
  });

  function handleChange(field: 'settled_amount' | 'settled_against' | 'settled_date') {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
    };
  }

  function handleBillChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const bill_id = e.target.value;
    const selected = bills.find(b => b.id === bill_id);
    setForm(prev => ({
      ...prev,
      bill_id,
      // Pre-fill the amount to what the bill actually needs, capped at what's
      // left on the advance, so a treasurer settling a whole bill doesn't have
      // to do the subtraction by hand. Left untouched when clearing the pick.
      settled_amount: selected ? String(Math.min(selected.remaining, remaining)) : prev.settled_amount,
      settled_against: selected ? `Bill ${selected.label}` : prev.settled_against,
    }));
  }

  async function handleSubmit() {
    if (!form.settled_amount || form.settled_against.trim().length < 3 || !form.settled_date) {
      toast.error('Amount, what it was applied against, and date are required');
      return;
    }
    setLoading(true);
    try {
      const res = await societyFetch('/api/advance-settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advance_kind:    advanceKind,
          advance_id:      advanceId,
          settled_amount:  Number(form.settled_amount),
          settled_against: form.settled_against.trim(),
          settled_date:    form.settled_date,
          bill_id:         form.bill_id || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      toast.success('Settlement recorded');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        data-society-write
        onClick={() => { setForm({ settled_amount: String(remaining), settled_against: '', settled_date: todayISO(), bill_id: '' }); setOpen(true); }}
        className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-sf-blue hover:bg-sf-blue/10 transition-colors"
      >
        Settle
      </button>

      <Modal open={open} onClose={() => !loading && setOpen(false)} title="Record Settlement" size="sm">
        <div className="space-y-4">
          {bills.length > 0 && (
            <Select
              label="Settle Against a Bill"
              value={form.bill_id}
              onChange={handleBillChange}
              placeholder="No specific bill (note only)"
              options={bills.map(b => ({ value: b.id, label: `${b.label} — ₹${b.remaining.toLocaleString('en-IN')} owed` }))}
              hint="Picking a bill applies this settlement to it directly. If the amount covers what's left, the bill is marked paid."
            />
          )}
          <Input
            label="Amount Settled (₹)"
            type="number"
            value={form.settled_amount}
            onChange={handleChange('settled_amount')}
            min="0.01"
            max={String(remaining)}
            step="0.01"
            hint={`Remaining before this settlement: ₹${remaining.toLocaleString('en-IN')}`}
            required
          />
          <Input
            label="Applied Against"
            type="text"
            value={form.settled_against}
            onChange={handleChange('settled_against')}
            placeholder="e.g. May 2026 maintenance bill"
            required
          />
          <Input
            label="Date"
            type="date"
            value={form.settled_date}
            onChange={handleChange('settled_date')}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} loading={loading}>Confirm Settlement</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
