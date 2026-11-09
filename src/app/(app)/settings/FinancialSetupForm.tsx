'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { societyFetch } from '@/lib/society-path';
import type { SocietyConfig } from '@/types/database';

export default function FinancialSetupForm({ config }: { config: SocietyConfig | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    monthly_maintenance_amount: String(config?.monthly_maintenance_amount ?? 2000),
    maintenance_payment_window_days: String(config?.maintenance_payment_window_days ?? 7),
    penalty_rate_percent: String(config?.penalty_rate_percent ?? 0),
    bank_name: config?.bank_name ?? '',
    bank_account_no: config?.bank_account_no ?? '',
    bank_ifsc: config?.bank_ifsc ?? '',
    upi_id: config?.upi_id ?? '',
    dues_notice_title: config?.dues_notice_title ?? 'Maintenance Dues Reminder',
    dues_notice_payby_days: String(config?.dues_notice_payby_days ?? 7),
    dues_notice_footer: config?.dues_notice_footer ?? '',
  });

  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const inputClass = 'w-full rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2.5 text-[14px] text-sf-label focus:outline-none focus:ring-2 focus:ring-sf-blue';
  const labelClass = 'mb-1.5 block text-[13px] font-medium text-sf-label';

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await societyFetch('/api/settings/financial', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          monthly_maintenance_amount: Number(form.monthly_maintenance_amount),
          maintenance_payment_window_days: Number(form.maintenance_payment_window_days),
          penalty_rate_percent: Number(form.penalty_rate_percent),
          dues_notice_payby_days: Number(form.dues_notice_payby_days),
          bank_name: form.bank_name.trim() || null,
          bank_account_no: form.bank_account_no.trim() || null,
          bank_ifsc: form.bank_ifsc.trim() || null,
          upi_id: form.upi_id.trim() || null,
          dues_notice_footer: form.dues_notice_footer.trim(),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Financial setup was not saved.');
      toast.success('Financial setup saved');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Financial setup was not saved. Refresh and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6" data-society-write>
      <Card title="Maintenance and collection setup">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Default monthly maintenance (₹)"><input required type="number" min="0" max="1000000" step="0.01" value={form.monthly_maintenance_amount} onChange={event => set('monthly_maintenance_amount', event.target.value)} className={inputClass} /></Field>
          <Field label="Payment window (days)"><input required type="number" min="0" max="365" value={form.maintenance_payment_window_days} onChange={event => set('maintenance_payment_window_days', event.target.value)} className={inputClass} /></Field>
          <Field label="Penalty rate (%)">
            <div className="flex items-center gap-1.5">
              <input required type="number" min="0" max="100" step="0.01" value={form.penalty_rate_percent} onChange={event => set('penalty_rate_percent', event.target.value)} className={inputClass} />
              <Tooltip text="Set this to 0% to remove automatic penalties. Money already paid toward a removed penalty becomes account credit." />
            </div>
          </Field>
          <Field label="UPI ID"><input value={form.upi_id} onChange={event => set('upi_id', event.target.value)} className={inputClass} placeholder="society@upi" /></Field>
        </div>
      </Card>

      <Card title="Bank details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank name"><input value={form.bank_name} onChange={event => set('bank_name', event.target.value)} className={inputClass} /></Field>
          <Field label="IFSC"><input value={form.bank_ifsc} onChange={event => set('bank_ifsc', event.target.value)} className={inputClass} /></Field>
          <div className="sm:col-span-2"><label className={labelClass}>Account number</label><input value={form.bank_account_no} onChange={event => set('bank_account_no', event.target.value)} className={inputClass} /></div>
        </div>
      </Card>

      <Card title="Dues notice">
        <div className="space-y-4">
          <Field label="Notice title"><input required value={form.dues_notice_title} onChange={event => set('dues_notice_title', event.target.value)} className={inputClass} /></Field>
          <Field label="Pay-by window (days)"><input required type="number" min="0" max="365" value={form.dues_notice_payby_days} onChange={event => set('dues_notice_payby_days', event.target.value)} className={inputClass} /></Field>
          <Field label="Footer"><textarea rows={4} value={form.dues_notice_footer} onChange={event => set('dues_notice_footer', event.target.value)} className={inputClass} /></Field>
        </div>
      </Card>

      <div className="flex justify-end"><Button type="submit" variant="primary" loading={saving}>Save financial setup</Button></div>
    </form>
  );

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <div><label className={labelClass}>{label}</label>{children}</div>;
  }
}
