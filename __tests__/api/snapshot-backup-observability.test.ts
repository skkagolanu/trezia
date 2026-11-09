/** Snapshot failures update backup health, and total cron failure returns an error status. */
import { GET as snapshotCron } from '@/app/api/cron/snapshot/route';
import { createSnapshot } from '@/lib/snapshots/create';
import { createServiceClient } from '@/lib/supabase/server';
import { runBillingLifecycle } from '@/lib/billing/lifecycle';
import { runMonthlyBillGeneration } from '@/lib/billing/auto-generate';
import { deleteImportCsv, listSnapshotObjects } from '@/lib/storage/r2';
import * as Sentry from '@sentry/nextjs';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
jest.mock('@/lib/snapshots/create', () => ({ createSnapshot: jest.fn() }));
jest.mock('@/lib/billing/lifecycle', () => ({ runBillingLifecycle: jest.fn() }));
jest.mock('@/lib/billing/auto-generate', () => ({ runMonthlyBillGeneration: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({
  listSnapshotObjects: jest.fn(),
  deleteObject: jest.fn(),
  deleteImportCsv: jest.fn(),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const SOCIETY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SOCIETY_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function cronRequest(secret = 'test-secret') {
  return new Request('https://example.test/api/cron/snapshot', {
    headers: { authorization: `Bearer ${secret}` },
  }) as unknown as Parameters<typeof snapshotCron>[0];
}

// society_config select -> the society id list the cron fans out over.
function serviceClientForSocieties(
  ids: string[],
  staleBatches: Array<{ object_key: string; updated_at: string }> = [],
) {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(async () => ({ data: ids.map(society_id => ({ society_id })), error: null }));
  // The import-cleanup sweep chains further before awaiting.
  const sweep: Record<string, jest.Mock> = {};
  sweep.select = jest.fn(() => sweep);
  sweep.lt = jest.fn(() => sweep);
  sweep.order = jest.fn(() => sweep);
  sweep.limit = jest.fn(async () => ({ data: staleBatches, error: null }));

  return {
    from: jest.fn((table: string) => (table === 'society_import_batches' ? sweep : builder)),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  (runBillingLifecycle as jest.Mock).mockResolvedValue({ overdue_updated: 0 });
  (listSnapshotObjects as jest.Mock).mockResolvedValue([]);
});

describe('snapshot cron failure visibility', () => {
  it('returns 500 when every society snapshot fails so the platform surfaces the outage', async () => {
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSocieties([SOCIETY_A, SOCIETY_B]));
    (createSnapshot as jest.Mock).mockRejectedValue(new Error('PostgREST rejected the request'));

    const response = await snapshotCron(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.societies_attempted).toBe(2);
    expect(body.societies_failed).toBe(2);
  });

  it('stays 200 on a partial failure so one broken society cannot mask the others', async () => {
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSocieties([SOCIETY_A, SOCIETY_B]));
    (createSnapshot as jest.Mock)
      .mockResolvedValueOnce({ key: 'snapshots/a.json.gz', exported_at: '2026-08-07T00:00:00.000Z', result: 'UPLOADED', sha256: 'abc', bytes: 10, ratio: 1, db_row_count: 5 })
      .mockRejectedValueOnce(new Error('one society is broken'));

    const response = await snapshotCron(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.societies_failed).toBe(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Snapshot cron society snapshots partially failed',
      expect.objectContaining({ extra: { attempted_count: 2, failed_count: 1 } }),
    );
  });

  it('reports only the staged-import deletion failure count', async () => {
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSocieties(
      [SOCIETY_A],
      [
        { object_key: 'staging/import-a.csv', updated_at: '2026-08-01T00:00:00.000Z' },
        { object_key: 'staging/import-b.csv', updated_at: '2026-08-01T00:00:00.000Z' },
      ],
    ));
    (createSnapshot as jest.Mock).mockResolvedValue({ key: 'k', exported_at: '2026-08-07T00:00:00.000Z', result: 'UPLOADED', sha256: 'a', bytes: 1, ratio: 1, db_row_count: 1 });
    (deleteImportCsv as jest.Mock).mockRejectedValue(new Error('storage unavailable'));

    const response = await snapshotCron(cronRequest());

    expect(response.status).toBe(200);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Snapshot cron staged import cleanup deletions failed',
      expect.objectContaining({ extra: { failed_count: 2 } }),
    );
  });

  it('reports success when there are no societies rather than treating it as total failure', async () => {
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSocieties([]));

    const response = await snapshotCron(cronRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it('rejects a caller without the cron secret', async () => {
    const response = await snapshotCron(cronRequest('wrong-secret'));

    expect(response.status).toBe(401);
    expect(createSnapshot).not.toHaveBeenCalled();
  });
});

describe('monthly bill generation guard', () => {
  const okSnapshot = { key: 'k', exported_at: '2026-09-01T00:00:00.000Z', result: 'UPLOADED', sha256: 'a', bytes: 1, ratio: 1, db_row_count: 1 };

  beforeEach(() => {
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSocieties([SOCIETY_A]));
    (createSnapshot as jest.Mock).mockResolvedValue(okSnapshot);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates bills on the 1st of the month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T19:30:00.000Z'));
    (runMonthlyBillGeneration as jest.Mock).mockResolvedValue({
      societies: [{ society_id: SOCIETY_A, status: 'generated', created: 12 }],
    });

    const body = await (await snapshotCron(cronRequest())).json();

    expect(runMonthlyBillGeneration).toHaveBeenCalledWith('2026-09-01');
    expect(body.bill_generation_ran).toBe(true);
    expect(body.bills_generated).toBe(12);
  });

  it('does not generate bills on any other day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T19:30:00.000Z'));

    const body = await (await snapshotCron(cronRequest())).json();

    expect(runMonthlyBillGeneration).not.toHaveBeenCalled();
    expect(body.bill_generation_ran).toBe(false);
  });

  it('still completes the backup when bill generation throws', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T19:30:00.000Z'));
    (runMonthlyBillGeneration as jest.Mock).mockRejectedValue(new Error('billing exploded'));

    const response = await snapshotCron(cronRequest());
    const body = await response.json();

    // Unattended bill generation must never cost a society its backup.
    expect(response.status).toBe(200);
    expect(body.bill_generation_error).toBe(true);
    expect(createSnapshot).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { cron: 'snapshot', operation: 'monthly_bill_generation' } }),
    );
  });

  it('reports societies skipped for missing billing configuration', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T19:30:00.000Z'));
    (runMonthlyBillGeneration as jest.Mock).mockResolvedValue({
      societies: [{ society_id: SOCIETY_B, status: 'skipped', reason: 'monthly_maintenance_amount not configured' }],
    });

    const body = await (await snapshotCron(cronRequest())).json();

    expect(body.bills_generated).toBe(0);
    expect(body.bill_generation_skipped).toEqual([SOCIETY_B]);
    expect(body.bill_generation_error).toBe(false);
  });
});

describe('cron auth', () => {
  it('rejects a caller without the cron secret', async () => {
    const response = await snapshotCron(cronRequest('wrong-secret'));

    expect(response.status).toBe(401);
    expect(createSnapshot).not.toHaveBeenCalled();
  });
});
