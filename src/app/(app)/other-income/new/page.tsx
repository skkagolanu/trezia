'use client';
import { societyFetch } from '@/lib/society-path';

import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { useRouter } from 'next/navigation';
import { useSocietyPath } from '@/lib/hooks/use-society-path';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { OtherIncomeSchema } from '@/lib/validation/schemas';
import { todayISO } from '@/lib/utils/date';

const CATEGORY_OPTIONS = [
  { value: 'MAINTENANCE',     label: 'Maintenance' },
  { value: 'CMC',             label: 'AMC' },
  { value: 'PENALTY',         label: 'Penalty' },
  { value: 'AD_BOARD_INCOME', label: 'Ad Board Income' },
  { value: 'CORPUS_FUND',     label: 'Corpus Fund' },
  { value: 'OTHER_INCOME',    label: 'Other' },
];

type FieldErrors = Partial<Record<string, string>>;

export default function NewOtherIncomePage() {
  const router = useRouter();
  const scoped = useSocietyPath();

  const [form, setForm] = useState({
    income_date:      todayISO(),
    category:         '',
    description:      '',
    amount:           '',
    received_via:     '',
    reference_number: '',
    notes:            '',
  });

  const [errors, setErrors]   = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      setErrors(prev => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const parsed = OtherIncomeSchema.safeParse({
      income_date:      form.income_date,
      category:         form.category,
      description:      form.description,
      amount:           form.amount === '' ? undefined : Number(form.amount),
      received_via:     form.received_via     || undefined,
      reference_number: form.reference_number || undefined,
      notes:            form.notes            || undefined,
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as string;
        if (key) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await societyFetch('/api/other-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      toast.success('Income recorded');
      router.push(scoped('/other-income'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-society-write className="flex flex-col">
      <PageHeader title="Add Other Income" />

      <div className="flex-1 p-6">
        <Card className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Date"
                type="date"
                value={form.income_date}
                onChange={handleChange('income_date')}
                error={errors.income_date}
                required
              />
              <Select
                label="Category"
                value={form.category}
                onChange={handleChange('category')}
                options={CATEGORY_OPTIONS}
                placeholder="Select category…"
                error={errors.category}
                required
              />
            </div>

            <Input
              label="Description"
              type="text"
              value={form.description}
              onChange={handleChange('description')}
              error={errors.description}
              placeholder="Brief description"
              required
            />

            <Input
              label="Amount (₹)"
              type="number"
              value={form.amount}
              onChange={handleChange('amount')}
              error={errors.amount}
              placeholder="0.00"
              min="0.01"
              step="0.01"
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Received Via"
                type="text"
                value={form.received_via}
                onChange={handleChange('received_via')}
                error={errors.received_via}
                placeholder="bank / cash / UPI"
                hint="Optional"
              />
              <Input
                label="Reference Number"
                type="text"
                value={form.reference_number}
                onChange={handleChange('reference_number')}
                error={errors.reference_number}
                placeholder="Transaction / receipt number"
                hint="Optional"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-sf-label">Notes</label>
              <textarea
                value={form.notes}
                onChange={handleChange('notes')}
                rows={3}
                placeholder="Any additional details…"
                className="block w-full rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2.5 text-[14px] text-sf-label placeholder:text-sf-label3 transition-all hover:border-black/[0.28] focus:outline-none focus:ring-2 focus:ring-sf-blue resize-none"
              />
              {errors.notes && <p className="text-[12px] text-sf-red">{errors.notes}</p>}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" loading={loading}>Save Income</Button>
              <Button type="button" variant="secondary" onClick={() => router.push(scoped('/other-income'))} disabled={loading}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
