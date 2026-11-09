'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import { societyFetch } from '@/lib/society-path';
import { todayISO } from '@/lib/utils/date';
import type { TreasurerHandover } from '@/types/database';

type Props = {
  handover?: TreasurerHandover;
  mode: 'create' | 'edit';
};

type FormState = {
  handover_date: string;
  outgoing_treasurer: string;
  incoming_treasurer: string;
  bank_balance: string;
  cash_in_hand: string;
  outstanding_receivables_note: string;
  notes: string;
};

function initialForm(handover?: TreasurerHandover): FormState {
  return {
    handover_date: handover?.handover_date ?? todayISO(),
    outgoing_treasurer: handover?.outgoing_treasurer ?? '',
    incoming_treasurer: handover?.incoming_treasurer ?? '',
    bank_balance: handover?.bank_balance == null ? '' : String(handover.bank_balance),
    cash_in_hand: handover?.cash_in_hand == null ? '' : String(handover.cash_in_hand),
    outstanding_receivables_note: handover?.outstanding_receivables_note ?? '',
    notes: handover?.notes ?? '',
  };
}

export default function HandoverForm({ handover, mode }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialForm(handover));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(handover));
    setError('');
  }, [handover, open]);

  function setField(field: keyof FormState) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm(current => ({ ...current, [field]: event.target.value }));
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const response = await societyFetch(
        isEdit && handover ? `/api/handovers/${encodeURIComponent(handover.id)}` : '/api/handovers',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handover_date: form.handover_date,
            outgoing_treasurer: form.outgoing_treasurer.trim(),
            incoming_treasurer: form.incoming_treasurer.trim(),
            bank_balance: form.bank_balance === '' ? null : Number(form.bank_balance),
            cash_in_hand: form.cash_in_hand === '' ? null : Number(form.cash_in_hand),
            outstanding_receivables_note: form.outstanding_receivables_note.trim() || null,
            notes: form.notes.trim() || null,
          }),
        },
      );
      const result = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(result.error ?? 'Unable to save the handover. Please try again.');

      toast.success(isEdit ? 'Handover updated' : 'Handover recorded');
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the handover. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={isEdit ? 'secondary' : 'primary'}
        size={isEdit ? 'sm' : 'md'}
        className={isEdit ? 'min-h-11' : 'min-h-11 w-full sm:w-auto'}
        onClick={() => setOpen(true)}
      >
        {isEdit ? <Pencil size={14} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        {isEdit ? 'Edit' : 'Record handover'}
      </Button>

      <Drawer open={open} onClose={() => setOpen(false)} title={isEdit ? 'Edit handover' : 'Record handover'}>
        <form data-society-write onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <Input label="Handover date" type="date" value={form.handover_date} onChange={setField('handover_date')} required className="min-h-11" />
          <Input label="Outgoing treasurer" value={form.outgoing_treasurer} onChange={setField('outgoing_treasurer')} minLength={2} maxLength={150} required className="min-h-11" />
          <Input label="Incoming treasurer" value={form.incoming_treasurer} onChange={setField('incoming_treasurer')} minLength={2} maxLength={150} required className="min-h-11" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Bank balance" type="number" prefix="₹" value={form.bank_balance} onChange={setField('bank_balance')} min="0" max="50000000" step="0.01" inputMode="decimal" className="min-h-11" />
            <Input label="Cash in hand" type="number" prefix="₹" value={form.cash_in_hand} onChange={setField('cash_in_hand')} min="0" max="5000000" step="0.01" inputMode="decimal" className="min-h-11" />
          </div>
          <div>
            <label htmlFor={`handover-receivables-${handover?.id ?? 'new'}`} className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Outstanding and receivables</label>
            <textarea id={`handover-receivables-${handover?.id ?? 'new'}`} value={form.outstanding_receivables_note} onChange={setField('outstanding_receivables_note')} rows={4} maxLength={2000} className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-[max(16px,var(--text-base))] text-[var(--sf-label)] outline-none focus:ring-2 focus:ring-[var(--sf-blue)]" placeholder="Uncollected dues, pending reimbursements, or reconciliation notes" />
          </div>
          <div>
            <label htmlFor={`handover-notes-${handover?.id ?? 'new'}`} className="mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Notes</label>
            <textarea id={`handover-notes-${handover?.id ?? 'new'}`} value={form.notes} onChange={setField('notes')} rows={4} maxLength={2000} className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-[max(16px,var(--text-base))] text-[var(--sf-label)] outline-none focus:ring-2 focus:ring-[var(--sf-blue)]" placeholder="Optional documents, keys, or follow-up details" />
          </div>
          {error && <p role="alert" className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-red)_6%,var(--sf-surface))] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--sf-divider)] pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" className="min-h-11" isLoading={saving}>{isEdit ? 'Save changes' : 'Record handover'}</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
