'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import type { SocietyConfig } from '@/types/database';

interface Props {
  config: SocietyConfig | null;
  societyId: string;
}

export default function SettingsForm({ config, societyId }: Props) {
  const [form, setForm] = useState({
    name:                       config?.name ?? '',
    registration_number:        config?.registration_number ?? '',
    address:                    config?.address ?? '',
    mobile:                     config?.mobile ?? '',
    pan_number:                 config?.pan_number ?? '',
    gstin:                      config?.gstin ?? '',
    bank_name:                  config?.bank_name ?? '',
    bank_ifsc:                  config?.bank_ifsc ?? '',
    bank_account_no:            config?.bank_account_no ?? '',
    upi_id:                     config?.upi_id ?? '',
    receipt_prefix:             config?.receipt_prefix ?? 'REC',
    monthly_maintenance_amount: String(config?.monthly_maintenance_amount ?? 2000),
    penalty_rate_percent:       String(config?.penalty_rate_percent ?? 0),
    maintenance_payment_window_days: String(config?.maintenance_payment_window_days ?? 7),
    financial_year_start_month: String(config?.financial_year_start_month ?? 4),
    dues_notice_title:          config?.dues_notice_title ?? 'Maintenance Dues Reminder',
    dues_notice_payby_days:     String(config?.dues_notice_payby_days ?? 7),
    dues_notice_footer:         config?.dues_notice_footer ?? '',
    agent_daily_user_limit:     String(config?.agent_daily_user_limit ?? 20),
    agent_daily_society_limit:  String(config?.agent_daily_society_limit ?? 100),
  });

  const [agentEnabled, setAgentEnabled] = useState(config?.agent_enabled ?? false);
  const [saving, setSaving] = useState(false);

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const supabase = createClient();
      const update = {
        name:                       form.name.trim(),
        registration_number:        form.registration_number.trim() || null,
        address:                    form.address.trim() || null,
        mobile:                     form.mobile.trim() || null,
        pan_number:                 form.pan_number.trim() || null,
        gstin:                      form.gstin.trim() || null,
        bank_name:                  form.bank_name.trim() || null,
        bank_ifsc:                  form.bank_ifsc.trim() || null,
        bank_account_no:            form.bank_account_no.trim() || null,
        upi_id:                     form.upi_id.trim() || null,
        receipt_prefix:             form.receipt_prefix.trim() || 'REC',
        monthly_maintenance_amount: parseFloat(form.monthly_maintenance_amount) || 2000,
        penalty_rate_percent:       Math.min(100, Math.max(0, Number(form.penalty_rate_percent) || 0)),
        maintenance_payment_window_days: Math.min(365, Math.max(0, Number.parseInt(form.maintenance_payment_window_days, 10) || 0)),
        financial_year_start_month: parseInt(form.financial_year_start_month) || 4,
        dues_notice_title:          form.dues_notice_title.trim() || 'Maintenance Dues Reminder',
        dues_notice_payby_days:     Math.min(365, Math.max(0, Number.parseInt(form.dues_notice_payby_days, 10) || 0)),
        dues_notice_footer:         form.dues_notice_footer.trim(),
        agent_enabled:              agentEnabled,
        agent_daily_user_limit:     Math.max(0, Number.parseInt(form.agent_daily_user_limit, 10) || 0),
        agent_daily_society_limit:  Math.max(0, Number.parseInt(form.agent_daily_society_limit, 10) || 0),
      };

      if (config?.id) {
        const { error } = await supabase.from('society_config').update(update).eq('id', config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('society_config').insert({ ...update, society_id: societyId });
        if (error) throw error;
      }
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const MONTHS = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' },
    { value: '3', label: 'March' },   { value: '4', label: 'April' },
    { value: '5', label: 'May' },     { value: '6', label: 'June' },
    { value: '7', label: 'July' },    { value: '8', label: 'August' },
    { value: '9', label: 'September' },{ value: '10', label: 'October' },
    { value: '11', label: 'November' },{ value: '12', label: 'December' },
  ];

  const inputCls = 'w-full rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2.5 text-[14px] text-sf-label placeholder:text-sf-label3 transition-all hover:border-black/[0.28] focus:outline-none focus:ring-2 focus:ring-sf-blue';
  const labelCls = 'block text-[13px] font-medium text-sf-label mb-1.5';

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Society Identity">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Society Name <span className="text-sf-red">*</span></label>
            <input required value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="Full legal name" />
          </div>
          <div>
            <label className={labelCls}>Registration Number</label>
            <input value={form.registration_number} onChange={e => set('registration_number', e.target.value)} className={inputCls} placeholder="Society reg. number" />
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <textarea value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} rows={3} placeholder="Full postal address" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Treasurer Mobile</label>
              <input value={form.mobile} onChange={e => set('mobile', e.target.value)} className={inputCls} placeholder="10-digit mobile" />
            </div>
            <div>
              <label className={labelCls}>UPI ID</label>
              <input value={form.upi_id} onChange={e => set('upi_id', e.target.value)} className={inputCls} placeholder="society@upi" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>PAN Number</label>
              <input value={form.pan_number} onChange={e => set('pan_number', e.target.value)} className={inputCls} placeholder="AAAAA9999A" />
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input value={form.gstin} onChange={e => set('gstin', e.target.value)} className={inputCls} placeholder="27AAAAA9999A1Z5" />
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Bank Details"
        action={<Tooltip text="This app has no payment gateway, so these bank details are printed on bills and receipts so residents know where to transfer money." />}
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Bank Name</label>
            <input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} className={inputCls} placeholder="e.g. SBI, HDFC" />
          </div>
          <div>
            <label className={labelCls}>IFSC Code</label>
            <input value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value)} className={inputCls} placeholder="SBIN0001234" />
          </div>
          <div>
            <label className={labelCls}>Account Number</label>
            <input value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value)} className={inputCls} placeholder="Society bank account number" />
          </div>
          <p className="text-[13px] text-sf-label2 bg-sf-bg border border-black/[0.07] rounded-[10px] p-3">
            This app has no payment gateway, so the society&apos;s own bank details are printed on bills and receipts for residents to transfer to. Enter the society&apos;s account here, never a personal account.
          </p>
        </div>
      </Card>

      <Card title="Billing Settings">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Receipt Prefix</label>
              <input value={form.receipt_prefix} onChange={e => set('receipt_prefix', e.target.value)} className={inputCls} placeholder="REC" />
              <p className="text-[12px] text-sf-label3 mt-1">e.g. REC → REC-0001</p>
            </div>
            <div>
              <label className={labelCls}>Monthly Maintenance (₹)</label>
              <input type="number" value={form.monthly_maintenance_amount} onChange={e => set('monthly_maintenance_amount', e.target.value)} className={inputCls} min="0" step="0.01" />
              <p className="text-[12px] text-sf-label3 mt-1">Used as default for new flats only — existing flat amounts must be updated individually.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Penalty Rate (%)</label>
              <input type="number" value={form.penalty_rate_percent} onChange={e => set('penalty_rate_percent', e.target.value)} className={inputCls} min="0" max="100" step="0.01" />
              <p className="text-[12px] text-sf-label3 mt-1">Applied once to base maintenance when an unpaid bill passes its due date.</p>
            </div>
            <div>
              <label className={labelCls}>Financial Year Starts</label>
              <select value={form.financial_year_start_month} onChange={e => set('financial_year_start_month', e.target.value)} className={inputCls}>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Maintenance payment window (days)</label>
            <input type="number" value={form.maintenance_payment_window_days} onChange={e => set('maintenance_payment_window_days', e.target.value)} className={inputCls} min="0" max="365" step="1" />
            <p className="text-[12px] text-sf-label3 mt-1">Counted from the first of the bill month, including that day. A 7-day window is due through the 7th.</p>
          </div>
        </div>
      </Card>

      <Card title="Dues Notice">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Notice Title</label>
            <input value={form.dues_notice_title} onChange={e => set('dues_notice_title', e.target.value)} className={inputCls} placeholder="Maintenance Dues Reminder" />
          </div>
          <div>
            <label className={labelCls}>Dues-notice response window (days)</label>
            <input type="number" value={form.dues_notice_payby_days} onChange={e => set('dues_notice_payby_days', e.target.value)} className={inputCls} min="0" max="365" step="1" />
            <p className="text-[12px] text-sf-label3 mt-1">Counted from the date a dues notice is generated. This does not change invoice deadlines or penalties.</p>
          </div>
          <div>
            <label className={labelCls}>Footer message</label>
            <textarea value={form.dues_notice_footer} onChange={e => set('dues_notice_footer', e.target.value)} className={inputCls} rows={3} placeholder="Wording shown at the bottom of every dues notice." />
          </div>
        </div>
      </Card>

      <Card
        title="Assistant"
        action={<Tooltip text="The read-only assistant runs on a shared free-tier language model. It is off until you turn it on, and the daily limits protect that shared allowance across every society." />}
      >
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={agentEnabled}
              onChange={e => setAgentEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-sf-blue"
            />
            <span>
              <span className="block text-[14px] font-medium text-sf-label">Enable the read-only assistant</span>
              <span className="block text-[12px] text-sf-label3">When off, the assistant bar is hidden for this society and no queries are sent.</span>
            </span>
          </label>
          <div className={`grid grid-cols-2 gap-4 ${agentEnabled ? '' : 'opacity-50'}`}>
            <div>
              <label className={labelCls}>Daily limit per person</label>
              <input type="number" value={form.agent_daily_user_limit} disabled={!agentEnabled} onChange={e => set('agent_daily_user_limit', e.target.value)} className={inputCls} min="0" step="1" />
            </div>
            <div>
              <label className={labelCls}>Daily limit for the whole society</label>
              <input type="number" value={form.agent_daily_society_limit} disabled={!agentEnabled} onChange={e => set('agent_daily_society_limit', e.target.value)} className={inputCls} min="0" step="1" />
            </div>
          </div>
        </div>
      </Card>

      {config?.next_receipt_no != null && (
        <div className="rounded-[10px] border border-black/[0.07] bg-sf-bg p-4 text-[14px] text-sf-label2">
          <span className="font-medium text-sf-label">Next receipt number:</span>{' '}
          {config.receipt_prefix}-{String(config.next_receipt_no).padStart(4, '0')}
          <span className="ml-2 text-[13px] text-sf-label3">(auto-assigned by DB trigger, read-only)</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} variant="primary">
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </form>
  );
}
