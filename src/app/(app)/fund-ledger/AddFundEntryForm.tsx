'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { todayISO } from '@/lib/utils/date';
import type { FundType, FundEntryType } from '@/types/database';

const ENTRY_TYPE_OPTIONS = [
  { value: 'CONTRIBUTION', label: 'Contribution (in)' },
  { value: 'INTEREST',     label: 'Interest credited (in)' },
  { value: 'OUTFLOW',      label: 'Outflow (out)' },
];

export default function AddFundEntryForm({ fundType }: { fundType: FundType }) {
  const router = useRouter();
  const [form, setForm] = useState({
    entry_type: '' as FundEntryType | '',
    amount:     '',
    entry_date: todayISO(),
    notes:      '',
  });
  const [loading, setLoading] = useState(false);

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entry_type || !form.amount || !form.entry_date) {
      toast.error('Entry type, amount, and date are required');
      return;
    }
    setLoading(true);
    try {
      const res = await societyFetch('/api/fund-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fund_type:  fundType,
          entry_type: form.entry_type,
          amount:     Number(form.amount),
          entry_date: form.entry_date,
          notes:      form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      toast.success('Entry recorded');
      setForm({ entry_type: '', amount: '', entry_date: todayISO(), notes: '' });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form data-society-write onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1 min-w-48">
        <Select
          label="Entry Type"
          value={form.entry_type}
          onChange={handleChange('entry_type')}
          options={ENTRY_TYPE_OPTIONS}
          placeholder="Select…"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Input
          label="Amount (₹)"
          type="number"
          value={form.amount}
          onChange={handleChange('amount')}
          placeholder="0.00"
          min="0.01"
          step="0.01"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Input
          label="Date"
          type="date"
          value={form.entry_date}
          onChange={handleChange('entry_date')}
          required
        />
      </div>
      <div className="flex flex-col gap-1 min-w-48">
        <Input
          label="Notes"
          type="text"
          value={form.notes}
          onChange={handleChange('notes')}
          placeholder="Optional note"
        />
      </div>
      <div className="pb-0.5">
        <Button type="submit" loading={loading}>Add Entry</Button>
      </div>
    </form>
  );
}
