'use client';
import { societyFetch } from '@/lib/society-path';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSocietyPath } from '@/lib/hooks/use-society-path';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tooltip from '@/components/ui/Tooltip';
import RecordedByHint from '@/components/forms/RecordedByHint';
import { ExpenseSchema } from '@/lib/validation/schemas';
import { todayISO } from '@/lib/utils/date';
import type { ExpenseCategory } from '@/types/database';

const CATEGORY_OPTIONS = [
  { value: 'SECURITY_AGENCY',   label: 'Security Agency' },
  { value: 'WATCHMAN_SALARY',   label: 'Watchman Salary' },
  { value: 'ELECTRICITY',       label: 'Electricity' },
  { value: 'WATER_MUNICIPAL',   label: 'Water / Municipal' },
  { value: 'GARBAGE',           label: 'Garbage' },
  { value: 'GENERATOR_DIESEL',  label: 'Generator Diesel' },
  { value: 'LIFT_AMC',          label: 'Lift AMC' },
  { value: 'LIFT_REPAIR',       label: 'Lift Repair' },
  { value: 'PLUMBING',          label: 'Plumbing' },
  { value: 'ELECTRICAL_REPAIR', label: 'Electrical Repair' },
  { value: 'CLEANING_SUPPLIES', label: 'Cleaning Supplies' },
  { value: 'STATIONERY',        label: 'Stationery' },
  { value: 'INTERNET',          label: 'Internet' },
  { value: 'MOBILE_RECHARGE',   label: 'Mobile Recharge' },
  { value: 'BANK_CHARGES',      label: 'Bank Charges' },
  { value: 'AUDIT',             label: 'Audit' },
  { value: 'LEGAL',             label: 'Legal' },
  { value: 'EVENT',             label: 'Event' },
  { value: 'ADVANCE_PAYMENT',   label: 'Advance Payment' },
  { value: 'CORPUS_FUND_PAYMENT', label: 'Corpus Fund Payment' },
  { value: 'MISC',              label: 'Misc' },
];

type FieldErrors = Partial<Record<string, string>>;
interface Props { onSuccess?: () => void; }

export default function ExpenseForm({ onSuccess }: Props) {
  const router = useRouter();
  const scoped = useSocietyPath();
  const [form, setForm] = useState({
    expense_date: todayISO(), category: '' as ExpenseCategory | '',
    description: '', amount: '', paid_via: '', payee_name: '', reference_number: '', notes: '',
  });
  const [errors,  setErrors]  = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      setErrors(prev => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = ExpenseSchema.safeParse({
      expense_date: form.expense_date, category: form.category,
      description: form.description,
      amount: form.amount === '' ? undefined : Number(form.amount),
      paid_via: form.paid_via || undefined, payee_name: form.payee_name || undefined,
      reference_number: form.reference_number || undefined, notes: form.notes || undefined,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const i of parsed.error.issues) { const k = i.path[0] as string; if (k) fe[k] = i.message; }
      setErrors(fe); return;
    }
    setLoading(true);
    try {
      const res = await societyFetch('/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `Error ${res.status}`); }
      toast.success('Expense recorded');
      if (onSuccess) { onSuccess(); } else { router.push(scoped('/expenses')); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save expense');
    } finally { setLoading(false); }
  }

  return (
    <form data-society-write onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 min-w-0">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Input label="Date *" type="date" value={form.expense_date} onChange={set('expense_date')} error={errors.expense_date} required />
        <Select label="Category *" value={form.category} onChange={set('category')} options={CATEGORY_OPTIONS} placeholder="Select…" error={errors.category} required
          tooltip={<Tooltip text="Lift AMC is the lift's annual maintenance contract. Corpus Fund uses the society reserve. Advance means paying before the goods or service are received." />}
        />
      </div>

      <RecordedByHint date={form.expense_date} />

      <Input label="Description *" type="text" value={form.description} onChange={set('description')} error={errors.description} placeholder="Brief description" required />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Input label="Amount *" type="number" value={form.amount} onChange={set('amount')} error={errors.amount} placeholder="0" min="0.01" step="0.01" required prefix="₹" />
        <Input label="Paid Via" type="text" value={form.paid_via} onChange={set('paid_via')} error={errors.paid_via} placeholder="cash / UPI / cheque" hint="Optional" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Input label="Payee Name" type="text" value={form.payee_name} onChange={set('payee_name')} placeholder="Vendor / person paid" hint="Optional" />
        <Input label="Reference No." type="text" value={form.reference_number} onChange={set('reference_number')} placeholder="Receipt / cheque no." hint="Optional" />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="exp-notes" className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Notes</label>
          <span className={`text-[var(--text-xs)] tabular-nums ${form.notes.length >= 450 ? 'text-[var(--sf-orange)]' : 'text-[var(--sf-label3)]'}`}>
            {form.notes.length}/500
          </span>
        </div>
        <textarea id="exp-notes" value={form.notes} onChange={set('notes')} rows={2} maxLength={500}
          placeholder="Any additional details…"
          className="block w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)] transition-colors hover:border-[color-mix(in_srgb,var(--sf-label)_28%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)] resize-none" />
        {errors.notes && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{errors.notes}</p>}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1 border-t border-[var(--sf-divider)]">
        <Button type="button" variant="secondary" onClick={() => onSuccess ? onSuccess() : router.back()} disabled={loading}>Cancel</Button>
        <Button type="submit" isLoading={loading}>Save Expense</Button>
      </div>
    </form>
  );
}
