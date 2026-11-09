import { runMonthlyBillGeneration } from '@/lib/billing/auto-generate';
import { createServiceClient } from '@/lib/supabase/server';
import { notifySocietyResidents } from '@/lib/notifications/notify';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({ notifySocietyResidents: jest.fn().mockResolvedValue(undefined) }));

type ConfigRow = {
  society_id: string;
  monthly_maintenance_amount: number | null;
  maintenance_payment_window_days: number | null;
  societies?: { slug: string } | null;
};
type UnitRow = { id: string; flat_number: string };
type UpsertCall = { societyId: string | undefined; rows: Array<Record<string, unknown>>; options: unknown };

function makeClient(options: {
  configs: ConfigRow[];
  unitsBySociety: Record<string, UnitRow[]>;
}) {
  const upsertCalls: UpsertCall[] = [];

  const client = {
    from: jest.fn((table: string) => {
      if (table === 'society_config') {
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        (query as unknown as { then: jest.Mock }).then =
          jest.fn((resolve: (v: unknown) => unknown) => resolve({ data: options.configs, error: null }));
        return query;
      }

      if (table === 'units') {
        let societyId: string | undefined;
        const query: Record<string, jest.Mock> = {};
        query.select = jest.fn(() => query);
        query.eq = jest.fn((column: string, value: unknown) => {
          if (column === 'society_id') societyId = value as string;
          return query;
        });
        query.order = jest.fn(() => query);
        query.range = jest.fn(() => query);
        (query as unknown as { then: jest.Mock }).then = jest.fn((resolve: (v: unknown) => unknown) =>
          resolve({ data: options.unitsBySociety[societyId ?? ''] ?? [], error: null }));
        return query;
      }

      if (table === 'bills') {
        let upsertedRows: Array<Record<string, unknown>> = [];
        let upsertedOptions: unknown;
        const query: Record<string, jest.Mock> = {};
        query.upsert = jest.fn((rows: Array<Record<string, unknown>>, opts: unknown) => {
          upsertedRows = rows;
          upsertedOptions = opts;
          return query;
        });
        query.select = jest.fn(() => query);
        (query as unknown as { then: jest.Mock }).then = jest.fn((resolve: (v: unknown) => unknown) => {
          upsertCalls.push({
            societyId: upsertedRows[0]?.society_id as string | undefined,
            rows: upsertedRows,
            options: upsertedOptions,
          });
          return resolve({ data: upsertedRows.map(r => ({ id: `generated-${r.unit_id as string}` })), error: null });
        });
        return query;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, upsertCalls };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runMonthlyBillGeneration', () => {
  it('skips a society missing monthly_maintenance_amount without throwing', async () => {
    const { client, upsertCalls } = makeClient({
      configs: [{ society_id: 'soc-1', monthly_maintenance_amount: null, maintenance_payment_window_days: 7 }],
      unitsBySociety: {},
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(result.societies).toEqual([
      { society_id: 'soc-1', status: 'skipped', reason: 'monthly_maintenance_amount not configured' },
    ]);
    expect(upsertCalls).toHaveLength(0);
  });

  it('skips a society missing maintenance_payment_window_days without throwing', async () => {
    const { client, upsertCalls } = makeClient({
      configs: [{ society_id: 'soc-1', monthly_maintenance_amount: 2000, maintenance_payment_window_days: null }],
      unitsBySociety: {},
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(result.societies).toEqual([
      { society_id: 'soc-1', status: 'skipped', reason: 'maintenance_payment_window_days not configured' },
    ]);
    expect(upsertCalls).toHaveLength(0);
  });

  it('one society failing does not abort the others', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-bad', monthly_maintenance_amount: null, maintenance_payment_window_days: 7 },
        { society_id: 'soc-good', monthly_maintenance_amount: 2000, maintenance_payment_window_days: 7 },
      ],
      unitsBySociety: {
        'soc-good': [{ id: 'unit-1', flat_number: '101' }],
      },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    const good = result.societies.find(s => s.society_id === 'soc-good');
    const bad = result.societies.find(s => s.society_id === 'soc-bad');
    expect(bad).toEqual({ society_id: 'soc-bad', status: 'skipped', reason: 'monthly_maintenance_amount not configured' });
    expect(good).toEqual({ society_id: 'soc-good', status: 'generated', created: 1 });
  });

  it('writes exactly one batched upsert per society, not one call per unit', async () => {
    const { client, upsertCalls } = makeClient({
      configs: [{ society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7 }],
      unitsBySociety: {
        'soc-1': [
          { id: 'unit-1', flat_number: '101' },
          { id: 'unit-2', flat_number: '102' },
          { id: 'unit-3', flat_number: '103' },
        ],
      },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].rows).toHaveLength(3);
    expect(upsertCalls[0].options).toEqual({
      onConflict: 'unit_id,bill_period_year,bill_period_month',
      ignoreDuplicates: true,
    });
    expect(result.societies).toEqual([{ society_id: 'soc-1', status: 'generated', created: 3 }]);
    // Invoice number format must match the manual generation path exactly
    // (JAN..DEC / flat number with spaces stripped / 2-digit year).
    expect(upsertCalls[0].rows[0].invoice_number).toBe('AUG/101/26');
  });

  it('is idempotent across repeated runs — always requests ignoreDuplicates on the same batched shape', async () => {
    const { client, upsertCalls } = makeClient({
      configs: [{ society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7 }],
      unitsBySociety: {
        'soc-1': [{ id: 'unit-1', flat_number: '101' }],
      },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await runMonthlyBillGeneration('2026-08-01');
    await runMonthlyBillGeneration('2026-08-01');

    expect(upsertCalls).toHaveLength(2);
    for (const call of upsertCalls) {
      expect(call.options).toEqual({
        onConflict: 'unit_id,bill_period_year,bill_period_month',
        ignoreDuplicates: true,
      });
      expect(call.rows).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// BILL GENERATED notification — one producer of this event; the other is the
// manual bulk-generation branch of src/app/api/bills/route.ts.
// ---------------------------------------------------------------------------

describe('runMonthlyBillGeneration — resident notification', () => {
  it('notifies each society exactly once, not once per generated bill', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7, societies: { slug: 'green-heights' } },
      ] as ConfigRow[],
      unitsBySociety: {
        'soc-1': [
          { id: 'unit-1', flat_number: '101' },
          { id: 'unit-2', flat_number: '102' },
          { id: 'unit-3', flat_number: '103' },
        ],
      },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(result.societies).toEqual([{ society_id: 'soc-1', status: 'generated', created: 3 }]);
    expect(notifySocietyResidents).toHaveBeenCalledTimes(1);
    expect(notifySocietyResidents).toHaveBeenCalledWith('soc-1', expect.objectContaining({
      title: 'New bill posted',
      url: '/s/green-heights/my-flat',
    }));
    // No amount, unit count or invoice detail in the push payload (PWA privacy rule).
    const payload = JSON.stringify((notifySocietyResidents as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toMatch(/2500|101|102|103/);
  });

  it('does not notify a society when the run creates zero bills', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7, societies: { slug: 'green-heights' } },
      ] as ConfigRow[],
      unitsBySociety: {}, // no active units -> created: 0, returned before the upsert
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(result.societies).toEqual([{ society_id: 'soc-1', status: 'generated', created: 0 }]);
    expect(notifySocietyResidents).not.toHaveBeenCalled();
  });

  it('does not notify a society that was skipped for missing config', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-1', monthly_maintenance_amount: null, maintenance_payment_window_days: 7, societies: { slug: 'green-heights' } },
      ] as ConfigRow[],
      unitsBySociety: {},
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await runMonthlyBillGeneration('2026-08-01');

    expect(notifySocietyResidents).not.toHaveBeenCalled();
  });

  it('falls back to the unscoped path when the society has no slug', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7, societies: null },
      ] as ConfigRow[],
      unitsBySociety: { 'soc-1': [{ id: 'unit-1', flat_number: '101' }] },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await runMonthlyBillGeneration('2026-08-01');

    expect(notifySocietyResidents).toHaveBeenCalledWith('soc-1', expect.objectContaining({ url: '/my-flat' }));
  });

  it('still reports the bills as generated when the notification step rejects', async () => {
    const { client } = makeClient({
      configs: [
        { society_id: 'soc-1', monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7, societies: { slug: 'green-heights' } },
      ] as ConfigRow[],
      unitsBySociety: { 'soc-1': [{ id: 'unit-1', flat_number: '101' }] },
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (notifySocietyResidents as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const result = await runMonthlyBillGeneration('2026-08-01');

    expect(result.societies).toEqual([{ society_id: 'soc-1', status: 'generated', created: 1 }]);
  });
});
