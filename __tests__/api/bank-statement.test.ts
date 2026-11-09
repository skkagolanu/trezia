import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/bank-statement/route';
import { PATCH } from '@/app/api/bank-statement/[batchId]/lines/[lineId]/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireFinancialOperator: jest.fn(),
  requireFinancialReader: jest.fn(),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const BATCH_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const LINE_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';

function jsonRequest(url: string, method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    userId: 'operator-1',
    societyId: SOCIETY_ID,
    unauthorized: null,
  });
});

describe('POST /api/bank-statement', () => {
  it('imports the batch and all parsed lines through one tenant-scoped RPC', async () => {
    const batch = { id: BATCH_ID, society_id: SOCIETY_ID, line_count: 2 };
    const rpc = jest.fn().mockResolvedValue({ data: batch, error: null });
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(jsonRequest(
      'http://localhost/api/bank-statement',
      'POST',
      {
        filename: 'july.csv',
        csv_text: [
          'Date,Description,Amount',
          '19/07/2026,Maintenance 410,2500',
          '2026-07-18,Electricity,-4500',
        ].join('\n'),
      },
    ));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: batch, parsed: 2, skippedLines: [] });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_bank_statement_batch', {
      p_society_id: SOCIETY_ID,
      p_filename: 'july.csv',
      p_statement_from: '2026-07-18',
      p_statement_to: '2026-07-19',
      p_lines: [
        { line_date: '2026-07-19', description: 'Maintenance 410', amount: 2500, reference: null },
        { line_date: '2026-07-18', description: 'Electricity', amount: -4500, reference: null },
      ],
    });
  });

  it('preserves the no-parseable-rows 422 without touching the database', async () => {
    const rpc = jest.fn();
    (createClient as jest.Mock).mockResolvedValue({ rpc });

    const response = await POST(jsonRequest(
      'http://localhost/api/bank-statement',
      'POST',
      { csv_text: 'Date,Description,Amount\nnot-a-date,Invalid,100' },
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'No parseable rows found in this CSV — check the Date/Description/Amount columns',
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a generic error when the transactional RPC fails', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    (createClient as jest.Mock).mockResolvedValue({ rpc });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(jsonRequest(
      'http://localhost/api/bank-statement',
      'POST',
      { csv_text: 'Date,Description,Amount\n2026-07-19,Maintenance,2500' },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to import bank statement' });
    expect(consoleError).toHaveBeenCalledWith('[bank-statement] transactional import failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private database'));
    consoleError.mockRestore();
  });

  it('maps only the invalid-import sentinel to a generic 422 response', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'INVALID_BANK_STATEMENT_IMPORT' },
    });
    (createClient as jest.Mock).mockResolvedValue({ rpc });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(jsonRequest(
      'http://localhost/api/bank-statement',
      'POST',
      { csv_text: 'Date,Description,Amount\n2026-07-19,Maintenance,2500' },
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Bank statement import is invalid' });
    expect(consoleError).toHaveBeenCalledWith('[bank-statement] invalid transactional import');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('INVALID_BANK_STATEMENT_IMPORT'));
    consoleError.mockRestore();
  });

  it('does not treat sentinel-like database details as a validation error', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'INVALID_BANK_STATEMENT_IMPORT: private database detail' },
    });
    (createClient as jest.Mock).mockResolvedValue({ rpc });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(jsonRequest(
      'http://localhost/api/bank-statement',
      'POST',
      { csv_text: 'Date,Description,Amount\n2026-07-19,Maintenance,2500' },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to import bank statement' });
    expect(consoleError).toHaveBeenCalledWith('[bank-statement] transactional import failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private database'));
    consoleError.mockRestore();
  });
});

function reconciliationClient(error: { message: string; code?: string } | null = null) {
  const rpc = jest.fn(async () => ({ data: null, error }));
  return { client: { rpc }, rpc };
}

describe('PATCH /api/bank-statement/:batchId/lines/:lineId', () => {
  it('uses the tenant-scoped transactional RPC for the requested batch and line', async () => {
    const { client, rpc } = reconciliationClient();
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(
      jsonRequest('http://localhost/api/bank-statement/batch/lines/line', 'PATCH', { action: 'ignore' }),
      { params: Promise.resolve({ batchId: BATCH_ID, lineId: LINE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reconcile_bank_statement_line', {
      p_society_id: SOCIETY_ID,
      p_batch_id: BATCH_ID,
      p_line_id: LINE_ID,
      p_actor_id: 'operator-1',
      p_action: 'ignore',
      p_matched_table: null,
      p_matched_id: null,
    });
  });

  it('returns 404 when the batch and line do not identify an in-scope row', async () => {
    const { client } = reconciliationClient({ message: 'BANK_LINE_NOT_FOUND' });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(
      jsonRequest('http://localhost/api/bank-statement/batch/lines/line', 'PATCH', { action: 'unmatch' }),
      { params: Promise.resolve({ batchId: BATCH_ID, lineId: LINE_ID }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Bank statement line not found' });
  });

  it('does not expose raw database errors from a failed line update', async () => {
    const { client } = reconciliationClient({ message: 'private RLS detail' });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await PATCH(
      jsonRequest('http://localhost/api/bank-statement/batch/lines/line', 'PATCH', { action: 'ignore' }),
      { params: Promise.resolve({ batchId: BATCH_ID, lineId: LINE_ID }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to update bank statement line' });
    expect(consoleError).toHaveBeenCalledWith('[bank-statement/line] update failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private RLS'));
    consoleError.mockRestore();
  });
});
