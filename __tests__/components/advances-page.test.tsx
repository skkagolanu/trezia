/** @jest-environment node */
import '@testing-library/jest-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import AdvancesPage from '@/app/(app)/advances/page';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn() }));
jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => { throw new Error('REDIRECT'); }),
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

const AUTH = {
  userId: 'treasurer-1', role: 'treasurer', unitId: null, societyId: 'society-1',
  societySlug: 'green-acres', societyStatus: 'active', isPlatformOwner: false, unauthorized: null,
};

// Every supabase query in this page is a promise-like chain: .select().eq().gt()...
// awaited at the end. Recording the chain's own methods (rather than a fresh
// mock per call) lets the test assert exactly which filters were used.
function makeChain(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.neq = jest.fn(self);
  chain.gt = jest.fn(self);
  chain.in = jest.fn(self);
  chain.order = jest.fn(self);
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function mockSupabase(options: {
  payments?: unknown[];
  expenditures?: unknown[];
  settlements?: unknown[];
  bills?: unknown[];
  paymentError?: unknown;
}) {
  const paymentsChain = makeChain({ data: options.payments ?? [], error: options.paymentError ?? null });
  const expendituresChain = makeChain({ data: options.expenditures ?? [], error: null });
  const settlementsChain = makeChain({ data: options.settlements ?? [], error: null });
  const billsChain = makeChain({ data: options.bills ?? [], error: null });

  const from = jest.fn((table: string) => {
    if (table === 'payments') return paymentsChain;
    if (table === 'expenditures') return expendituresChain;
    if (table === 'advance_settlements') return settlementsChain;
    if (table === 'bills') return billsChain;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, paymentsChain, expendituresChain, settlementsChain, billsChain };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue(AUTH);
});

describe('/advances query (Task 3)', () => {
  it('filters payments on unapplied_amount rather than payment_mode', async () => {
    const supabase = mockSupabase({ payments: [] });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    await AdvancesPage();

    expect(supabase.paymentsChain.gt).toHaveBeenCalledWith('unapplied_amount', 0);
    expect(supabase.paymentsChain.eq).not.toHaveBeenCalledWith('payment_mode', 'ADVANCE');
    // Society scoping and voided-exclusion must still hold.
    expect(supabase.paymentsChain.eq).toHaveBeenCalledWith('is_voided', false);
  });

  it('keeps a legacy payment_mode=ADVANCE row visible once its unapplied_amount is backfilled', async () => {
    const supabase = mockSupabase({
      payments: [{
        id: 'pay-legacy', unit_id: 'unit-1', payment_date: '2026-07-01',
        amount_paid: 5000, unapplied_amount: 2000, payment_mode: 'ADVANCE',
        units: { flat_number: 'A-101' },
      }],
    });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const html = renderToStaticMarkup(await AdvancesPage());

    expect(html).toContain('A-101');
    expect(html).toContain('ADVANCE');
  });

  it('surfaces a resident UPI payment with unallocated money, which the old ADVANCE-only filter hid', async () => {
    const supabase = mockSupabase({
      payments: [{
        id: 'pay-upi', unit_id: 'unit-2', payment_date: '2026-07-05',
        amount_paid: 3000, unapplied_amount: 3000, payment_mode: 'UPI',
        units: { flat_number: 'B-202' },
      }],
    });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const html = renderToStaticMarkup(await AdvancesPage());

    expect(html).toContain('B-202');
    expect(html).toContain('UPI');
  });

  it('shows the real payment method rather than labelling every row an advance', async () => {
    const supabase = mockSupabase({
      payments: [
        { id: 'p1', unit_id: 'u1', payment_date: '2026-07-01', amount_paid: 1000, unapplied_amount: 1000, payment_mode: 'CASH', units: { flat_number: 'C-1' } },
      ],
    });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const html = renderToStaticMarkup(await AdvancesPage());

    expect(html).toContain('CASH');
    expect(html).not.toContain('Maintenance Advances');
  });

  it('fails closed instead of rendering an empty ledger when a financial read fails', async () => {
    const supabase = mockSupabase({ paymentError: new Error('database unavailable') });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    await expect(AdvancesPage()).rejects.toThrow('advances ledger could not be loaded');
  });
});
