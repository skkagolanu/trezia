/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentForm from '@/components/forms/PaymentForm';
import { societyFetch } from '@/lib/society-path';

// Coverage instrumentation plus the full parallel suite can delay React's
// initial effect beyond Testing Library's one-second default on constrained CI
// runners. The mocked request resolves immediately; this only gives React time
// to commit that deterministic state transition.
jest.setTimeout(15_000);

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('@/lib/hooks/use-society-path', () => ({ useSocietyPath: () => (path: string) => path }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/society-path', () => ({ societyFetch: jest.fn() }));
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(),
  isDemoSessionClient: jest.fn(() => false),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (societyFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ units: [], levy_labels: [] }),
  });
});

describe('PaymentForm accessibility', () => {
  it('exposes selected button state and names its icon-only controls', async () => {
    render(<PaymentForm />);
    await waitFor(
      () => expect(screen.getByRole('combobox', { name: /flat/i })).not.toBeDisabled(),
      { timeout: 10_000 },
    );

    expect(screen.getByRole('button', { name: 'Maintenance' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: /oldest unpaid charges/i })).toBeChecked();
    expect(screen.queryByText('Months Covered')).not.toBeInTheDocument();
    const upi = screen.getByRole('button', { name: 'UPI' });
    expect(upi).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    expect(upi).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('radio', { name: /chosen maintenance months/i }));
    expect(screen.getByText('Months Covered')).toBeInTheDocument();
    const selectedMonth = new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date());
    expect(screen.getByRole('button', { name: selectedMonth })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Remove ${selectedMonth} ${new Date().getFullYear()}` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Other Income' }));
    expect(screen.getByRole('button', { name: 'Other Income' })).toHaveAttribute('aria-pressed', 'true');
    const categoryOther = screen.getAllByRole('button', { name: 'Other' })[0];
    expect(categoryOther).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ad Board' }));
    expect(categoryOther).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Ad Board' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a retry instead of silently presenting an empty flat list when options fail', async () => {
    (societyFetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    render(<PaymentForm />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Flats could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(societyFetch).toHaveBeenCalledTimes(2));
  });

  it('disables AMC recording when no AMC year is configured', async () => {
    render(<PaymentForm />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /flat/i })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'AMC' }));

    expect(screen.getByRole('alert')).toHaveTextContent('No AMC year is set up');
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeDisabled();
  });
});
