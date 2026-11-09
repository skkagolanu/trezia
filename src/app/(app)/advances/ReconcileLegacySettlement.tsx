'use client';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import { societyFetch } from '@/lib/society-path';
import type { BillOption } from './SettleAdvanceButton';

export default function ReconcileLegacySettlement({ settlementId, bills }: { settlementId: string; bills: BillOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [billId, setBillId] = useState('');
  const [note, setNote] = useState('');

  async function submit(body: { bill_id?: string; historical_note?: string }) {
    setSaving(true);
    try {
      const response = await societyFetch('/api/advance-settlements/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlement_id: settlementId, ...body }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The legacy settlement was not reconciled.');
      toast.success(body.bill_id ? 'Settlement linked to bill' : 'Settlement marked as historical');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The legacy settlement was not reconciled. Refresh and try again.');
    } finally { setSaving(false); }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded px-2 py-1 text-[12px] font-medium text-sf-blue hover:bg-sf-blue/[0.08]">Resolve</button>
    <Modal open={open} onClose={() => !saving && setOpen(false)} title="Resolve legacy settlement" size="sm">
      <div className="space-y-5">
        <p className="text-[13px] text-sf-label2">This settlement was recorded before bill links existed. Link it once to the bill it paid, or preserve it as an explained historical entry.</p>
        <Select label="Eligible bill" value={billId} onChange={event => setBillId(event.target.value)} placeholder="Choose a bill" options={bills.map(bill => ({ value: bill.id, label: `${bill.label} — ₹${bill.remaining.toLocaleString('en-IN')} owed` }))} />
        <Button disabled={!billId} loading={saving} onClick={() => submit({ bill_id: billId })}>Link and apply settlement</Button>
        <div className="border-t border-black/[0.08] pt-4">
          <label className="mb-1.5 block text-[13px] font-medium text-sf-label">Historical explanation</label>
          <textarea value={note} onChange={event => setNote(event.target.value)} minLength={10} maxLength={500} rows={3} className="w-full rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-sf-blue" placeholder="Explain why no reliable bill link can be made" />
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button disabled={note.trim().length < 10} loading={saving} onClick={() => submit({ historical_note: note.trim() })}>Mark historical</Button></div>
        </div>
      </div>
    </Modal>
  </>;
}
