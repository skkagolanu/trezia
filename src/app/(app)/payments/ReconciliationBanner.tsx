import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils/currency';

// Online money the gateway confirmed against a bill that was already settled —
// shown on every /payments route (not just the default view) because a
// treasurer working the Bills or Levies tab needs to see it exactly as much as
// someone on the unified list. Never blocks or filters anything; it only flags
// rows for manual refund/credit review.
export default async function ReconciliationBanner({ societyId }: { societyId: string }) {
  const supabase = await createClient();
  const result = await supabase
    .from('resident_payment_links')
    .select('id, amount, razorpay_payment_id, payment_id, reconciliation_note, created_at, units!resident_payment_links_unit_id_fkey(flat_number)')
    .eq('society_id', societyId)
    .eq('reconciliation_required', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(25);

  if (result.error) {
    return (
      <div role="alert" className="rounded-[var(--radius-lg)] border border-sf-red/20 bg-sf-red/[0.06] px-4 py-3 text-[13px] text-sf-red">
        Gateway reconciliation items could not be loaded. Do not assume online payments are settled.
      </div>
    );
  }

  if (!result.data || result.data.length === 0) return null;

  return (
    <div role="alert" className="rounded-[var(--radius-lg)] border border-sf-orange/30 bg-sf-orange/[0.08] px-4 py-3">
      <p className="text-[13px] font-semibold text-sf-label">Online payments requiring reconciliation</p>
      <p className="mt-0.5 text-[12px] text-sf-label2">Money was confirmed by the gateway, but the selected bills were already settled. Review these for refund or credit without clearing more dues.</p>
      <ul className="mt-2 space-y-1 text-[12px] text-sf-label2">
        {result.data.map(item => {
          const unit = item.units as unknown as { flat_number?: string } | Array<{ flat_number?: string }> | null;
          const flat = Array.isArray(unit) ? unit[0]?.flat_number : unit?.flat_number;
          return (
            <li key={item.id}>
              <span className="font-semibold text-sf-label">{flat ?? 'Unknown flat'} · {formatINR(Number(item.amount))}</span>
              {' — '}{item.reconciliation_note ?? 'Gateway settlement conflict'}{item.razorpay_payment_id ? ` · ${item.razorpay_payment_id}` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
