'use client';
import { useMemo, useState } from 'react';
import { societyFetch } from '@/lib/society-path';
import { formatINR } from '@/lib/utils/currency';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { useAccountPaymentAmount } from './AccountPaymentAmount';

type Props = {
  suggestedAmount: number;
  canPayOnline: boolean;
  upiLink: string | null;
};

function upiLinkWithAmount(link: string | null, amount: number): string | null {
  if (!link || !(amount > 0)) return null;
  const url = new URL(link);
  url.searchParams.set('am', amount.toFixed(2));
  return url.toString();
}

export default function PayButtons({ suggestedAmount, canPayOnline, upiLink }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sharedAmount = useAccountPaymentAmount();
  const [localAmount, setLocalAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount) : '');
  const amount = sharedAmount?.amount ?? localAmount;
  const setAmount = sharedAmount?.setAmount ?? setLocalAmount;
  const numericAmount = Number(amount);
  const validAmount = numericAmount > 0 && numericAmount <= 500_000
    && Math.abs(numericAmount * 100 - Math.round(numericAmount * 100)) < 1e-7;
  const effectiveUpiLink = useMemo(
    () => validAmount ? upiLinkWithAmount(upiLink, numericAmount) : null,
    [upiLink, numericAmount, validAmount],
  );

  async function handlePayOnline() {
    if (!validAmount) {
      setError('Enter an amount from ₹0.01 to ₹5,00,000, using at most two decimal places.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await societyFetch('/api/payments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numericAmount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not start payment. Please try again.');
      }
      const { short_url } = await res.json() as { short_url: string };
      window.location.href = short_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start payment. Please try again.');
      setSubmitting(false);
    }
  }

  if (!canPayOnline && !upiLink) return null;

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <label htmlFor="account-payment-amount" className="block text-[var(--text-xs)] font-medium text-[var(--sf-label2)]">
            Amount to pay
          </label>
          <Tooltip text="Pay any amount. It clears the oldest maintenance or AMC first; any extra stays as account credit. Upload your UPI screenshot below." />
        </div>
        <input
          id="account-payment-amount"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="500000"
          step="0.01"
          value={amount}
          onChange={event => { setAmount(event.target.value); setError(''); }}
          className="min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] text-[var(--sf-label)]"
        />
      </div>
      {canPayOnline && (
        <Button
          onClick={handlePayOnline}
          loading={submitting}
          disabled={!validAmount}
          className="min-h-11 w-full"
        >
          Pay {validAmount ? formatINR(numericAmount) : 'online'}
        </Button>
      )}
      {error && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{error}</p>}
      {upiLink && (
        <div>
          <a
            role="link"
            href={effectiveUpiLink ?? undefined}
            aria-disabled={!effectiveUpiLink}
            onClick={event => { if (!effectiveUpiLink) event.preventDefault(); }}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--sf-border)] px-4 text-[var(--text-sm)] font-medium text-[var(--sf-label)] transition-colors hover:bg-black/[0.03] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            Pay {validAmount ? formatINR(numericAmount) : ''} by UPI
          </a>
        </div>
      )}
    </div>
  );
}
