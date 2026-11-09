import { runBillingLifecycle } from '@/lib/billing/lifecycle';
import { createServiceClient } from '@/lib/supabase/server';
import { notifyUnitResidents } from '@/lib/notifications/notify';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({ notifyUnitResidents: jest.fn().mockResolvedValue(undefined) }));

type Row = Record<string, unknown>;

function chain(resolved: { data: unknown; error: unknown }, onCall?: (method: string, args: unknown[]) => void) {
  const query: Record<string, jest.Mock> = {};
  const methods = ['select', 'eq', 'order', 'range', 'lt', 'in', 'update'];
  methods.forEach(method => {
    query[method] = jest.fn((...args: unknown[]) => {
      onCall?.(method, args);
      return query;
    });
  });
  // Real Supabase query builders are thenable at every point in the chain —
  // the same object is returned throughout, so attaching `.then` here lets an
  // `await` at the end of the chain resolve regardless of which method was
  // called last.
  (query as unknown as { then: jest.Mock }).then = jest.fn((resolve: (v: unknown) => unknown) => resolve(resolved));
  return query;
}

function makeClient(options: {
  configs: Row[];
  realUnitIds: string[];
  bills: Row[];
  updateResponses?: Array<{ data: unknown; error: unknown }>;
}) {
  const updateCalls: Array<{ change: unknown; ids: unknown }> = [];
  let updateIndex = 0;

  const client = {
    from: jest.fn((table: string) => {
      if (table === 'society_config') {
        return chain({ data: options.configs, error: null });
      }
      if (table === 'units') {
        return chain({ data: options.realUnitIds.map(id => ({ id })), error: null });
      }
      if (table === 'bills') {
        // First call to bills is always the fetchAll select; every subsequent
        // call is one batched UPDATE for a distinct payload group.
        const isSelectCall = !billsSelectDone;
        billsSelectDone = true;

        let capturedChange: unknown;
        let capturedIds: unknown;
        const query = chain(
          isSelectCall
            ? { data: options.bills, error: null }
            : (options.updateResponses?.[updateIndex] ?? { data: null, error: null }),
          (method, args) => {
            if (method === 'update') capturedChange = args[0];
            if (method === 'in') capturedIds = args[1];
          },
        );

        if (!isSelectCall) {
          // Record the call only once the chain has actually been built
          // (`.update().in()` run after `from()` returns), not at from()-call
          // time — otherwise capturedChange/capturedIds would still be undefined.
          const originalThen = (query as unknown as { then: jest.Mock }).then;
          (query as unknown as { then: jest.Mock }).then = jest.fn((resolve: (v: unknown) => unknown) => {
            updateCalls.push({ change: capturedChange, ids: capturedIds });
            updateIndex++;
            return originalThen(resolve);
          });
        }
        return query;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  let billsSelectDone = false;

  return { client, updateCalls };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runBillingLifecycle — batched overdue updates', () => {
  it('skips societies with no penalty rate configured', async () => {
    const { client, updateCalls } = makeClient({
      configs: [], // no society has a configured rate
      realUnitIds: ['unit-1'],
      bills: [
        { id: 'bill-1', society_id: 'soc-unconfigured', unit_id: 'unit-1', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it('skips bills on test units even when the society is configured', async () => {
    const { client, updateCalls } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5 }],
      realUnitIds: ['unit-real'], // unit-test is deliberately absent (is_test_unit filter)
      bills: [
        { id: 'bill-real', society_id: 'soc-1', unit_id: 'unit-real', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
        { id: 'bill-test', society_id: 'soc-1', unit_id: 'unit-test', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 1 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].ids).toEqual(['bill-real']);
  });

  it('groups bills with identical computed payloads into one UPDATE per group', async () => {
    const { client, updateCalls } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5 }],
      realUnitIds: ['unit-a', 'unit-b', 'unit-c'],
      bills: [
        // Same base_amount -> identical computed penalty -> same group.
        { id: 'bill-a', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
        { id: 'bill-b', society_id: 'soc-1', unit_id: 'unit-b', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
        // Different base_amount -> different computed penalty -> separate group.
        { id: 'bill-c', society_id: 'soc-1', unit_id: 'unit-c', status: 'ISSUED', due_date: '2026-07-01', base_amount: 2000, penalty_amount: 0 },
      ],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 3 });
    // Two distinct payloads -> exactly two UPDATE calls, never one per bill.
    expect(updateCalls).toHaveLength(2);
    const byIds = updateCalls.map(c => (c.ids as string[]).slice().sort());
    expect(byIds).toContainEqual(['bill-a', 'bill-b']);
    expect(byIds).toContainEqual(['bill-c']);
    for (const call of updateCalls) {
      expect(call.change).toMatchObject({ status: 'OVERDUE' });
    }
  });

  it('never issues an UPDATE call when no bill is actually overdue', async () => {
    const { client, updateCalls } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5 }],
      realUnitIds: ['unit-a'],
      bills: [],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 0 });
    expect(updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BILL OVERDUE notification — fired for the unit a bill just flipped
// ISSUED -> OVERDUE for. This is the only producer of this event in the app;
// there is no separate route to hook.
// ---------------------------------------------------------------------------

describe('runBillingLifecycle — overdue resident notification', () => {
  it('notifies the affected unit exactly once with no financial detail, using the returned rows', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: { slug: 'green-heights' } }],
      realUnitIds: ['unit-a'],
      bills: [
        { id: 'bill-a', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
      // The UPDATE's .select('id') must actually come back with the row for
      // the notification map to be built — a mock that returns null here
      // (as the other tests above do, since they don't care) would silently
      // pass a notification test for the wrong reason.
      updateResponses: [{ data: [{ id: 'bill-a' }], error: null }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 1 });
    expect(notifyUnitResidents).toHaveBeenCalledTimes(1);
    expect(notifyUnitResidents).toHaveBeenCalledWith('soc-1', ['unit-a'], expect.objectContaining({
      title: 'Bill overdue',
      url: '/s/green-heights/my-flat',
    }));
    const payload = JSON.stringify((notifyUnitResidents as jest.Mock).mock.calls[0][2]);
    expect(payload).not.toMatch(/1000|penalty|amount|bill-a/i);
  });

  it('falls back to the unscoped path when the society has no slug', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: null }],
      realUnitIds: ['unit-a'],
      bills: [
        { id: 'bill-a', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
      updateResponses: [{ data: [{ id: 'bill-a' }], error: null }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await runBillingLifecycle('2026-07-10');

    expect(notifyUnitResidents).toHaveBeenCalledWith('soc-1', ['unit-a'], expect.objectContaining({ url: '/my-flat' }));
  });

  it('collapses several overdue bills on the same unit into a single notification for that unit', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: { slug: 'green-heights' } }],
      realUnitIds: ['unit-a'],
      bills: [
        { id: 'bill-a1', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-05-01', base_amount: 1000, penalty_amount: 0 },
        { id: 'bill-a2', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-06-01', base_amount: 1000, penalty_amount: 0 },
      ],
      // Both bills have the same base_amount/day-30 penalty -> one group ->
      // one UPDATE call -> one updateResponses entry covering both ids.
      updateResponses: [{ data: [{ id: 'bill-a1' }, { id: 'bill-a2' }], error: null }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    expect(result).toEqual({ overdue_updated: 2 });
    expect(notifyUnitResidents).toHaveBeenCalledTimes(1);
    expect(notifyUnitResidents).toHaveBeenCalledWith('soc-1', ['unit-a'], expect.anything());
  });

  it('does not notify when no bill actually goes overdue', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: { slug: 'green-heights' } }],
      realUnitIds: ['unit-a'],
      bills: [],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await runBillingLifecycle('2026-07-10');

    expect(notifyUnitResidents).not.toHaveBeenCalled();
  });

  it('does not notify a unit whose UPDATE lost the race (row absent from the returned select)', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: { slug: 'green-heights' } }],
      realUnitIds: ['unit-a'],
      bills: [
        { id: 'bill-a', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
      // The bill was paid/voided between the SELECT and the UPDATE, so the
      // guarded UPDATE affects zero rows — the select-back comes back empty.
      updateResponses: [{ data: [], error: null }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runBillingLifecycle('2026-07-10');

    // `updated` still reports the intended count (unchanged pre-existing
    // semantics), but nobody is notified about a bill that isn't overdue.
    expect(result).toEqual({ overdue_updated: 1 });
    expect(notifyUnitResidents).not.toHaveBeenCalled();
  });

  it('still returns the correct result when the notification step throws', async () => {
    const { client } = makeClient({
      configs: [{ society_id: 'soc-1', penalty_rate_percent: 5, societies: { slug: 'green-heights' } }],
      realUnitIds: ['unit-a'],
      bills: [
        { id: 'bill-a', society_id: 'soc-1', unit_id: 'unit-a', status: 'ISSUED', due_date: '2026-07-01', base_amount: 1000, penalty_amount: 0 },
      ],
      updateResponses: [{ data: [{ id: 'bill-a' }], error: null }],
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (notifyUnitResidents as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const result = await runBillingLifecycle('2026-07-10');

    // The billing lifecycle (and the nightly backup that follows it) must
    // never be aborted by a notification failure.
    expect(result).toEqual({ overdue_updated: 1 });
  });
});
