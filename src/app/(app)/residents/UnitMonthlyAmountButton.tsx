'use client';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { societyFetch } from '@/lib/society-path';

export default function UnitMonthlyAmountButton({ unitId, flatNumber, amount }: {
  unitId: string;
  flatNumber: string;
  amount: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(amount == null ? '' : String(amount));
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await societyFetch('/api/units/monthly-amount', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId, monthly_amount: value === '' ? null : Number(value) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The monthly amount was not changed.');
      toast.success(`Monthly amount updated for ${flatNumber}`);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The monthly amount was not changed. Refresh and try again.');
    } finally { setSaving(false); }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08]">
      Set amount
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title={`Monthly amount · ${flatNumber}`} size="sm">
      <form onSubmit={save} className="space-y-4">
        <Input label="Monthly amount (₹)" type="number" min="0" max="1000000" step="0.01" value={value} onChange={event => setValue(event.target.value)} hint="Leave blank to use the society default" />
        <p className="text-[var(--text-xs)] text-sf-label3">This changes future bill defaults only. Issued bills are not rewritten.</p>
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={saving}>Save amount</Button></div>
      </form>
    </Modal>
  </>;
}
