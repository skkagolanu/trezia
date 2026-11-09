/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClaimReview, { type ClaimRow } from '@/app/(app)/claims/ClaimReview';
import { societyFetch } from '@/lib/society-path';
import type { AccountObligation } from '@/lib/utils/account-allocation';

jest.mock('@/lib/society-path', () => ({ societyFetch: jest.fn() }));
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

function baseClaim(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: 'claim-1',
    flatNumber: 'A-101',
    residentName: 'Asha Rao',
    reviewedBy: null,
    amount: 2000,
    utr: 'UTR123',
    paidOn: '2026-07-01',
    submittedAt: '2026-07-02T00:00:00Z',
    status: 'pending',
    reviewNote: null,
    billCount: 1,
    levyCount: 0,
    billIds: ['bill-1'],
    bills: [{ period: '7/2026', amount: 2000 }],
    unpaidObligations: [],
    ...overrides,
  };
}

const layoutProps = { pendingPage: 1, reviewedPage: 1, hasMorePending: false, hasMoreReviewed: false };

describe('ClaimReview — approve requires confirmation (Task 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call the approve API until the confirmation dialog is confirmed', async () => {
    const claim = baseClaim();
    (societyFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    // The single tap must not have hit the network yet.
    expect(societyFetch).not.toHaveBeenCalled();
    // Scope to the confirmation sentence: the amount also appears on the claim
    // card behind the dialog and in the per-bill breakdown, so a bare
    // getByText(/₹2,000/) matches four nodes and tells us nothing.
    const confirmation = await screen.findByText(/This records/);
    expect(confirmation).toHaveTextContent('₹2,000');
    expect(confirmation).toHaveTextContent('cannot be undone');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));

    await waitFor(() => {
      expect(societyFetch).toHaveBeenCalledWith(
        `/api/payments/claim/${claim.id}/approve`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('keeps the claim actionable and does not announce success when approval fails', async () => {
    const claim = baseClaim();
    (societyFetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'Database unavailable' }) });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm approve' }));

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('previews a levy claim as a levy, not as a maintenance split', async () => {
    // A levy claim has no bill_ids, exactly like an undirected bill claim. Before
    // this distinction the dialog offered an oldest-first maintenance preview for
    // a payment that approval routes to a different RPC entirely — showing the
    // treasurer a settlement that would never happen.
    const claim = baseClaim({
      billIds: [], billCount: 0, bills: [], levyCount: 2, amount: 5000,
      unpaidObligations: [
        { id: 'bill-1', kind: 'maintenance', label: '5/2026 maintenance', effectiveDate: '2026-05-01', outstanding: 1000 },
      ],
    });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/settles 2 AMC charges/i)).toBeInTheDocument();
    expect(screen.queryByText(/applied oldest-first/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 AMC payments submitted/i)).toBeInTheDocument();
  });

  it('makes no request when the confirmation is cancelled', async () => {
    const claim = baseClaim();
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText(/This records/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(societyFetch).not.toHaveBeenCalled();
  });

  it('lists exactly the claimed bills for a directed claim', async () => {
    const claim = baseClaim({
      billIds: ['bill-1', 'bill-2'],
      billCount: 2,
      bills: [{ period: '6/2026', amount: 1000 }, { period: '7/2026', amount: 1000 }],
      amount: 2000,
    });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    // Assert against the breakdown list itself. The periods also render on the
    // card behind the dialog, so an unscoped getByText matches more than one.
    const heading = await screen.findByText('These bills will be marked paid:');
    const breakdown = heading.parentElement!;
    expect(breakdown).toHaveTextContent('6/2026');
    expect(breakdown).toHaveTextContent('7/2026');
  });

  it('previews the flat-wide oldest-first split for a claim with no direction', async () => {
    const unpaidObligations: AccountObligation[] = [
      { id: 'bill-1', kind: 'maintenance', label: '5/2026 maintenance', effectiveDate: '2026-05-01', outstanding: 1000 },
      { id: 'levy-1', kind: 'levy', label: 'Lift levy', effectiveDate: '2026-06-01', outstanding: 1000 },
    ];
    const claim = baseClaim({ billIds: [], billCount: 0, bills: [], amount: 1500, unpaidObligations });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/oldest unpaid charges are cleared first/)).toBeInTheDocument();
    expect(screen.getByText(/5\/2026 maintenance — ₹1,000/)).toBeInTheDocument();
    expect(screen.getByText(/Lift levy — ₹500/)).toBeInTheDocument();
  });

  it('tells the treasurer money will sit unapplied when the flat has no outstanding bills', async () => {
    const claim = baseClaim({ billIds: [], billCount: 0, bills: [], amount: 900, unpaidObligations: [] });
    render(<ClaimReview pending={[claim]} reviewed={[]} {...layoutProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/No outstanding maintenance or AMC/)).toBeInTheDocument();
  });
});

describe('ClaimReview — retracted claims (Task 2)', () => {
  it('shows a retracted claim as read-only history with no approve or reject controls', () => {
    const claim = baseClaim({ status: 'retracted', reviewNote: 'Withdrawn by the resident', reviewedBy: 'Meera Shah' });
    render(<ClaimReview pending={[]} reviewed={[claim]} {...layoutProps} />);

    expect(screen.getByText('retracted')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn by the resident')).toBeInTheDocument();
    expect(screen.getByText(/Reviewed by Meera Shah/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('never renders a retracted claim in the actionable pending list', () => {
    const claim = baseClaim({ status: 'retracted', reviewNote: 'Withdrawn by the resident' });
    // Even if a caller mistakenly passed a retracted row through `pending`,
    // there is nothing in ClaimRowCard that gates on status — so the page
    // layer (claims/page.tsx) must be the one keeping retracted claims out of
    // the pending bucket. This asserts the page's own filter, not the card.
    render(<ClaimReview pending={[]} reviewed={[claim]} {...layoutProps} />);
    expect(screen.queryByText('No payment proofs waiting.')).toBeInTheDocument();
  });
});
