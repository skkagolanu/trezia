'use client';
import { societyFetch } from '@/lib/society-path';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSocietyPath } from '@/lib/hooks/use-society-path';
import toast from 'react-hot-toast';
import { createClient, isDemoSessionClient } from '@/lib/supabase/client';
import { PaymentSchema } from '@/lib/validation/schemas';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tooltip from '@/components/ui/Tooltip';
import RecordedByHint from '@/components/forms/RecordedByHint';
import Modal from '@/components/ui/Modal';
import type { PaymentInput } from '@/lib/validation/schemas';
import { labelDisplay } from '@/lib/utils/levy-label';

type PaymentMode        = 'UPI' | 'BANK_TRANSFER' | 'MANUAL_COLLECTION' | 'OTHER';
type PaymentType        = 'maintenance' | 'levy' | 'other-income';
type MaintenanceAllocation = 'account' | 'months';
type OtherIncomeCategory = 'PENALTY' | 'AD_BOARD_INCOME' | 'CORPUS_FUND' | 'CMC' | 'OTHER_INCOME';

interface UnitOption   { id: string; flat_number: string; }
interface ResidentInfo { id: string; full_name: string; phone: string | null; }

interface Props {
  onSuccess?: (result: { type: PaymentType; flatNumber?: string }) => void;
  onCancel?: () => void;
}

type OverlapConflict = {
  month: string;
  payments: Array<{
    id: string;
    receipt_number: string | null;
    payment_date: string;
    amount_paid: number;
  }>;
};

const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'UPI',               label: 'UPI' },
  { value: 'BANK_TRANSFER',     label: 'Bank Transfer' },
  { value: 'MANUAL_COLLECTION', label: 'Manual' },
  { value: 'OTHER',             label: 'Other' },
];

const OTHER_INCOME_CATEGORIES: { value: OtherIncomeCategory; label: string }[] = [
  { value: 'PENALTY',         label: 'Penalty' },
  { value: 'AD_BOARD_INCOME', label: 'Ad Board' },
  { value: 'CORPUS_FUND',     label: 'Corpus Fund' },
  // Persist the legacy enum value for compatibility; the product vocabulary
  // now presents annual contract income as AMC.
  { value: 'CMC',             label: 'AMC' },
  { value: 'OTHER_INCOME',    label: 'Other' },
];

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DATA_START_YEAR = 2022;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function monthLabel(year: number, idx: number) { return `${MONTH_NAMES[idx]} ${year}`; }
function parseMonthLabel(label: string): Date {
  const [mon, yr] = label.split(' ');
  return new Date(parseInt(yr), MONTH_NAMES.indexOf(mon), 1);
}

export default function PaymentForm({ onSuccess, onCancel }: Props) {
  const router   = useRouter();
  const scoped = useSocietyPath();

  const now       = new Date();
  const thisYear  = now.getFullYear();
  const thisMonth = now.getMonth();
  const maxYear   = thisYear + 1;

  const [units,           setUnits]           = useState<UnitOption[]>([]);
  const [unitId,          setUnitId]          = useState('');
  const [resident,        setResident]        = useState<ResidentInfo | null>(null);
  const [residentLoading, setResidentLoading] = useState(false);
  const [optionsLoading,  setOptionsLoading]  = useState(true);
  const [optionsError,    setOptionsError]    = useState(false);
  const [optionsRetry,    setOptionsRetry]    = useState(0);

  const [paymentType, setPaymentType] = useState<PaymentType>('maintenance');
  const [maintenanceAllocation, setMaintenanceAllocation] = useState<MaintenanceAllocation>('account');
  // The label is chosen from the society's configured levies, not composed from
  // a type toggle and a year stepper. AMC and CMC were never two modelled types
  // — levy_configs and amc_collections carry only this free-text label — so the
  // old `${levyType}-${levyYear}` composer could produce a label the society had
  // never configured, and could not express one named in plain words.
  const [levyLabels,  setLevyLabels]  = useState<string[]>([]);
  const [levyLabel,   setLevyLabel]   = useState('');
  const [paidByLevy,  setPaidByLevy]  = useState<Record<string, number>>({});

  const [otherCategory,    setOtherCategory]    = useState<OtherIncomeCategory>('OTHER_INCOME');
  const [otherDescription, setOtherDescription] = useState('');

  const [amount,      setAmount]      = useState('');
  const [mode,        setMode]        = useState<PaymentMode>('UPI');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [paymentTime] = useState(nowTime());

  const [activeYear,     setActiveYear]     = useState(thisYear);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(
    () => new Set([monthLabel(thisYear, thisMonth)])
  );

  const [utrReference, setUtrReference] = useState('');
  const [notes,        setNotes]        = useState('');
  const [errors,       setErrors]       = useState<Record<string, string>>({});
  const [submitting,   setSubmitting]   = useState(false);
  const [overlapConfirmation, setOverlapConfirmation] = useState<{
    payment: PaymentInput;
    conflicts: OverlapConflict[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError(false);
    const loadOptions = async () => {
      if (isDemoSessionClient()) {
        const supabase = createClient();
        const [unitsResult, leviesResult] = await Promise.all([
          supabase.from('units').select('id, flat_number').eq('is_active', true).order('flat_number'),
          supabase.from('levy_configs').select('levy_label').eq('is_active_for_new_collections', true).order('created_at', { ascending: false }),
        ]);
        if (unitsResult.error || leviesResult.error) throw new Error('Demo form options unavailable');
        return {
          units: unitsResult.data ?? [],
          levy_labels: (leviesResult.data ?? []).map(row => row.levy_label),
        };
      }
      const response = await societyFetch('/api/payments/form-context', { signal: controller.signal });
        if (!response.ok) throw new Error('Payment form options unavailable');
      return response.json() as Promise<{ units?: UnitOption[]; levy_labels?: string[] }>;
    };
    loadOptions()
      .then((data) => {
        setUnits(data.units ?? []);
        const labels = data.levy_labels ?? [];
        setLevyLabels(labels);
        setLevyLabel(prev => prev || labels[0] || '');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setUnits([]);
        setLevyLabels([]);
        setOptionsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    if (!unitId) { setResident(null); setPaidByLevy({}); return; }
    const controller = new AbortController();
    setResidentLoading(true);
    const loadUnit = async () => {
      if (isDemoSessionClient()) {
        const supabase = createClient();
        const [residentResult, collectionsResult] = await Promise.all([
          supabase.from('residents').select('id, full_name, phone')
            .eq('unit_id', unitId).eq('is_primary', true).eq('is_active', true).maybeSingle(),
          supabase.from('amc_collections').select('levy_label, amount_paid')
            .eq('unit_id', unitId).eq('is_voided', false),
        ]);
        if (residentResult.error || collectionsResult.error) throw new Error('Demo flat details unavailable');
        const totals: Record<string, number> = {};
        for (const row of collectionsResult.data ?? []) {
          totals[row.levy_label] = (totals[row.levy_label] ?? 0) + row.amount_paid;
        }
        return { resident: residentResult.data, paid_by_levy: totals };
      }
      const response = await societyFetch(`/api/payments/form-context?unit_id=${encodeURIComponent(unitId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Flat details unavailable');
      return response.json() as Promise<{ resident?: ResidentInfo | null; paid_by_levy?: Record<string, number> }>;
    };
    loadUnit()
      .then((data) => {
        setResident(data.resident ?? null);
        setPaidByLevy(data.paid_by_levy ?? {});
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResident(null);
        setPaidByLevy({});
        toast.error('Could not load this flat. Try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setResidentLoading(false);
      });
    return () => controller.abort();
  }, [unitId]);

  function handleTypeToggle(type: PaymentType) {
    setPaymentType(type); setAmount(''); setErrors({});
    if (type === 'maintenance') {
      setMaintenanceAllocation('account');
      setSelectedMonths(new Set([monthLabel(thisYear, thisMonth)]));
    }
  }

  function toggleMonth(label: string) {
    setSelectedMonths(prev => {
      const next = new Set(prev);
      if (next.has(label)) { next.delete(label); } else { next.add(label); }
      return next;
    });
  }

  const currentLevyLabel = levyLabel;
  const selectedFlatNumber = units.find(unit => unit.id === unitId)?.flat_number;

  async function recordMaintenance(payment: PaymentInput, allowMonthOverlap = false) {
    setSubmitting(true);
    try {
      const res = await societyFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payment, allow_month_overlap: allowMonthOverlap }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.code === 'MONTH_OVERLAP') {
        setOverlapConfirmation({ payment, conflicts: json.overlaps ?? [] });
        return;
      }
      if (!res.ok) {
        toast.error(json.error ?? 'The payment was not recorded. Check the details and try again.');
        return;
      }
      setOverlapConfirmation(null);
      toast.success(json.receipt_number ? `Payment recorded — ${json.receipt_number}` : 'Payment recorded');
      if (onSuccess) {
        onSuccess({ type: 'maintenance', flatNumber: selectedFlatNumber });
      } else {
        router.push(scoped(`/payments?type=all&period=all&flat=${encodeURIComponent(selectedFlatNumber ?? '')}`));
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    // ── Other Income ──────────────────────────────────────────────────────────
    if (paymentType === 'other-income') {
      if (!otherDescription.trim() || otherDescription.trim().length < 2) {
        setErrors({ description: 'Enter a description (min 2 chars)' });
        toast.error('Enter a description for this income');
        return;
      }
      const parsedAmount = Number(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        setErrors({ amount_paid: 'Enter a valid amount' });
        toast.error('Enter a valid amount');
        return;
      }
      setSubmitting(true);
      try {
        const res = await societyFetch('/api/other-income', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            income_date:      paymentDate,
            category:         otherCategory,
            description:      otherDescription.trim(),
            amount:           parsedAmount,
            received_via:     MODES.find(m => m.value === mode)?.label ?? mode,
            reference_number: utrReference || undefined,
            notes:            notes || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) { toast.error(json.error ?? 'The income was not recorded. Check the details and try again.'); setSubmitting(false); return; }
        toast.success('Other income recorded');
        if (onSuccess) { onSuccess({ type: 'other-income' }); } else { router.push(scoped('/payments/other-income')); }
      } catch { toast.error('Network error'); setSubmitting(false); }
      return;
    }

    // ── Levy ──────────────────────────────────────────────────────────────────
    if (!unitId) {
      setErrors({ unit_id: 'Select a flat' });
      toast.error('Please select a flat');
      return;
    }

    if (paymentType === 'levy') {
      if (!currentLevyLabel || levyLabels.length === 0) {
        setErrors({ levy_label: 'Set up AMC before recording this payment' });
        toast.error('No AMC year is configured');
        return;
      }
      const parsedAmount = Number(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        setErrors({ amount_paid: 'Enter a valid amount' });
        toast.error('Enter the charge amount');
        return;
      }
      setSubmitting(true);
      try {
        const res  = await societyFetch('/api/levies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit_id: unitId, resident_id: resident?.id, levy_label: currentLevyLabel, amount_paid: parsedAmount, payment_date: paymentDate, payment_mode: mode, notes: notes || undefined }),
        });
        const json = await res.json();
        if (!res.ok) { toast.error(json.error ?? 'The AMC payment was not recorded. Check the details and try again.'); setSubmitting(false); return; }
        toast.success(`${currentLevyLabel} payment recorded`);
        if (onSuccess) { onSuccess({ type: 'levy', flatNumber: selectedFlatNumber }); } else { router.push(scoped(`/payments?type=all&period=all&flat=${encodeURIComponent(selectedFlatNumber ?? '')}`)); }
      } catch { toast.error('Network error'); setSubmitting(false); }
      return;
    }

    // ── Maintenance ───────────────────────────────────────────────────────────
    if (maintenanceAllocation === 'months' && selectedMonths.size === 0) {
      setErrors({ months_covered: 'Select at least one month' });
      toast.error('Select at least one month');
      return;
    }
    const ordered = [...selectedMonths].sort((a, b) => parseMonthLabel(a).getTime() - parseMonthLabel(b).getTime());
    const raw = {
      unit_id: unitId, resident_id: resident?.id,
      amount_paid: Number(amount), payment_mode: mode,
      payment_date: paymentDate, payment_time: paymentTime || undefined,
      months_covered: maintenanceAllocation === 'months' ? selectedMonths.size : 1,
      months_detail: maintenanceAllocation === 'months' ? ordered.join(', ') : undefined,
      utr_reference: utrReference || undefined, notes: notes || undefined, bill_ids: [],
    };
    const parsed = PaymentSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach(err => { const k = err.path[0] as string; if (k) fe[k] = err.message; });
      setErrors(fe);
      toast.error(parsed.error.issues[0]?.message ?? 'Please fix the errors above');
      return;
    }
    await recordMaintenance(parsed.data);
  }

  const showUtr         = ['UPI', 'BANK_TRANSFER'].includes(mode);
  const unitOptions     = units.map(u => ({ value: u.id, label: u.flat_number }));
  const orderedSelected = [...selectedMonths].sort((a, b) => parseMonthLabel(a).getTime() - parseMonthLabel(b).getTime());
  const levyAlreadyPaid = paidByLevy[currentLevyLabel] ?? 0;

  return (
    <form data-society-write onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-5 min-w-0">

      {/* Payment type toggle */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Payment Type</span>
        <div className="grid w-full grid-cols-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] overflow-hidden sm:inline-flex sm:w-auto sm:self-start">
          {(['maintenance', 'levy', 'other-income'] as const).map(t => (
            <button key={t} type="button" aria-pressed={paymentType === t} onClick={() => handleTypeToggle(t)}
              className={`min-w-0 h-11 px-2 text-[var(--text-xs)] font-medium leading-tight transition-colors border-r border-[var(--sf-border)] last:border-r-0 sm:h-9 sm:px-4 sm:text-[var(--text-sm)] sm:whitespace-nowrap ${
                paymentType === t ? 'bg-[var(--sf-blue)] text-white' : 'bg-[var(--sf-surface)] text-[var(--sf-label2)] hover:text-[var(--sf-label)]'
              }`}>
              {t === 'maintenance' ? 'Maintenance' : t === 'levy' ? 'AMC' : 'Other Income'}
            </button>
          ))}
        </div>
      </div>

      {/* Flat + resident — hidden for Other Income */}
      {paymentType !== 'other-income' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-1">
            <Select label="Flat *" options={unitOptions}
              placeholder={optionsLoading ? 'Loading flats…' : 'Select flat…'} disabled={optionsLoading || optionsError}
              value={unitId} onChange={e => setUnitId(e.target.value)} error={errors.unit_id} />
            {optionsError && (
              <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">
                Flats could not be loaded.{' '}
                <button type="button" className="underline" onClick={() => setOptionsRetry(value => value + 1)}>Retry</button>
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Resident</p>
            <div className="min-h-11 min-w-0 flex items-center rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] sm:min-h-9">
              {!unitId ? <span className="text-[var(--sf-label3)]">Select flat first</span>
                : residentLoading ? <span className="text-[var(--sf-label3)]">Loading…</span>
                : resident ? <span className="min-w-0 truncate text-[var(--sf-label)]">{resident.full_name}</span>
                : <span className="text-[var(--sf-label3)]">No primary resident</span>}
            </div>
          </div>
        </div>
      )}

      {/* Other Income fields */}
      {paymentType === 'other-income' && (
          <div className="min-w-0 space-y-4">
          <fieldset>
            <legend className="text-[var(--text-sm)] font-medium text-[var(--sf-label)] mb-1.5">Category</legend>
            <div className="flex flex-wrap gap-1.5">
              {OTHER_INCOME_CATEGORIES.map(cat => (
                <button key={cat.value} type="button" aria-pressed={otherCategory === cat.value} onClick={() => setOtherCategory(cat.value)}
                  className={`min-h-11 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium transition-colors border sm:min-h-8 ${
                    otherCategory === cat.value
                      ? 'bg-[var(--sf-blue)] border-[var(--sf-blue)] text-white'
                      : 'bg-[var(--sf-surface-2)] border-[var(--sf-border)] text-[var(--sf-label2)] hover:text-[var(--sf-label)]'
                  }`}>
                  {cat.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Input
            label="Description *"
            type="text"
            value={otherDescription}
            onChange={e => setOtherDescription(e.target.value)}
            error={errors.description}
            placeholder="e.g. Ad board rental Q1, Penalty from flat 302"
            hint="What is this income for?"
            maxLength={300}
          />
        </div>
      )}

      {/* Levy picker */}
      {paymentType === 'levy' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">AMC year</span>
            <Tooltip text="AMC means Annual Maintenance Contract. Choose the year this payment belongs to." />
          </div>
          {levyLabels.length === 0 ? (
            <p role="alert" className="text-[var(--text-sm)] text-[var(--sf-label2)]">
              No AMC year is set up. Add one in Settings first.
            </p>
          ) : (
            <select
              value={levyLabel}
              onChange={e => setLevyLabel(e.target.value)}
              aria-label="AMC year"
              className="h-11 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] sm:h-9"
            >
              {levyLabels.map(label => (
                <option key={label} value={label}>{labelDisplay(label)}</option>
              ))}
            </select>
          )}
          {errors.levy_label && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{errors.levy_label}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {levyAlreadyPaid > 0 && (
              <span className="text-[var(--text-xs)] text-[var(--sf-orange)] font-medium">
                {levyAlreadyPaid.toLocaleString('en-IN')} already recorded
              </span>
            )}
          </div>
        </div>
      )}

      {/* Amount + Date row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Input label="Amount *" type="number" min="0.01" max="500000" step="0.01"
          value={amount} onChange={e => setAmount(e.target.value)}
          error={errors.amount_paid} placeholder="e.g. 2000" prefix="₹" />
        <Input label="Date *" type="date" value={paymentDate}
          onChange={e => setPaymentDate(e.target.value)} error={errors.payment_date} />
      </div>

      <RecordedByHint date={paymentDate} />

      {/* Payment mode */}
      <fieldset>
        <legend className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">
            {paymentType === 'other-income' ? 'Received Via' : 'Payment Mode'}
          </span>
          {paymentType !== 'other-income' && (
            <Tooltip text="UPI covers PhonePe, Google Pay, Paytm. Bank Transfer covers NEFT, IMPS, RTGS. Manual is cash or cheque collected in person." />
          )}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map(m => (
            <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => setMode(m.value)}
              className={`min-h-11 min-w-0 rounded-[var(--radius-md)] px-2 text-center text-[var(--text-sm)] font-medium leading-tight transition-colors border sm:min-h-9 ${
                mode === m.value
                  ? 'bg-[var(--sf-blue)] border-[var(--sf-blue)] text-white'
                  : 'bg-[var(--sf-surface-2)] border-[var(--sf-border)] text-[var(--sf-label2)] hover:text-[var(--sf-label)]'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        {errors.payment_mode && <p role="alert" className="mt-1 text-[var(--text-xs)] text-[var(--sf-red)]">{errors.payment_mode}</p>}
      </fieldset>

      {/* The normal maintenance entry may clear all outstanding charges. A
          Treasurer can instead direct it to named maintenance months. */}
      {paymentType === 'maintenance' && (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-[var(--text-sm)] font-medium text-[var(--sf-label)]">
              Apply payment to
              <Tooltip text="This clears the oldest maintenance or AMC due first. Any extra stays as account credit." />
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-2">
                <input
                  type="radio"
                  name="maintenance-allocation"
                  value="account"
                  checked={maintenanceAllocation === 'account'}
                  onChange={() => setMaintenanceAllocation('account')}
                  className="accent-[var(--sf-blue)]"
                />
                <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Oldest unpaid charges</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-2">
                <input
                  type="radio"
                  name="maintenance-allocation"
                  value="months"
                  checked={maintenanceAllocation === 'months'}
                  onChange={() => setMaintenanceAllocation('months')}
                  className="accent-[var(--sf-blue)]"
                />
                <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Chosen maintenance months</span>
              </label>
            </div>
          </fieldset>

        {maintenanceAllocation === 'months' && (
        <fieldset>
          <legend className="flex items-center gap-1.5 mb-2">
            <span className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Months Covered</span>
            <Tooltip text="Select which maintenance month(s) this payment covers. Navigate to a future year to record advance payments — they appear in orange." />
          </legend>

          <div className="flex items-center gap-2 mb-2">
            <button type="button" aria-label="Previous year" onClick={() => setActiveYear(y => Math.max(DATA_START_YEAR, y - 1))}
              disabled={activeYear <= DATA_START_YEAR}
              className="h-11 w-11 flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--sf-border)] text-[var(--text-sm)] text-[var(--sf-label2)] hover:text-[var(--sf-label)] disabled:opacity-30 transition-colors sm:h-7 sm:w-7">
              ←
            </button>
            <span className="min-w-[3.5rem] text-center text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{activeYear}</span>
            <button type="button" aria-label="Next year" onClick={() => setActiveYear(y => Math.min(maxYear, y + 1))}
              disabled={activeYear >= maxYear}
              className="h-11 w-11 flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--sf-border)] text-[var(--text-sm)] text-[var(--sf-label2)] hover:text-[var(--sf-label)] disabled:opacity-30 transition-colors sm:h-7 sm:w-7">
              →
            </button>
            {activeYear > thisYear && <span className="text-[var(--text-xs)] font-medium text-[var(--sf-orange)]">Advance</span>}
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {MONTH_NAMES.map((name, i) => {
              const lbl      = monthLabel(activeYear, i);
              const selected = selectedMonths.has(lbl);
              const future   = activeYear > thisYear || (activeYear === thisYear && i > thisMonth);
              return (
                <button key={name} type="button" aria-pressed={selected} onClick={() => toggleMonth(lbl)}
                  className={`min-h-11 min-w-0 rounded-[var(--radius-sm)] text-[var(--text-xs)] font-medium transition-colors border text-center sm:min-h-8 ${
                    selected
                      ? future ? 'bg-[var(--sf-orange)] border-[var(--sf-orange)] text-white'
                               : 'bg-[var(--sf-blue)] border-[var(--sf-blue)] text-white'
                      : future ? 'border-[color-mix(in_srgb,var(--sf-orange)_30%,transparent)] text-[var(--sf-label2)] hover:border-[var(--sf-orange)]/60'
                               : 'border-[var(--sf-border)] text-[var(--sf-label2)] hover:text-[var(--sf-label)]'
                  }`}>
                  {name}
                </button>
              );
            })}
          </div>

          {selectedMonths.size > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {orderedSelected.map(m => {
                const fut = parseMonthLabel(m) > new Date(thisYear, thisMonth, 1);
                return (
                  <span key={m} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[var(--text-xs)] font-medium ${
                    fut ? 'bg-[color-mix(in_srgb,var(--sf-orange)_12%,transparent)] text-[var(--sf-orange)]'
                        : 'bg-[color-mix(in_srgb,var(--sf-blue)_10%,transparent)] text-[var(--sf-blue)]'
                  }`}>
                    {m}
                    <button type="button" aria-label={`Remove ${m}`} onClick={() => toggleMonth(m)} className="opacity-60 hover:opacity-100 text-[10px]">✕</button>
                  </span>
                );
              })}
            </div>
          )}
          {errors.months_covered && <p role="alert" className="mt-1 text-[var(--text-xs)] text-[var(--sf-red)]">{errors.months_covered}</p>}
        </fieldset>
        )}
        </div>
      )}

      {/* Reference number */}
      {(showUtr || paymentType === 'other-income') && (
        <Input
          label={paymentType === 'other-income' ? 'Reference Number' : 'UTR / Reference Number'}
          value={utrReference}
          onChange={e => setUtrReference(e.target.value)}
          error={errors.utr_reference}
          placeholder="e.g. UPI123456789"
          hint={paymentType === 'other-income' ? 'Optional' : 'Transaction ID from your UPI / banking app'}
          tooltip={paymentType !== 'other-income' ? <Tooltip text="UTR (Unique Transaction Reference) for UPI/NEFT/IMPS, or the cheque number for cash/cheque payments. Optional — helps with future reconciliation." /> : undefined}
        />
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="pay-notes" className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">
            Notes (optional)
          </label>
          <span className={`text-[var(--text-xs)] tabular-nums ${notes.length >= 450 ? 'text-[var(--sf-orange)]' : 'text-[var(--sf-label3)]'}`}>
            {notes.length}/500
          </span>
        </div>
        <textarea id="pay-notes" value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} maxLength={500}
          placeholder={paymentType === 'other-income' ? 'e.g. Received from contractor for board installation' : 'e.g. Advance payment for Jul 2026'}
          className="block w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-[var(--text-sm)] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)] transition-colors hover:border-[color-mix(in_srgb,var(--sf-label)_28%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)] resize-none" />
        {errors.notes && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{errors.notes}</p>}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1 border-t border-[var(--sf-divider)]">
        <Button type="button" variant="secondary" onClick={() => onCancel ? onCancel() : router.back()} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" isLoading={submitting} disabled={paymentType === 'levy' && levyLabels.length === 0}>
          {paymentType === 'other-income' ? 'Record Income' : 'Record Payment'}
        </Button>
      </div>
      <Modal
        open={overlapConfirmation !== null}
        onClose={() => setOverlapConfirmation(null)}
        title="Months already recorded"
      >
        <div className="space-y-4">
          <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">
            These months already appear on active payments for this flat. Continue only if this is an intentional split payment.
          </p>
          <div className="space-y-2">
            {(overlapConfirmation?.conflicts ?? []).map(conflict => (
              <div key={conflict.month} className="rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] p-3">
                <p className="text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">{conflict.month}</p>
                {conflict.payments.map(payment => (
                  <p key={payment.id} className="mt-1 text-[var(--text-xs)] text-[var(--sf-label2)]">
                    {payment.receipt_number ?? 'No receipt'} · {payment.payment_date} · ₹{Number(payment.amount_paid).toLocaleString('en-IN')}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOverlapConfirmation(null)} disabled={submitting}>
              Go back
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const pending = overlapConfirmation?.payment;
                if (pending) void recordMaintenance(pending, true);
              }}
              disabled={submitting}
            >
              Record anyway
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
