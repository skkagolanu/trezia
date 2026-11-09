import type { NextRequest } from 'next/server';
import { POST as submitClaim } from '@/app/api/payments/claim/route';
import { POST as approveClaim } from '@/app/api/payments/claim/[id]/approve/route';
import { POST as rejectClaim } from '@/app/api/payments/claim/[id]/reject/route';
import { POST as retractClaim } from '@/app/api/payments/claim/[id]/retract/route';
import { GET as getScreenshot } from '@/app/api/payments/claim/[id]/screenshot/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireAuth, requireFinancialOperator } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, uploadPrivateAttachment, readPrivateAttachment } from '@/lib/storage/r2';
import { notifyUser, notifySocietyOperators } from '@/lib/notifications/notify';
import { _resetForTests } from '@/lib/utils/rate-limit';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn(), requireFinancialOperator: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({ deletePrivateAttachment: jest.fn(), uploadPrivateAttachment: jest.fn(), readPrivateAttachment: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifySocietyOperators: jest.fn().mockResolvedValue(undefined),
}));
// validateAttachment (magic-byte check) and hasCapability are real — not mocked.

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OTHER_UNIT_ID = 'f1b2c3d4-e5f6-4890-abcd-ef1234567890';
const BILL_ID = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';
const CLAIM_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const RESIDENT_USER_ID = 'resident-1';
const OPERATOR_USER_ID = 'operator-1';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GARBAGE_BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

function pngFile(name = 'proof.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

const RESIDENT_AUTH = {
  userId: RESIDENT_USER_ID, role: 'resident', unitId: UNIT_ID, societyId: SOCIETY_ID,
  societySlug: null, societyStatus: 'active', isPlatformOwner: false, unauthorized: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

// ---------------------------------------------------------------------------
// POST /api/payments/claim (submit)
// ---------------------------------------------------------------------------

// Regression: the route used .neq('status', 'PAID'), which also admitted DRAFT
// (never issued) and CANCELLED (withdrawn) bills. assert_payable_bills rejects
// both, so a claim against one was accepted here and then could never be
// approved — it sat pending for ever.

// A thenable builder, like postgrest-js: every filter returns the builder and
// awaiting it resolves. Resolving on .neq() specifically made this mock stop
// matching the route the moment the status filter changed.
function sessionClientForBills(result: { data: Array<{ id: string }> | null; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'eq', 'neq']) {
    query[method] = jest.fn(() => query);
  }
  query.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return { client: { from: jest.fn(() => query) }, query: query as Record<string, jest.Mock> };
}

function serviceClientForSubmit(rpcResult: { data: unknown; error: { message: string } | null }) {
  return { rpc: jest.fn(async () => rpcResult) };
}

function submitRequest(options: {
  billIds?: unknown;
  amount?: string;
  utr?: string;
  paidOn?: string;
  file?: File | null;
  includeFile?: boolean;
}): NextRequest {
  const fd = new FormData();
  if (options.billIds !== undefined) {
    fd.set('bill_ids', typeof options.billIds === 'string' ? options.billIds : JSON.stringify(options.billIds));
  }
  if (options.amount !== undefined) fd.set('amount', options.amount);
  if (options.utr !== undefined) fd.set('utr', options.utr);
  if (options.paidOn !== undefined) fd.set('paid_on', options.paidOn);
  if (options.includeFile !== false) fd.set('screenshot', options.file ?? pngFile());
  return new Request('http://localhost/api/payments/claim', { method: 'POST', body: fd }) as unknown as NextRequest;
}

describe('POST /api/payments/claim', () => {
  it('filters the claimable bills to the statuses a settlement can accept', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient, query } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSubmit({ data: 'claim-1', error: null }));
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', utr: 'UTR900' }));

    // Not .neq('status','PAID'): that also admitted DRAFT and CANCELLED, which
    // assert_payable_bills rejects, so the claim could never be approved.
    expect(query.in).toHaveBeenCalledWith('status', ['ISSUED', 'OVERDUE']);
    expect(query.eq).toHaveBeenCalledWith('is_voided', false);
  });

  it('submits a claim for a resident with valid bills and a genuine screenshot', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    const service = serviceClientForSubmit({ data: 'claim-1', error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(service);
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', utr: 'UTR123' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ claim_id: 'claim-1' });
    expect(uploadPrivateAttachment).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^claims/${SOCIETY_ID}/.+\\.png$`)),
      expect.any(Uint8Array),
      'image/png',
    );
    expect(service.rpc).toHaveBeenCalledWith('submit_resident_payment_claim', {
      p_unit_id: UNIT_ID,
      p_society_id: SOCIETY_ID,
      p_bill_ids: [BILL_ID],
      p_amount: 2000,
      p_utr: 'UTR123',
      p_paid_on: null,
      p_screenshot_key: expect.stringMatching(/^claims\//),
      p_user_id: RESIDENT_USER_ID,
      p_screenshot_sha256: expect.any(String),
    });
  });

  it('submits an empty bill_ids array as an undirected claim (oldest-dues / advance) without a bill lookup', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const service = serviceClientForSubmit({ data: 'claim-2', error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(service);
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [], amount: '500' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ claim_id: 'claim-2' });
    // client must never be touched for this path.
    expect(createClient).not.toHaveBeenCalled();
    expect(service.rpc).toHaveBeenCalledWith('submit_resident_payment_claim', expect.objectContaining({
      p_bill_ids: [],
      p_amount: 500,
    }));
  });

  it('maps DUPLICATE_SCREENSHOT to a 409 with honest-mistake wording and cleans up the upload', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'DUPLICATE_SCREENSHOT' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "You've already submitted this screenshot" });
    expect(deletePrivateAttachment).toHaveBeenCalledWith(expect.stringMatching(/^claims\//));
  });

  it('maps DUPLICATE_UTR to a 409 with honest-mistake wording and cleans up the upload', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'DUPLICATE_UTR' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', utr: 'UTR999' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That reference number has already been submitted' });
    expect(deletePrivateAttachment).toHaveBeenCalledWith(expect.stringMatching(/^claims\//));
  });

  it('alerts the society operators without leaking financial detail', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, societySlug: 'green-acres' });
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSubmit({ data: 'claim-1', error: null }));
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', utr: 'UTR123' }));

    expect(response.status).toBe(201);
    expect(notifySocietyOperators).toHaveBeenCalledTimes(1);
    expect(notifySocietyOperators).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({
      title: 'New payment proof to review',
      url: '/s/green-acres/claims',
    }));
    // Notifications must carry no amount, flat number or reference (PWA privacy rule).
    const payload = JSON.stringify((notifySocietyOperators as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toContain('2000');
    expect(payload).not.toContain('UTR123');
  });

  it('still returns 201 when the operator alert fails', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSubmit({ data: 'claim-1', error: null }));
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (notifySocietyOperators as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    // The claim row is already committed; a push failure must not make the
    // resident think the submission failed and upload a duplicate.
    expect(response.status).toBe(201);
  });

  it('does not alert operators when the claim is rejected as a duplicate', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'PENDING_CLAIM_EXISTS' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(409);
    expect(notifySocietyOperators).not.toHaveBeenCalled();
  });

  it('rejects a non-resident caller', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'admin' });

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a resident session with no unit attached', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, unitId: null });

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(403);
  });

  it('returns 422 when required fields fail validation', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: 'not-a-number' }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 when the screenshot file is missing', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', includeFile: false }));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 when the uploaded bytes fail the real magic-byte check', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const badFile = new File([GARBAGE_BYTES], 'p.png', { type: 'image/png' });

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', file: badFile }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects invalid and future payment dates before uploading', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const invalid = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', paidOn: '2026-02-30' }));
    const future = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000', paidOn: '2999-01-01' }));

    expect(invalid.status).toBe(422);
    expect(future.status).toBe(422);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 400 when a claimed bill is not owned by the flat or already paid', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('maps PENDING_CLAIM_EXISTS to 409', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'PENDING_CLAIM_EXISTS' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(409);
    expect(deletePrivateAttachment).toHaveBeenCalledWith(expect.stringMatching(/^claims\//));
  });

  it('maps BILL_NOT_CLAIMABLE to 400', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'BILL_NOT_CLAIMABLE' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(400);
  });

  it('returns 502 when the R2 upload fails', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForBills({ data: [{ id: BILL_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (uploadPrivateAttachment as jest.Mock).mockRejectedValue(new Error('network error'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await submitClaim(submitRequest({ billIds: [BILL_ID], amount: '2000' }));

    expect(response.status).toBe(502);
    expect(createServiceClient).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /api/payments/claim/[id]/approve
// ---------------------------------------------------------------------------

function jsonRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function claimLookupClient(options: {
  claim?: { submitted_by: string | null; society_id: string } | null;
  claimError?: unknown;
  rpcResult: { data: unknown; error: { message: string } | null };
  rpcName: 'approve_resident_payment_claim' | 'reject_resident_payment_claim';
}) {
  const claim = options.claim === undefined
    ? { submitted_by: RESIDENT_USER_ID, society_id: SOCIETY_ID }
    : options.claim;
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: claim, error: options.claimError ?? null }));
  return {
    from: jest.fn(() => query),
    rpc: jest.fn(async (name: string) => {
      expect(name).toBe(options.rpcName);
      return options.rpcResult;
    }),
  };
}

const OPERATOR_AUTH = { userId: OPERATOR_USER_ID, role: 'treasurer', societyId: SOCIETY_ID, unauthorized: null };

describe('POST /api/payments/claim/[id]/approve', () => {
  it('approves a pending claim, records the payment, and notifies the resident', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
    const service = claimLookupClient({
      rpcResult: { data: 'payment-1', error: null },
      rpcName: 'approve_resident_payment_claim',
    });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await approveClaim(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ payment_id: 'payment-1' });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(RESIDENT_USER_ID, expect.objectContaining({ title: 'Payment approved' }));
  });

  it('returns 409 when the claim was already reviewed', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
    const service = claimLookupClient({
      rpcResult: { data: null, error: { message: 'CLAIM_NOT_PENDING' } },
      rpcName: 'approve_resident_payment_claim',
    });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await approveClaim(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(409);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('returns 404 for a claim belonging to another society', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
    const service = claimLookupClient({
      claim: { submitted_by: RESIDENT_USER_ID, society_id: 'e1b2c3d4-e5f6-4890-abcd-ef1234567890' },
      rpcResult: { data: null, error: null },
      rpcName: 'approve_resident_payment_claim',
    });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await approveClaim(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(404);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-operator caller', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue({
      userId: null, role: null, societyId: null, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await approveClaim(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/payments/claim/[id]/reject
// ---------------------------------------------------------------------------

describe('POST /api/payments/claim/[id]/reject', () => {
  it('rejects a pending claim and notifies the resident with the note', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
    const service = claimLookupClient({
      rpcResult: { data: null, error: null },
      rpcName: 'reject_resident_payment_claim',
    });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await rejectClaim(
      jsonRequest('http://localhost/x', { note: 'Amount does not match the bill' }),
      { params: Promise.resolve({ id: CLAIM_ID }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(service.rpc).toHaveBeenCalledWith('reject_resident_payment_claim', {
      p_claim_id: CLAIM_ID,
      p_reviewer_id: OPERATOR_USER_ID,
      p_note: 'Amount does not match the bill',
    });
    expect(notifyUser).toHaveBeenCalledWith(RESIDENT_USER_ID, expect.objectContaining({ title: 'Payment needs attention' }));
  });

  it('returns 409 when the claim was already reviewed', async () => {
    (requireFinancialOperator as jest.Mock).mockResolvedValue(OPERATOR_AUTH);
    const service = claimLookupClient({
      rpcResult: { data: null, error: { message: 'CLAIM_NOT_PENDING' } },
      rpcName: 'reject_resident_payment_claim',
    });
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await rejectClaim(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(409);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/payments/claim/[id]/retract
// ---------------------------------------------------------------------------

function retractRequest(): NextRequest {
  return new Request('http://localhost/api/payments/claim/x/retract', { method: 'POST' }) as unknown as NextRequest;
}

function retractServiceClient(error: { message: string } | null) {
  return { rpc: jest.fn(async () => ({ data: null, error })) };
}

describe('POST /api/payments/claim/[id]/retract', () => {
  it("retracts the resident's own pending claim, deriving the unit from the session", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const service = retractServiceClient(null);
    (createServiceClient as jest.Mock).mockResolvedValue(service);

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(service.rpc).toHaveBeenCalledWith('retract_resident_payment_claim', {
      p_claim_id: CLAIM_ID,
      p_unit_id: UNIT_ID,
      p_user_id: RESIDENT_USER_ID,
    });
  });

  it("refuses to retract another flat's claim", async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    (createServiceClient as jest.Mock).mockResolvedValue(retractServiceClient({ message: 'NOT_AUTHORIZED' }));

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(404);
  });

  it('returns 404 when the claim does not exist', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    (createServiceClient as jest.Mock).mockResolvedValue(retractServiceClient({ message: 'CLAIM_NOT_FOUND' }));

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(404);
  });

  it('returns 409 when the claim has already been reviewed (approved or rejected)', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    (createServiceClient as jest.Mock).mockResolvedValue(retractServiceClient({ message: 'CLAIM_NOT_PENDING' }));

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(409);
  });

  it('rejects a non-resident caller', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'treasurer' });

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed id without calling the service client', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await retractClaim(retractRequest(), { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(response.status).toBe(404);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/payments/claim/[id]/screenshot
// ---------------------------------------------------------------------------

function screenshotServiceClient(options: { claim: { society_id: string; unit_id: string; screenshot_object_key: string } | null; error?: unknown }) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: options.claim, error: options.error ?? null }));
  return { from: jest.fn(() => query) };
}

function screenshotRequest(): NextRequest {
  return new Request('http://localhost/api/payments/claim/x/screenshot') as unknown as NextRequest;
}

describe('GET /api/payments/claim/[id]/screenshot', () => {
  const CLAIM = { society_id: SOCIETY_ID, unit_id: UNIT_ID, screenshot_object_key: `claims/${SOCIETY_ID}/proof.png` };

  it('streams the image for an operator with no-store cache headers', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'treasurer', userId: OPERATOR_USER_ID, unitId: null });
    (createServiceClient as jest.Mock).mockResolvedValue(screenshotServiceClient({ claim: CLAIM }));
    (readPrivateAttachment as jest.Mock).mockResolvedValue(PNG_BYTES);

    const response = await getScreenshot(screenshotRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG_BYTES));
  });

  it('allows the owning resident to view their own claim screenshot', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    (createServiceClient as jest.Mock).mockResolvedValue(screenshotServiceClient({ claim: CLAIM }));
    (readPrivateAttachment as jest.Mock).mockResolvedValue(PNG_BYTES);

    const response = await getScreenshot(screenshotRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(200);
  });

  it('forbids a resident of a different unit', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, unitId: OTHER_UNIT_ID });
    (createServiceClient as jest.Mock).mockResolvedValue(screenshotServiceClient({ claim: CLAIM }));

    const response = await getScreenshot(screenshotRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(403);
    expect(readPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 404 when the claim does not exist', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'treasurer', unitId: null });
    (createServiceClient as jest.Mock).mockResolvedValue(screenshotServiceClient({ claim: null }));

    const response = await getScreenshot(screenshotRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(404);
    expect(readPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 404 when the stored object cannot be read', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'treasurer', unitId: null });
    (createServiceClient as jest.Mock).mockResolvedValue(screenshotServiceClient({ claim: CLAIM }));
    (readPrivateAttachment as jest.Mock).mockRejectedValue(new Error('object not found'));

    const response = await getScreenshot(screenshotRequest(), { params: Promise.resolve({ id: CLAIM_ID }) });

    expect(response.status).toBe(404);
  });
});
