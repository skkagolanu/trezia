'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { createClient, isDemoSessionClient } from '@/lib/supabase/client';
import { BillGenerateSchema } from '@/lib/validation/schemas';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import Tooltip from '@/components/ui/Tooltip';
import { formatINR } from '@/lib/utils/currency';
import type { Unit } from '@/types/database';
import { addBillingDays } from '@/lib/utils/billing';
import { currentSocietySlug, societyPath } from '@/lib/society-path';
import { societyFetch } from '@/lib/society-path';
import { DEMO_DATA } from '@/lib/demo/data';

const MONTH_OPTIONS = [
  { value: '1',  label: 'January' },
  { value: '2',  label: 'February' },
  { value: '3',  label: 'March' },
  { value: '4',  label: 'April' },
  { value: '5',  label: 'May' },
  { value: '6',  label: 'June' },
  { value: '7',  label: 'July' },
  { value: '8',  label: 'August' },
  { value: '9',  label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function buildYearOptions(): { value: string; label: string }[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: currentYear - 2020 + 2 }, (_, i) => {
    const y = 2020 + i;
    return { value: String(y), label: String(y) };
  });
}

function previewInvoiceNumber(flatNumber: string, month: number, year: number): string {
  const abbr = MONTH_ABBR[month - 1];
  const yr2 = String(year).slice(-2);
  return `${abbr}/${flatNumber.replace(/\s+/g, '')}/${yr2}`;
}

function periodDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, '0')}-${day}`;
}

type FieldErrors = Partial<Record<string, string>>;

interface UnitWithMonthly extends Unit {
  monthly_amount: number | null;
}

export default function GenerateBillsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const now = new Date();
  const [form, setForm] = useState({
    bill_period_year:  String(now.getFullYear()),
    bill_period_month: String(now.getMonth() + 1),
    cgst_percent:      '0',
    sgst_percent:      '0',
    global_previous_due: '0',
    global_penalty:    '0',
    notes:             '',
  });

  const [units, setUnits] = useState<UnitWithMonthly[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultMaintenance, setDefaultMaintenance] = useState<number>(0);
  const [paymentWindowDays, setPaymentWindowDays] = useState(7);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isDemoSessionClient()) {
      // Demo data is already isolated from Supabase and writes. Keeping these
      // fixture states available in production lets the release browser gate
      // prove loading failures and empty societies under the production CSP.
      const visualState = window.sessionStorage.getItem('__trezia_visual_bill_state');
      if (visualState === 'error') {
        setUnits([]);
        setLoadError('Could not load your flats. Refresh the page — if it keeps failing, check Settings that units exist for this society.');
        setUnitsLoading(false);
        return;
      }
      const config = DEMO_DATA.society_config[0] as { monthly_maintenance_amount?: number; maintenance_payment_window_days?: number } | undefined;
      setUnits(visualState === 'empty'
        ? []
        : (DEMO_DATA.units as UnitWithMonthly[]).filter(unit => unit.is_active && !unit.is_test_unit));
      setDefaultMaintenance(config?.monthly_maintenance_amount ?? 0);
      setPaymentWindowDays(config?.maintenance_payment_window_days ?? 7);
      setUnitsLoading(false);
      return;
    }
    const load = async () => {
      setUnitsLoading(true);
      const supabase = createClient();
      const slug = currentSocietySlug(pathname);
      try {
        const { data: society, error: societyError } = slug
          ? await supabase.from('societies').select('id').eq('slug', slug).single()
          : { data: null, error: null };
        if (societyError || !society?.id) {
          setUnits([]);
          setLoadError('Could not load your flats. Refresh the page — if it keeps failing, check Settings that units exist for this society.');
          return;
        }
        let unitsQuery = supabase
          .from('units')
          .select('id, flat_number, flat_area_sqft, monthly_amount, notes, is_active, is_test_unit, created_at, updated_at')
          .eq('is_active', true)
          .eq('is_test_unit', false)
          .order('flat_number');
        let configQuery = supabase
          .from('society_config')
          .select('monthly_maintenance_amount, maintenance_payment_window_days');
        unitsQuery = unitsQuery.eq('society_id', society.id);
        configQuery = configQuery.eq('society_id', society.id);
        const [unitsResult, configResult] = await Promise.all([unitsQuery, configQuery.limit(1).single()]);
        if (unitsResult.error || configResult.error) {
          throw new Error(unitsResult.error?.message ?? configResult.error?.message ?? 'Bill preview data unavailable');
        }
        const { data: unitData } = unitsResult;
        const { data: configData } = configResult;
        setUnits((unitData as UnitWithMonthly[]) ?? []);
        setDefaultMaintenance(configData?.monthly_maintenance_amount ?? 0);
        const windowDays = Number(configData?.maintenance_payment_window_days ?? 7);
        setPaymentWindowDays(windowDays);
      } catch {
        // Without this the page sat on "Loading units…" forever: setUnitsLoading(false)
        // was the last statement of an unguarded async function, so any rejected
        // query left a treasurer staring at a spinner with no error and no retry.
        setUnits([]);
        setLoadError('Could not load your flats. Refresh the page — if it keeps failing, check Settings that units exist for this society.');
      } finally {
        setUnitsLoading(false);
      }
    };
    load();
  }, [pathname]);

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(prev => {
        const next = { ...prev, [field]: e.target.value };
        return next;
      });
      setErrors(prev => ({ ...prev, [field]: undefined }));
    };
  }

  function effectiveAmount(unit: UnitWithMonthly): number {
    return unit.monthly_amount ?? defaultMaintenance;
  }

  function computePayable(baseAmount: number): number {
    const cgst = (baseAmount * Number(form.cgst_percent)) / 100;
    const sgst = (baseAmount * Number(form.sgst_percent)) / 100;
    const prevDue = Number(form.global_previous_due);
    const penalty = Number(form.global_penalty);
    return baseAmount + cgst + sgst + prevDue + penalty;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const parsed = BillGenerateSchema.safeParse({
      bill_period_year:  Number(form.bill_period_year),
      bill_period_month: Number(form.bill_period_month),
      cgst_percent:      Number(form.cgst_percent),
      sgst_percent:      Number(form.sgst_percent),
      previous_due:      Number(form.global_previous_due),
      penalty_amount:    Number(form.global_penalty),
      notes:             form.notes || undefined,
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

    setSubmitting(true);
    const toastId = toast.loading(
      `Generating bills for ${units.length} unit${units.length !== 1 ? 's' : ''}…`
    );

    try {
      const res = await societyFetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(json.error ?? `Request failed (${res.status})`, { id: toastId });
        return;
      }

      const created: number = json.count ?? json.created ?? 0;
      toast.success(
        `${created} bill${created !== 1 ? 's' : ''} generated successfully`,
        { id: toastId }
      );
      router.push(societyPath(currentSocietySlug(pathname), '/bills'));
    } catch {
      toast.error('Network error — please try again', { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  const year = Number(form.bill_period_year);
  const month = Number(form.bill_period_month);
  const invoiceDate = periodDate(form.bill_period_year, form.bill_period_month, '01');
  const dueDate = addBillingDays(invoiceDate, paymentWindowDays);
  const isCurrentOrFuture =
    year > now.getFullYear() ||
    (year === now.getFullYear() && month >= now.getMonth() + 1);

  return (
    <div data-society-write className="flex flex-col">
      <PageHeader title="Generate Bills" />

      <div className="flex-1 p-6 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card title="Bill Period">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select
                label="Year"
                value={form.bill_period_year}
                onChange={handleChange('bill_period_year')}
                options={buildYearOptions()}
                error={errors.bill_period_year}
                required
              />
              <Select
                label="Month"
                value={form.bill_period_month}
                onChange={handleChange('bill_period_month')}
                options={MONTH_OPTIONS}
                error={errors.bill_period_month}
                required
              />
              <Input
                label="Invoice Date"
                type="date"
                value={invoiceDate}
                readOnly
                hint="Always the first day of the selected bill month."
              />
              <Input
                label="Due Date"
                type="date"
                value={dueDate}
                readOnly
                hint={`Calculated from the ${paymentWindowDays}-day maintenance window in Settings.`}
              />
            </div>
            {isCurrentOrFuture && (
              <p className="mt-3 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-orange)_10%,transparent)] border border-[color-mix(in_srgb,var(--sf-orange)_25%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-orange)]">
                This is the current or a future billing period. Current-month bills are dated and due in the same month.
              </p>
            )}
          </Card>

          {/* Charges */}
          <Card title="Charges & Adjustments">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="CGST %"
                type="number"
                min="0"
                max="28"
                step="0.01"
                value={form.cgst_percent}
                onChange={handleChange('cgst_percent')}
                error={errors.cgst_percent}
                suffix="%"
                hint="Central GST percentage (0 if not applicable)"
                tooltip={<Tooltip text="Central Goods and Services Tax. Set to 0 if your society is not GST-registered. Both CGST and SGST together should not exceed 18%." />}
              />
              <Input
                label="SGST %"
                type="number"
                min="0"
                max="28"
                step="0.01"
                value={form.sgst_percent}
                onChange={handleChange('sgst_percent')}
                error={errors.sgst_percent}
                suffix="%"
                hint="State GST percentage (0 if not applicable)"
                tooltip={<Tooltip text="State Goods and Services Tax. Usually same percentage as CGST. Set to 0 if your society is not GST-registered." />}
              />
              <Input
                label="Previous Due (₹)"
                type="number"
                min="0"
                step="0.01"
                value={form.global_previous_due}
                onChange={handleChange('global_previous_due')}
                error={errors.previous_due}
                prefix="₹"
                hint="Applied uniformly to all bills"
                tooltip={<Tooltip text="Carries forward a uniform unpaid balance to all bills. Use this only for the first month you run bills after switching from Excel. Leave at ₹0 otherwise." />}
              />
              <Input
                label="Penalty (₹)"
                type="number"
                min="0"
                step="0.01"
                value={form.global_penalty}
                onChange={handleChange('global_penalty')}
                error={errors.penalty_amount}
                prefix="₹"
                hint="Applied uniformly to all bills"
                tooltip={<Tooltip text="A flat late fee added to every bill in this batch. Leave at ₹0 if you don't charge late fees." />}
              />
            </div>

            <div className="mt-4">
              <label className="text-[13px] font-medium text-sf-label block mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={handleChange('notes')}
                rows={3}
                maxLength={500}
                placeholder="Any additional notes for these bills…"
                className="block w-full rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2.5 text-[14px] text-sf-label placeholder:text-sf-label3 transition-all hover:border-black/[0.28] focus:outline-none focus:ring-2 focus:ring-sf-blue resize-none"
              />
              {errors.notes && <p className="text-[12px] text-sf-red mt-1">{errors.notes}</p>}
            </div>
          </Card>

          {/* Preview table */}
          {/* flush so the preview table's row dividers meet the card border
              instead of stopping 24px short and reading as uncontained.
              The two prose states keep their own horizontal padding. */}
          <Card flush title={`Preview — ${units.length} unit${units.length !== 1 ? 's' : ''} will receive bills`}>
            {unitsLoading ? (
              <p className="px-6 text-[13px] text-gray-400 py-4 text-center">Loading units…</p>
            ) : loadError ? (
              <p role="alert" className="px-6 py-4 text-center text-[13px] text-sf-red">{loadError}</p>
            ) : units.length === 0 ? (
              <p className="px-6 text-[13px] text-gray-400 py-4 text-center">
                No active units found. Add units before generating bills.
              </p>
            ) : (
              <div className="overflow-x-auto sticky-thead">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-black/[0.06] text-left">
                      <th className="px-3 py-3 text-[13px] font-semibold text-sf-label2">#</th>
                      <th className="px-3 py-3 text-[13px] font-semibold text-sf-label2">Flat</th>
                      <th className="px-3 py-3 text-[13px] font-semibold text-sf-label2">Invoice Number</th>
                      <th className="px-3 py-3 text-[13px] font-semibold text-sf-label2 text-right">Base Amount</th>
                      <th className="px-3 py-3 text-[13px] font-semibold text-sf-label2 text-right">Total Payable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04]">
                    {units.map((unit, idx) => {
                      const base = effectiveAmount(unit);
                      const payable = computePayable(base);
                      return (
                        <tr key={unit.id} className="hover:bg-sf-bg transition-colors">
                          <td className="px-3 py-3.5 text-sf-label3">{idx + 1}</td>
                          <td className="px-3 py-3.5 font-semibold text-sf-label">{unit.flat_number}</td>
                          <td className="px-3 py-3.5 font-mono text-[13px] text-sf-label2">
                            {previewInvoiceNumber(unit.flat_number, month, year)}
                          </td>
                          <td className="px-3 py-3.5 text-right text-sf-label2">
                            {formatINR(base)}
                          </td>
                          <td className="px-3 py-3.5 text-right font-semibold text-sf-label">
                            {formatINR(payable)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(societyPath(currentSocietySlug(pathname), '/bills'))}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={unitsLoading || units.length === 0}
            >
              Generate {units.length > 0 ? `${units.length} Bill${units.length !== 1 ? 's' : ''}` : 'Bills'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
