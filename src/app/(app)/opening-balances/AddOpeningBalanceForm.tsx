'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { fyStartYearOf } from '@/lib/utils/period';

export default function AddOpeningBalanceForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    fy_start_year: String(fyStartYearOf(new Date())),
    bank_balance:  '',
    cash_in_hand:  '',
    notes:         '',
  });
  const [loading, setLoading] = useState(false);

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fy_start_year || form.bank_balance === '' || form.cash_in_hand === '') {
      toast.error('FY, bank balance, and cash in hand are required');
      return;
    }
    setLoading(true);
    try {
      const res = await societyFetch('/api/opening-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fy_start_year: Number(form.fy_start_year),
          bank_balance:  Number(form.bank_balance),
          cash_in_hand:  Number(form.cash_in_hand),
          notes:         form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      toast.success('Opening balance saved');
      setForm({ fy_start_year: String(fyStartYearOf(new Date())), bank_balance: '', cash_in_hand: '', notes: '' });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form data-society-write onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <Input
          label="FY Start Year"
          type="number"
          value={form.fy_start_year}
          onChange={handleChange('fy_start_year')}
          placeholder="e.g. 2026 for FY 2026–27"
          min="2020"
          max="2100"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Input
          label="Bank Balance (₹)"
          type="number"
          value={form.bank_balance}
          onChange={handleChange('bank_balance')}
          placeholder="0.00"
          min="0"
          step="0.01"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Input
          label="Cash in Hand (₹)"
          type="number"
          value={form.cash_in_hand}
          onChange={handleChange('cash_in_hand')}
          placeholder="0.00"
          min="0"
          step="0.01"
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
        <Button type="submit" loading={loading}>Save Opening Balance</Button>
      </div>
    </form>
  );
}
