export const metadata = { title: 'Payment reviews · Trezia' };

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import type { AccountObligation } from '@/lib/utils/account-allocation';
import ClaimReview, { type ClaimRow } from './ClaimReview';

type ClaimQueryRow = {
  id: string;
  unit_id: string;
  bill_ids: string[];
  levy_assessment_ids: string[] | null;
  amount: number;
  utr_reference: string | null;
  paid_on: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'retracted';
  review_note: string | null;
  submitted_at: string;
  payment_id: string | null;
  levy_collection_id: string | null;
  units: {
    flat_number: string;
    residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean }>;
  } | Array<{
    flat_number: string;
    residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean }>;
  }> | null;
};

function unitOf(units: ClaimQueryRow['units']) {
  return Array.isArray(units) ? units[0] : units;
}

function toClaimRow(row: ClaimQueryRow, reviewedBy: string | null): ClaimRow {
  const unit = unitOf(row.units);
  const residents = unit?.residents ?? [];
  const resident = residents.find(item => item.is_primary && item.is_active)
    ?? residents.find(item => item.is_active)
    ?? residents[0];
  return {
    id: row.id,
    flatNumber: unit?.flat_number ?? '—',
    residentName: resident?.full_name ?? 'Resident name unavailable',
    reviewedBy,
    amount: Number(row.amount),
    utr: row.utr_reference,
    paidOn: row.paid_on,
    submittedAt: row.submitted_at,
    status: row.status,
    reviewNote: row.review_note,
    billCount: row.bill_ids.length,
    levyCount: (row.levy_assessment_ids ?? []).length,
    billIds: row.bill_ids,
    bills: [],
    unpaidObligations: [],
  };
}

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ pending_page?: string; reviewed_page?: string }> }) {
  const params = await searchParams;
  const pendingPage = Math.max(1, Number.parseInt(params.pending_page ?? '1', 10) || 1);
  const reviewedPage = Math.max(1, Number.parseInt(params.reviewed_page ?? '1', 10) || 1);
  const pageSize = 25;
  const auth = await requireFinancialReader();
  if (auth.unauthorized?.status === 401) redirect('/login');
  if (auth.unauthorized) redirect('/access-denied');

  const supabase = await createClient();

  const [pendingResult, reviewedResult] = await Promise.all([
    supabase.from('resident_payment_claims')
      .select('id, unit_id, bill_ids, levy_assessment_ids, amount, utr_reference, paid_on, status, review_note, submitted_at, payment_id, levy_collection_id, units!resident_payment_claims_unit_same_society!inner(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active))')
      .eq('status', 'pending').order('submitted_at', { ascending: false }).order('id', { ascending: false }).range((pendingPage - 1) * pageSize, pendingPage * pageSize - 1),
    supabase.from('resident_payment_claims')
      .select('id, unit_id, bill_ids, levy_assessment_ids, amount, utr_reference, paid_on, status, review_note, submitted_at, payment_id, levy_collection_id, units!resident_payment_claims_unit_same_society!inner(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active))')
      .neq('status', 'pending').order('submitted_at', { ascending: false }).order('id', { ascending: false }).range((reviewedPage - 1) * pageSize, reviewedPage * pageSize - 1),
  ]);
  if (pendingResult.error || reviewedResult.error) {
    return <div className="flex flex-col"><PageHeader title="Payment reviews" subtitle="Verify resident-submitted payment proofs before recording them." /><Card><p role="alert" className="py-6 text-center text-[13px] text-sf-red">Payment submissions could not be loaded. Refresh the page before reviewing them.</p></Card></div>;
  }
  const claimsRaw = [...(pendingResult.data ?? []), ...(reviewedResult.data ?? [])] as unknown as ClaimQueryRow[];
  const billIds = [...new Set(claimsRaw.flatMap(claim => claim.bill_ids))];
  const paymentIds = claimsRaw.map(claim => claim.payment_id).filter((id): id is string => id !== null);
  const collectionIds = claimsRaw.map(claim => claim.levy_collection_id).filter((id): id is string => id !== null);
  const [billsResult, paymentPartiesResult, collectionPartiesResult] = await Promise.all([
    billIds.length
      ? supabase.from('bills').select('id,bill_period_year,bill_period_month,payable_amount').in('id', billIds)
      : Promise.resolve({ data: [], error: null }),
    paymentIds.length
      ? supabase.from('payments').select('id,recorded_by').in('id', paymentIds)
      : Promise.resolve({ data: [], error: null }),
    collectionIds.length
      ? supabase.from('amc_collections').select('id,recorded_by').in('id', collectionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (billsResult.error || paymentPartiesResult.error || collectionPartiesResult.error) {
    return <div className="flex flex-col"><PageHeader title="Payment reviews" subtitle="Verify resident-submitted payment proofs before recording them." /><Card><p role="alert" className="py-6 text-center text-[13px] text-sf-red">Payment details could not be loaded. Refresh the page before reviewing submissions.</p></Card></div>;
  }
  const billDetails = new Map((billsResult.data ?? []).map(b => [b.id, b]));
  const reviewedByPayment = new Map((paymentPartiesResult.data ?? []).map(row => [row.id, row.recorded_by]));
  const reviewedByCollection = new Map((collectionPartiesResult.data ?? []).map(row => [row.id, row.recorded_by]));

  // Undirected pending claims (no months named) settle oldest-first across
  // EVERY outstanding bill for the flat, not just bills the claim mentions —
  // approve_resident_payment_claim walks the same set. Fetch it so the
  // confirmation dialog can preview that split with allocate() before the
  // treasurer commits, rather than only showing what the resident typed.
  const advanceUnitIds = [...new Set(
    // A levy claim also has zero bill_ids, but approval routes it to the levy
    // RPC and never touches maintenance bills — previewing an oldest-first
    // maintenance split for one would show the treasurer something that will
    // not happen.
    claimsRaw.filter(row => row.status === 'pending' && row.bill_ids.length === 0 && (row.levy_assessment_ids ?? []).length === 0).map(row => row.unit_id),
  )];
  const [unpaidBillsResult, unpaidLeviesResult] = advanceUnitIds.length
    ? await Promise.all([
        supabase.from('bills')
          .select('id,unit_id,bill_period_year,bill_period_month,payable_amount,amount_settled')
          .in('unit_id', advanceUnitIds)
          .in('status', ['ISSUED', 'OVERDUE'])
          .eq('is_voided', false)
          .order('unit_id')
          .order('bill_period_year')
          .order('bill_period_month')
          .order('id'),
        supabase.from('levy_assessments')
          .select('id,unit_id,levy_label,amount,amount_settled,created_at')
          .in('unit_id', advanceUnitIds)
          .eq('status', 'PENDING')
          .eq('is_voided', false)
          .order('unit_id')
          .order('created_at')
          .order('id'),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (unpaidBillsResult.error || unpaidLeviesResult.error) {
    return <div className="flex flex-col"><PageHeader title="Payment reviews" subtitle="Verify resident-submitted payment proofs before recording them." /><Card><p role="alert" className="py-6 text-center text-[13px] text-sf-red">Account charge details could not be loaded. Refresh the page before reviewing payment submissions.</p></Card></div>;
  }
  const unpaidObligationsByUnit = new Map<string, AccountObligation[]>();
  for (const b of unpaidBillsResult.data ?? []) {
    const list = unpaidObligationsByUnit.get(b.unit_id) ?? [];
    list.push({
      id: b.id,
      kind: 'maintenance',
      label: `${b.bill_period_month}/${b.bill_period_year} maintenance`,
      effectiveDate: `${b.bill_period_year}-${String(b.bill_period_month).padStart(2, '0')}-01`,
      outstanding: Math.max(0, Number(b.payable_amount) - Number(b.amount_settled)),
    });
    unpaidObligationsByUnit.set(b.unit_id, list);
  }
  for (const levy of unpaidLeviesResult.data ?? []) {
    const list = unpaidObligationsByUnit.get(levy.unit_id) ?? [];
    list.push({
      id: levy.id,
      kind: 'levy',
      label: levy.levy_label,
      effectiveDate: levy.created_at.slice(0, 10),
      outstanding: Math.max(0, Number(levy.amount) - Number(levy.amount_settled)),
    });
    unpaidObligationsByUnit.set(levy.unit_id, list);
  }

  const claims = claimsRaw.map(row => ({
    ...toClaimRow(
      row,
      row.payment_id
        ? reviewedByPayment.get(row.payment_id) ?? null
        : row.levy_collection_id
          ? reviewedByCollection.get(row.levy_collection_id) ?? null
          : null,
    ),
    bills: row.bill_ids.map(id => billDetails.get(id)).filter((bill): bill is { id: string; bill_period_month: number; bill_period_year: number; payable_amount: number } => bill !== undefined).map(bill => ({ period: `${bill.bill_period_month}/${bill.bill_period_year}`, amount: Number(bill.payable_amount) })),
    unpaidObligations: row.status === 'pending' && row.bill_ids.length === 0 && (row.levy_assessment_ids ?? []).length === 0 ? (unpaidObligationsByUnit.get(row.unit_id) ?? []) : [],
  }));
  const pending = claims.filter(c => c.status === 'pending');
  const reviewed = claims.filter(c => c.status !== 'pending');

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payment reviews"
        subtitle="Verify resident-submitted UPI payment proofs before recording them."
        count={pending.length}
        countLabel="pending"
      />

      <div className="flex-1 py-3">
        {claims.length > 0 ? (
          <ClaimReview pending={pending} reviewed={reviewed} pendingPage={pendingPage} reviewedPage={reviewedPage} hasMorePending={pending.length === pageSize} hasMoreReviewed={reviewed.length === pageSize} />
        ) : (
          <Card>
            <div className="space-y-3 py-8 text-center">
              <p className="text-[14px] font-medium text-sf-label">No payment proofs waiting.</p>
              <p className="mx-auto max-w-md text-[13px] text-sf-label3">
                When a resident uploads a UPI payment screenshot from their flat page, it will show up here for review.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
