'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { societyFetch } from '@/lib/society-path';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { allocateAccount, type AccountObligation } from '@/lib/utils/account-allocation';

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'retracted';

export type ClaimRow = {
  id: string;
  flatNumber: string;
  residentName: string;
  reviewedBy: string | null;
  amount: number;
  utr: string | null;
  paidOn: string | null;
  submittedAt: string;
  status: ClaimStatus;
  reviewNote: string | null;
  billCount: number;
  // A levy claim carries assessments instead of bills. Both have zero bill_ids,
  // so without this the interface reports a levy payment as "0 bills" and the
  // approval dialog previews a maintenance split that will never happen —
  // approval routes a levy claim to a different RPC entirely.
  levyCount: number;
  billIds: string[];
  bills: { period: string; amount: number }[];
  // The unit's outstanding account charges, oldest first, for claims with no
  // direction — approval sweeps these the same way allocateAccount() does, so the
  // confirmation dialog can preview it. Empty for directed claims and for
  // anything that isn't pending.
  unpaidObligations: AccountObligation[];
};

const statusColor: Record<ClaimStatus, 'yellow' | 'green' | 'red' | 'gray'> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
  retracted: 'gray',
};

interface Props {
  pending: ClaimRow[];
  reviewed: ClaimRow[];
  pendingPage: number;
  reviewedPage: number;
  hasMorePending: boolean;
  hasMoreReviewed: boolean;
}

export default function ClaimReview({ pending, reviewed, pendingPage, reviewedPage, hasMorePending, hasMoreReviewed }: Props) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const visiblePending = pending.filter(c => !resolved.has(c.id));

  function markResolved(claim: ClaimRow) {
    setResolved(prev => new Set([...prev, claim.id]));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {visiblePending.length > 0 ? (
          visiblePending.map(claim => (
            <ClaimRowCard
              key={claim.id}
              claim={claim}
              onApproved={() => {
                markResolved(claim);
                toast.success(`${claim.residentName}'s payment approved`);
                router.refresh();
              }}
              onRejected={() => {
                markResolved(claim);
                toast.success(`Payment submission for ${claim.flatNumber} rejected`);
                router.refresh();
              }}
            />
          ))
        ) : (
          <Card>
            <p className="py-6 text-center text-[13px] text-sf-label3">No payment proofs waiting.</p>
          </Card>
        )}
      </div>
      {(pendingPage > 1 || hasMorePending) && <Pagination label="Pending reviews" page={pendingPage} hasMore={hasMorePending} parameter="pending_page" otherPage={reviewedPage} />}

      {reviewed.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[12px] font-semibold uppercase tracking-wide text-sf-label3">Recently reviewed</p>
          <div className="space-y-1.5">
            {reviewed.map(claim => (
              <div
                key={claim.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-black/[0.06] bg-black/[0.015] px-3 py-2 opacity-75"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-sf-label">{claim.residentName}</span>
                  <span className="text-[12px] text-sf-label3">Flat {claim.flatNumber}</span>
                  <span className="text-[13px] text-sf-label2">{formatINR(claim.amount)}</span>
                  <Badge color={statusColor[claim.status]}>{claim.status}</Badge>
                  {claim.reviewNote && <span className="truncate text-[12px] text-sf-label3">{claim.reviewNote}</span>}
                </div>
                <span className="text-[12px] text-sf-label3">
                  {claim.reviewedBy ? `Reviewed by ${claim.reviewedBy} · ` : ''}{formatDate(claim.submittedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(reviewedPage > 1 || hasMoreReviewed) && <Pagination label="Reviewed history" page={reviewedPage} hasMore={hasMoreReviewed} parameter="reviewed_page" otherPage={pendingPage} />}
    </div>
  );
}

function Pagination({ label, page, hasMore, parameter, otherPage }: { label: string; page: number; hasMore: boolean; parameter: 'pending_page' | 'reviewed_page'; otherPage: number }) {
  const href = (value: number) => {
    const params = new URLSearchParams();
    if (value > 1) params.set(parameter, String(value));
    if (otherPage > 1) params.set(parameter === 'pending_page' ? 'reviewed_page' : 'pending_page', String(otherPage));
    return `?${params.toString()}`;
  };
  return <nav aria-label={label} className="flex justify-between text-[13px] text-sf-label2"><span>Page {page}</span><span className="flex gap-3">{page > 1 && <Link href={href(page - 1)} className="text-sf-blue">Previous</Link>}{hasMore && <Link href={href(page + 1)} className="text-sf-blue">Next</Link>}</span></nav>;
}

type ApprovalPreview =
  | { kind: 'directed'; lines: { period: string; amount: number }[] }
  | { kind: 'oldest-first'; lines: { label: string; amount: number }[]; unapplied: number }
  | { kind: 'no-charges' }
  | { kind: 'levy'; count: number };

// What approving this claim will actually do to the ledger, so the treasurer
// sees it before committing rather than after. Directed claims (months named)
// mark exactly those bills PAID; undirected claims sweep unpaidBills
// oldest-first through the same allocate() the approval RPC's loop mirrors.
function previewApproval(claim: ClaimRow): ApprovalPreview {
  // Checked before the bill branches: a levy claim also has no bill_ids, and
  // approval sends it to approve_resident_levy_claim, which settles the named
  // assessments and never touches a maintenance bill.
  if (claim.levyCount > 0) {
    return { kind: 'levy', count: claim.levyCount };
  }
  if (claim.billIds.length > 0) {
    return { kind: 'directed', lines: claim.bills };
  }
  if (claim.unpaidObligations.length === 0) {
    return { kind: 'no-charges' };
  }
  const allocation = allocateAccount(claim.unpaidObligations, claim.amount);
  const lines = allocation.allocations.map(row => ({ label: row.label, amount: row.applied }));
  return { kind: 'oldest-first', lines, unapplied: allocation.unapplied };
}

function ClaimRowCard({
  claim,
  onApproved,
  onRejected,
}: {
  claim: ClaimRow;
  onApproved: () => void;
  onRejected: () => void;
}) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState('');

  async function toggleProof() {
    if (proofUrl) {
      URL.revokeObjectURL(proofUrl);
      setProofUrl(null);
      return;
    }
    setLoadingProof(true);
    try {
      const res = await societyFetch(`/api/payments/claim/${claim.id}/screenshot`);
      if (!res.ok) throw new Error('Could not load the screenshot');
      const blob = await res.blob();
      setProofUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Could not load the payment screenshot');
    } finally {
      setLoadingProof(false);
    }
  }

  async function approve() {
    setShowApproveConfirm(false);
    setApproving(true);
    try {
      const res = await societyFetch(`/api/payments/claim/${claim.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'upi' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'The payment submission was not approved. Refresh and review it again.');
      }
      onApproved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The payment submission was not approved. Refresh and review it again.');
    } finally {
      setApproving(false);
      if (proofUrl) URL.revokeObjectURL(proofUrl);
    }
  }

  const preview = previewApproval(claim);

  async function reject() {
    setRejecting(true);
    try {
      const res = await societyFetch(`/api/payments/claim/${claim.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'The payment submission was not rejected. Refresh and review it again.');
      }
      onRejected();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The payment submission was not rejected. Refresh and review it again.');
    } finally {
      setRejecting(false);
      setShowReject(false);
      if (proofUrl) URL.revokeObjectURL(proofUrl);
    }
  }

  const busy = approving || rejecting;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-semibold text-sf-label">{claim.residentName}</span>
              <span className="text-[13px] text-sf-label2">Flat {claim.flatNumber}</span>
              <Badge color={statusColor[claim.status]}>{claim.status}</Badge>
            </div>
            <p className="mt-1 text-[20px] font-bold tracking-tight text-sf-green">{formatINR(claim.amount)}</p>
          </div>
          <div className="text-right text-[12px] text-sf-label3">
            <p>Submitted {formatDate(claim.submittedAt)}</p>
            {claim.paidOn && <p>Paid on {formatDate(claim.paidOn)}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-sf-label2">
          <span>UTR: <span className="font-mono text-sf-label">{claim.utr ?? 'Not provided'}</span></span>
          <span>
            {claim.levyCount > 0
              ? `${claim.levyCount} AMC payment${claim.levyCount === 1 ? '' : 's'} submitted`
              : claim.billCount > 0
                ? `${claim.billCount} maintenance bill${claim.billCount === 1 ? '' : 's'} submitted`
                : 'Oldest unpaid charges first'}
          </span>
        </div>
        {claim.billIds.length > 0 && (
          <div className="text-[12px] text-sf-label2">
            <p>Maintenance months: {claim.bills.length ? claim.bills.map(bill => bill.period).join(', ') : 'Details unavailable'}</p>
            {claim.bills.length > 0 && Math.abs(claim.amount - claim.bills.reduce((sum, bill) => sum + bill.amount, 0)) > 0.009 && <p role="alert" className="mt-1 font-medium text-sf-orange">The submitted amount differs from these months. Check the proof before approving.</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={toggleProof}
            loading={loadingProof}
            disabled={busy}
          >
            {proofUrl ? 'Hide proof' : 'View proof'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="min-h-11"
            onClick={() => setShowApproveConfirm(true)}
            loading={approving}
            disabled={busy}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="min-h-11"
            onClick={() => setShowReject(v => !v)}
            disabled={busy}
          >
            Reject
          </Button>
        </div>

        {proofUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- blob: object URL, next/image cannot optimize it
          <img
            src={proofUrl}
            alt={`Payment proof for ${claim.flatNumber}`}
            className="max-h-[420px] w-full rounded-[10px] border border-black/[0.08] object-contain"
          />
        )}

        {showReject && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-sf-red/20 bg-sf-red/[0.05] p-3">
            <label className="text-[13px] font-medium text-sf-label">
              Reason for rejection <span className="text-sf-label3 font-normal">(shown to the resident)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Screenshot doesn't match the claimed amount"
              className="w-full rounded-[10px] border border-black/[0.12] bg-sf-surface px-3 py-2 text-[14px] text-sf-label placeholder:text-sf-label3 focus:outline-none focus:ring-2 focus:ring-sf-red"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" className="min-h-11" onClick={() => setShowReject(false)} disabled={rejecting}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" className="min-h-11" onClick={reject} loading={rejecting}>
                Confirm reject
              </Button>
            </div>
          </div>
        )}

        <Modal open={showApproveConfirm} onClose={() => !approving && setShowApproveConfirm(false)} title="Approve payment" size="sm">
          <div className="space-y-4">
            <p className="text-[14px] text-sf-label2">
              This records <span className="font-semibold text-sf-label">{formatINR(claim.amount)}</span> as
              received from <span className="font-semibold text-sf-label">{claim.flatNumber}</span>. It cannot
              be undone from here — a mistaken approval has to be voided from Payments afterwards.
            </p>

            {preview.kind === 'directed' && (
              <div className="rounded-[10px] bg-black/[0.03] px-3 py-2 text-[13px] text-sf-label2">
                <p className="font-medium text-sf-label">These bills will be marked paid:</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.lines.map(line => (
                    <li key={line.period}>{line.period} — {formatINR(line.amount)}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.kind === 'oldest-first' && (
              <div className="rounded-[10px] bg-black/[0.03] px-3 py-2 text-[13px] text-sf-label2">
                <p className="font-medium text-sf-label">No month was selected — oldest unpaid charges are cleared first:</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.lines.map(line => (
                    <li key={line.label}>{line.label} — {formatINR(line.amount)}</li>
                  ))}
                </ul>
                {preview.unapplied > 0.005 && (
                  <p className="mt-1">
                    {formatINR(preview.unapplied)} will remain as account credit for future maintenance or AMC.
                  </p>
                )}
              </div>
            )}

            {preview.kind === 'levy' && (
              <p className="rounded-[10px] bg-black/[0.03] px-3 py-2 text-[13px] text-sf-label2">
                This settles {preview.count} AMC charge{preview.count === 1 ? '' : 's'} for this flat.
                It does not touch their monthly maintenance bills.
              </p>
            )}

            {preview.kind === 'no-charges' && (
              <p className="rounded-[10px] bg-black/[0.03] px-3 py-2 text-[13px] text-sf-label2">
                No outstanding maintenance or AMC for this flat — the full {formatINR(claim.amount)} will
                remain as visible account credit until a future charge is raised.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowApproveConfirm(false)} disabled={approving}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={approve} loading={approving}>
                Confirm approve
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Card>
  );
}
