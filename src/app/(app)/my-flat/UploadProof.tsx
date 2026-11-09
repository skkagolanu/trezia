'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { societyFetch } from '@/lib/society-path';
import { formatINR } from '@/lib/utils/currency';
import { extractPaymentFields } from '@/lib/payments/ocr';
import { paymentProofFileError } from '@/lib/payments/proof';
import { allocateDirected, outstandingOn, type AppropriableBill } from '@/lib/utils/appropriation';
import { allocateAccount, type AccountObligation } from '@/lib/utils/account-allocation';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { useAccountPaymentAmount } from './AccountPaymentAmount';

// Paise-level rounding tolerance, matching src/lib/utils/appropriation.ts —
// duplicated locally rather than exported from that pure module just for a
// display threshold.
const EPSILON = 0.005;

export type PayableBillSummary = {
  id: string;
  /** Precomputed by the server component, e.g. "Aug 2026". */
  label: string;
  bill_period_year: number;
  bill_period_month: number;
  payable_amount: number;
  amount_settled: number;
  penalty_amount: number;
  due_date?: string;
};

export type PayableAccountLevySummary = {
  id: string;
  levy_label: string;
  outstanding: number;
  created_at: string;
};

type Props = {
  /** Every bill this resident could still pay. Empty means no dues at all — a
   *  submission with no bill in it is recorded as an advance (migration 066). */
  bills: PayableBillSummary[];
  levies?: PayableAccountLevySummary[];
  suggestedAmount: number;
};

type Status = 'idle' | 'ocr' | 'submitting' | 'success' | 'duplicate' | 'error';

// Contract Act s.59 vs s.61 — see src/lib/utils/appropriation.ts. 'oldest' asks
// the server to appropriate the payment itself (bill_ids: []); 'choose' directs
// specific months and must match their exact payable total.
type Direction = 'oldest' | 'choose';

function toAppropriable(bill: PayableBillSummary): AppropriableBill {
  return {
    id: bill.id,
    bill_period_year: bill.bill_period_year,
    bill_period_month: bill.bill_period_month,
    payable_amount: Number(bill.payable_amount),
    amount_settled: Number(bill.amount_settled),
    penalty_amount: Number(bill.penalty_amount),
  };
}

export default function UploadProof({ bills, levies = [], suggestedAmount }: Props) {
  const router = useRouter();
  const sharedAccountAmount = useAccountPaymentAmount();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreTriggerFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [paidOn, setPaidOn] = useState('');
  // Per-field "the resident typed into this" flags. Recognition may finish
  // after the resident has already started filling the form by hand — it must
  // never clobber what they typed, only fill in what they left blank.
  const [amountTouched, setAmountTouched] = useState(false);
  const [utrTouched, setUtrTouched] = useState(false);
  const [paidOnTouched, setPaidOnTouched] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const [direction, setDirection] = useState<Direction>('oldest');
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const hasPayableBills = bills.length > 0;
  const hasPayableDues = hasPayableBills || levies.length > 0;
  const appropriable = useMemo(() => bills.map(toAppropriable), [bills]);
  const billById = useMemo(() => new Map(bills.map(bill => [bill.id, bill])), [bills]);
  const selectedBillIdSet = useMemo(() => new Set(selectedBillIds), [selectedBillIds]);

  useEffect(() => {
    if (open) {
      fileInputRef.current?.focus();
    } else if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // What the chosen months still owe, not what they were billed. The server's
  // assert_payable_bills compares the submitted amount against the same
  // outstanding total, so summing payable_amount here made a directed claim on
  // a part-settled month fail with a mismatch the resident could not resolve.
  const selectedTotal = useMemo(
    () => bills.reduce(
      (sumPaise, bill) => selectedBillIdSet.has(bill.id)
        ? sumPaise + Math.round(outstandingOn(toAppropriable(bill)) * 100)
        : sumPaise,
      0,
    ) / 100,
    [bills, selectedBillIdSet],
  );

  const accountObligations = useMemo<AccountObligation[]>(() => [
    // The page query supplies newest-first bills for display; reverse a copy so
    // each ledger meets allocateAccount's O(n) merge contract.
    ...[...bills].reverse().map(bill => ({
      id: bill.id,
      kind: 'maintenance' as const,
      label: `${bill.label} maintenance`,
      effectiveDate: `${bill.bill_period_year}-${String(bill.bill_period_month).padStart(2, '0')}-01`,
      outstanding: outstandingOn(toAppropriable(bill)),
    })),
    ...levies.map(levy => ({
      id: levy.id,
      kind: 'levy' as const,
      label: levy.levy_label,
      effectiveDate: levy.created_at.slice(0, 10),
      outstanding: levy.outstanding,
    })),
  ], [bills, levies]);

  // What the flat-wide bucket will cover, so a cross-ledger or partial payment
  // is visible before submission. This mirrors migration 073's ordering.
  const oldestPreview = useMemo(
    () => allocateAccount(accountObligations, Number(amount) || 0),
    [accountObligations, amount],
  );
  const choosePreview = useMemo(
    () => allocateDirected(appropriable, selectedBillIds, selectedTotal),
    [appropriable, selectedBillIds, selectedTotal],
  );

  function billLabel(id: string): string {
    return billById.get(id)?.label ?? '';
  }

  function toggleSelected(id: string) {
    setSelectedBillIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  function setDirectionMode(next: Direction) {
    setDirection(next);
    if (next === 'oldest') setSelectedBillIds([]);
  }

  function openForm() {
    if (!amountTouched && !amount) {
      const chosenAmount = Number(sharedAccountAmount?.amount);
      setAmount(String(chosenAmount > 0 ? chosenAmount : suggestedAmount > 0 ? suggestedAmount : ''));
    }
    setOpen(true);
  }

  function closeForm() {
    restoreTriggerFocus.current = true;
    setOpen(false);
  }

  async function handleFileChange(selected: File | null) {
    setErrorMessage('');
    setFile(selected);
    setAutofilled(false);
    if (!selected) return;
    const fileError = paymentProofFileError(selected);
    if (fileError) {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrorMessage(fileError);
      setStatus('error');
      return;
    }
    setStatus('ocr');
    try {
      const result = await extractPaymentFields(selected);
      let filledSomething = false;
      // Amount is only ever auto-set here in "oldest first" mode — in "choose
      // months" mode the field is derived from the selection, not typed.
      if (!amountTouched && direction === 'oldest') {
        if (result.amount != null) {
          setAmount(String(result.amount));
          filledSomething = true;
        } else if (!amount && suggestedAmount > 0) {
          setAmount(String(suggestedAmount));
        }
      }
      if (!utrTouched && result.utr) {
        setUtr(result.utr);
        filledSomething = true;
      }
      if (!paidOnTouched && result.paidOn) {
        setPaidOn(result.paidOn);
        filledSomething = true;
      }
      setAutofilled(filledSomething);
      setStatus('idle');
    } catch {
      setErrorMessage('We could not read that screenshot automatically. You can still enter the payment details manually.');
      setStatus('error');
    }
  }

  async function handleSubmit() {
    const billIdsToSubmit = direction === 'choose' ? selectedBillIds : [];
    const amountToSubmit = direction === 'choose' ? selectedTotal : Number(amount);
    if (!file) return;
    if (direction === 'choose' && selectedBillIds.length === 0) {
      setErrorMessage('Choose at least one month.');
      setStatus('error');
      return;
    }
    if (!(amountToSubmit > 0)) return;
    if (paidOn && paidOn > new Date().toISOString().slice(0, 10)) {
      setErrorMessage('The payment date cannot be in the future.');
      setStatus('error');
      return;
    }
    setStatus('submitting');
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('bill_ids', JSON.stringify(billIdsToSubmit));
      formData.append('amount', String(amountToSubmit));
      if (utr) formData.append('utr', utr);
      if (paidOn) formData.append('paid_on', paidOn);
      formData.append('screenshot', file);

      const res = await societyFetch('/api/payments/claim', { method: 'POST', body: formData });

      if (res.status === 201) {
        setStatus('success');
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setStatus('duplicate');
        return;
      }
      const body = await res.json().catch(() => null) as { error?: string } | null;
      setErrorMessage(body?.error ?? 'Could not submit your proof. Please try again.');
      setStatus('error');
    } catch {
      setErrorMessage('Could not submit your proof. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <p className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-green)_6%,var(--sf-surface))] px-4 py-2.5 text-[var(--text-xs)] font-medium text-[var(--sf-green)]">
        Sent to the treasurer for approval — you&apos;ll be notified.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        variant="secondary"
        className="min-h-11 w-full"
        onClick={openForm}
      >
        I&apos;ve paid — upload proof
      </Button>
    );
  }

  const effectiveAmount = direction === 'choose' ? selectedTotal : Number(amount);
  const canSubmit = !!file
    && effectiveAmount > 0
    && (direction !== 'choose' || selectedBillIds.length > 0)
    && status !== 'submitting'
    && status !== 'ocr';

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3 space-y-3">
      {!hasPayableDues && (
        <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">
          You have no outstanding dues. This amount will stay as account credit for future maintenance or AMC.
        </p>
      )}

      <div>
        <label htmlFor="proof-screenshot" className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)] mb-1">
          Payment screenshot
        </label>
        <input
          ref={fileInputRef}
          id="proof-screenshot"
          type="file"
          accept="image/jpeg,image/png"
          onChange={e => { void handleFileChange(e.target.files?.[0] ?? null); }}
          className="block w-full min-h-11 text-[var(--text-sm)] text-[var(--sf-label)] file:mr-3 file:min-h-11 file:rounded-[var(--radius-md)] file:border-0 file:bg-black/[0.06] file:px-3 file:text-[var(--text-xs)] file:font-medium file:text-[var(--sf-label)]"
        />
        {status === 'ocr' && (
          <p role="status" aria-busy="true" className="mt-1 flex items-center gap-1.5 text-[var(--text-xs)] text-[var(--sf-label3)]">
            <svg aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Reading your screenshot…
          </p>
        )}
        {autofilled && status !== 'ocr' && (
          <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label3)]">
            We found some details in your screenshot. Please check and complete anything missing before submitting.
          </p>
        )}
      </div>

      {hasPayableDues && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[var(--text-xs)] font-medium text-[var(--sf-label2)]">Apply payment to</p>
            <Tooltip text="This clears the oldest maintenance or AMC due first. Any extra stays as account credit." />
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]">
            <input
              type="radio"
              name="direction"
              checked={direction === 'oldest'}
              onChange={() => setDirectionMode('oldest')}
            />
            <span>Oldest unpaid charges</span>
          </label>
          {hasPayableBills && <label className="flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]">
            <input
              type="radio"
              name="direction"
              checked={direction === 'choose'}
              onChange={() => setDirectionMode('choose')}
            />
            <span>Chosen maintenance months</span>
          </label>}
        </div>
      )}

      {hasPayableBills && direction === 'choose' && (
        <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--sf-border)] p-2">
          {bills.map(b => (
            <label key={b.id} className="flex items-center justify-between gap-2 text-[var(--text-sm)] text-[var(--sf-label)]">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedBillIdSet.has(b.id)}
                  onChange={() => toggleSelected(b.id)}
                />
                {b.label}
              </span>
              <span className="tabular text-[var(--sf-label2)]">{formatINR(outstandingOn(toAppropriable(b)))}</span>
            </label>
          ))}
          <p className="mt-1 border-t border-[var(--sf-divider)] pt-1.5 text-[var(--text-xs)] text-[var(--sf-label2)]">
            Total for selected months: <span className="font-semibold tabular">{formatINR(selectedTotal)}</span> — this must be the exact amount you send.
          </p>
        </div>
      )}

      {direction === 'choose' && hasPayableBills ? (
        <div>
          <p className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)] mb-1">Amount paid</p>
          <p className="flex min-h-11 w-full items-center rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] font-semibold tabular text-[var(--sf-label)]">
            {formatINR(selectedTotal)}
          </p>
          <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label3)]">Set automatically from the months you selected above.</p>
        </div>
      ) : (
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <label htmlFor="proof-amount" className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)]">
              Amount paid{suggestedAmount > 0 ? ` (${formatINR(suggestedAmount)} due)` : ''}
            </label>
            {hasPayableDues && <Tooltip text="You may enter any positive amount. It can partly pay the next charge; only money left after every current charge becomes account credit." />}
          </div>
          <input
            id="proof-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={e => { setAmount(e.target.value); setAmountTouched(true); }}
            className="w-full min-h-11 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]"
          />
        </div>
      )}

      {direction === 'oldest' && hasPayableDues && Number(amount) > 0 && (
        <div className="rounded-[var(--radius-md)] bg-black/[0.03] p-2.5 text-[var(--text-xs)] text-[var(--sf-label2)]">
          {oldestPreview.allocations.length > 0 ? (
            <>
              <p className="font-medium text-[var(--sf-label)]">This will cover:</p>
              <ul className="mt-1 space-y-0.5">
                {oldestPreview.allocations.map(allocation => (
                  <li key={`${allocation.kind}-${allocation.obligationId}`}>
                    {allocation.label} — {formatINR(allocation.applied)}{allocation.settlesObligation ? '' : ' (partial)'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>This will be kept as credit until you have a due to apply it to.</p>
          )}
          {oldestPreview.unapplied > EPSILON && (
            <p className="mt-1">{formatINR(oldestPreview.unapplied)} left over will be kept as credit toward a future due.</p>
          )}
        </div>
      )}

      {direction === 'choose' && hasPayableBills && selectedBillIds.length > 0 && (
        <div className="rounded-[var(--radius-md)] bg-black/[0.03] p-2.5 text-[var(--text-xs)] text-[var(--sf-label2)]">
          <p className="font-medium text-[var(--sf-label)]">This will fully settle:</p>
          <ul className="mt-1 space-y-0.5">
            {choosePreview.perBill.map(a => (
              <li key={a.bill_id}>{billLabel(a.bill_id)} — {formatINR(a.applied)}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="proof-utr" className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)] mb-1">
          UTR / reference number (optional)
        </label>
          <input
          id="proof-utr"
          type="text"
          value={utr}
          onChange={e => { setUtr(e.target.value); setUtrTouched(true); }}
          className="w-full min-h-11 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]"
        />
      </div>

      <div>
        <label htmlFor="proof-paid-on" className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)] mb-1">
          Date paid (optional)
        </label>
        <input
          id="proof-paid-on"
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          value={paidOn}
          onChange={e => { setPaidOn(e.target.value); setPaidOnTouched(true); }}
          className="w-full min-h-11 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]"
        />
      </div>

      {status === 'duplicate' && (
        <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">
          You already have a pending submission that overlaps this payment.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{errorMessage}</p>
      )}

      <div className="flex gap-2">
        {status === 'submitting' && <p role="status" aria-busy="true" className="sr-only">Submitting your proof for approval…</p>}
        <Button
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          loading={status === 'submitting'}
          aria-busy={status === 'submitting'}
          className="min-h-11 flex-1"
        >
          Submit for approval
        </Button>
        <Button
          variant="secondary"
          onClick={closeForm}
          disabled={status === 'submitting'}
          className="min-h-11"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
