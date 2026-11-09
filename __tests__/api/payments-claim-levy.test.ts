import type { NextRequest } from 'next/server';
import { POST as submitLevyClaim } from '@/app/api/payments/claim/levy/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, uploadPrivateAttachment } from '@/lib/storage/r2';
import { notifySocietyOperators } from '@/lib/notifications/notify';
import { _resetForTests } from '@/lib/utils/rate-limit';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({ deletePrivateAttachment: jest.fn(), uploadPrivateAttachment: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({
  notifySocietyOperators: jest.fn().mockResolvedValue(undefined),
}));
// validateAttachment (magic-byte check) is real — not mocked.

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ASSESSMENT_ID = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';
const RESIDENT_USER_ID = 'resident-1';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GARBAGE_BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

function pngFile(name = 'proof.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

const RESIDENT_AUTH = {
  userId: RESIDENT_USER_ID, role: 'resident', unitId: UNIT_ID, societyId: SOCIETY_ID,
  societySlug: null, societyStatus: 'active', isPlatformOwner: false, unauthorized: null,
};

function sessionClientForAssessments(result: { data: Array<{ id: string }> | null; error: unknown }) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.neq = jest.fn(async () => result);
  return { client: { from: jest.fn(() => query) }, query };
}

function serviceClientForSubmit(rpcResult: { data: unknown; error: { message: string } | null }) {
  return { rpc: jest.fn(async () => rpcResult) };
}

function submitRequest(options: {
  assessmentIds?: unknown;
  amount?: string;
  utr?: string;
  paidOn?: string;
  file?: File | null;
  includeFile?: boolean;
}): NextRequest {
  const fd = new FormData();
  if (options.assessmentIds !== undefined) {
    fd.set('levy_assessment_ids', typeof options.assessmentIds === 'string' ? options.assessmentIds : JSON.stringify(options.assessmentIds));
  }
  if (options.amount !== undefined) fd.set('amount', options.amount);
  if (options.utr !== undefined) fd.set('utr', options.utr);
  if (options.paidOn !== undefined) fd.set('paid_on', options.paidOn);
  if (options.includeFile !== false) fd.set('screenshot', options.file ?? pngFile());
  return new Request('http://localhost/api/payments/claim/levy', { method: 'POST', body: fd }) as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

describe('POST /api/payments/claim/levy', () => {
  it('submits a levy claim for a resident with a claimable assessment and a genuine screenshot', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    const service = serviceClientForSubmit({ data: 'claim-1', error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(service);
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', utr: 'UTR123' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ claim_id: 'claim-1' });
    expect(uploadPrivateAttachment).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^claims/${SOCIETY_ID}/.+\\.png$`)),
      expect.any(Uint8Array),
      'image/png',
    );
    expect(service.rpc).toHaveBeenCalledWith('submit_resident_levy_claim', {
      p_unit_id: UNIT_ID,
      p_society_id: SOCIETY_ID,
      p_levy_assessment_ids: [ASSESSMENT_ID],
      p_amount: 3000,
      p_utr: 'UTR123',
      p_paid_on: null,
      p_screenshot_key: expect.stringMatching(/^claims\//),
      p_user_id: RESIDENT_USER_ID,
      p_screenshot_sha256: expect.any(String),
    });
  });

  it('alerts the society operators without leaking financial detail', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, societySlug: 'green-acres' });
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSubmit({ data: 'claim-1', error: null }));
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(201);
    expect(notifySocietyOperators).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({
      title: 'New payment proof to review',
      url: '/s/green-acres/claims',
    }));
    const payload = JSON.stringify((notifySocietyOperators as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toContain('3000');
  });

  it('rejects a non-resident caller', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, role: 'treasurer' });

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a resident session with no unit attached', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ ...RESIDENT_AUTH, unitId: null });

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(403);
  });

  it('returns 422 when no assessment is named — unlike bills, a levy claim has no undirected mode', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [], amount: '3000' }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 when required fields fail validation', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: 'not-a-number' }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 400 when the screenshot file is missing', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', includeFile: false }));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 when the uploaded bytes fail the real magic-byte check', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const badFile = new File([GARBAGE_BYTES], 'p.png', { type: 'image/png' });

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', file: badFile }));

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects invalid and future payment dates before uploading', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);

    const invalid = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', paidOn: '2026-02-30' }));
    const future = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', paidOn: '2999-01-01' }));

    expect(invalid.status).toBe(422);
    expect(future.status).toBe(422);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 400 when a named assessment is not owned by the flat or already paid', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('maps PENDING_CLAIM_EXISTS to 409 and cleans up the upload', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'PENDING_CLAIM_EXISTS' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(409);
    expect(deletePrivateAttachment).toHaveBeenCalledWith(expect.stringMatching(/^claims\//));
  });

  it('maps ASSESSMENT_NOT_CLAIMABLE to 400', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'ASSESSMENT_NOT_CLAIMABLE' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(400);
  });

  it('maps DUPLICATE_SCREENSHOT to 409 with honest-mistake wording', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'DUPLICATE_SCREENSHOT' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "You've already submitted this screenshot" });
  });

  it('maps DUPLICATE_UTR to 409', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(
      serviceClientForSubmit({ data: null, error: { message: 'DUPLICATE_UTR' } }),
    );
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);
    (deletePrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000', utr: 'UTR999' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That reference number has already been submitted' });
  });

  it('returns 502 when the R2 upload fails', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (uploadPrivateAttachment as jest.Mock).mockRejectedValue(new Error('network error'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));

    expect(response.status).toBe(502);
    expect(createServiceClient).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rate-limits repeated uploads separately from the bill claim path', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(RESIDENT_AUTH);
    const { client: sessionClient } = sessionClientForAssessments({ data: [{ id: ASSESSMENT_ID }], error: null });
    (createClient as jest.Mock).mockResolvedValue(sessionClient);
    (createServiceClient as jest.Mock).mockResolvedValue(serviceClientForSubmit({ data: 'claim-1', error: null }));
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    let last;
    for (let i = 0; i < 6; i++) {
      last = await submitLevyClaim(submitRequest({ assessmentIds: [ASSESSMENT_ID], amount: '3000' }));
    }

    expect(last!.status).toBe(429);
  });
});
