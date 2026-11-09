import type { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/society/upi-qr/route';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, requireFinancialSetupManager } from '@/lib/supabase/require-auth';
import { deletePrivateAttachment, readPrivateAttachment, uploadPrivateAttachment, upiQrKey } from '@/lib/storage/r2';
import { _resetForTests } from '@/lib/utils/rate-limit';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn(), requireFinancialSetupManager: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({
  readPrivateAttachment: jest.fn(),
  uploadPrivateAttachment: jest.fn(),
  deletePrivateAttachment: jest.fn(),
  upiQrKey: jest.fn(),
}));
// validateAttachment (magic-byte check) is real — not mocked.

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ADMIN_USER_ID = 'admin-1';
const NEW_OBJECT_KEY = 'society/new-key.png';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GARBAGE_BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0]);

function pngFile(name = 'qr.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

const AUTHENTICATED_AUTH = {
  userId: 'member-1', role: 'resident', unitId: null, societyId: SOCIETY_ID,
  societySlug: null, societyStatus: 'active', isPlatformOwner: false, unauthorized: null,
};

const ADMIN_AUTH = { userId: ADMIN_USER_ID, role: 'admin', societyId: SOCIETY_ID, unauthorized: null };

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  (upiQrKey as jest.Mock).mockReturnValue(NEW_OBJECT_KEY);
});

// ---------------------------------------------------------------------------
// (.from().select().eq().maybeSingle()) and the update chain
// (.from().update().eq() awaited directly for { error }).
// ---------------------------------------------------------------------------

function societyConfigClient(options: {
  previousKey?: string | null;
  updateError?: { message: string } | null;
}) {
  const rpc = jest.fn(async () => ({ data: options.previousKey ?? null, error: options.updateError ?? null }));
  return { client: { rpc }, rpc };
}

// ---------------------------------------------------------------------------
// GET /api/society/upi-qr calls a SECURITY DEFINER RPC (migration 065) instead
// of reading `society_config` directly, because that table's RLS policy is
// admin/treasurer-only and would deny a Resident loading their own dues QR.
// ---------------------------------------------------------------------------

function paymentInfoClient(rows: Array<{ upi_qr_object_key: string | null }> | null) {
  const rpc = jest.fn(async () => ({ data: rows, error: null }));
  const from = jest.fn();
  return { client: { rpc, from }, rpc, from };
}

describe('GET /api/society/upi-qr', () => {
  it('returns the QR image bytes with private no-sniff headers for an authenticated member', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client } = paymentInfoClient([{ upi_qr_object_key: 'society/x/upi-qr-1.png' }]);
    (createClient as jest.Mock).mockResolvedValue(client);
    (readPrivateAttachment as jest.Mock).mockResolvedValue(PNG_BYTES);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG_BYTES));
  });

  it('returns 404 when the society has no QR configured', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client } = paymentInfoClient([]);
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(readPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 404 when the RPC resolves no rows at all', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client } = paymentInfoClient(null);
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(readPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns image/jpeg content type for a stored key ending in .jpg', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client } = paymentInfoClient([{ upi_qr_object_key: 'society/x/upi-qr-1.jpg' }]);
    (createClient as jest.Mock).mockResolvedValue(client);
    (readPrivateAttachment as jest.Mock).mockResolvedValue(PNG_BYTES);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns 404 when the stored object cannot be read', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client } = paymentInfoClient([{ upi_qr_object_key: 'society/x/upi-qr-1.png' }]);
    (createClient as jest.Mock).mockResolvedValue(client);
    (readPrivateAttachment as jest.Mock).mockRejectedValue(new Error('object not found'));

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'QR code unavailable' });
  });

  it('resolves the object key through the resident-safe RPC and never reads society_config directly', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(AUTHENTICATED_AUTH);
    const { client, rpc, from } = paymentInfoClient([{ upi_qr_object_key: 'society/x/upi-qr-1.png' }]);
    (createClient as jest.Mock).mockResolvedValue(client);
    (readPrivateAttachment as jest.Mock).mockResolvedValue(PNG_BYTES);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('get_resident_society_payment_info');
    expect(from).not.toHaveBeenCalled();
  });

  it('passes through the guard response when the caller is unauthorized', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({
      userId: null, role: null, unitId: null, societyId: null, societySlug: null,
      societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/society/upi-qr
// ---------------------------------------------------------------------------

function uploadRequest(file: File): NextRequest {
  const fd = new FormData();
  fd.set('qr', file);
  return new Request('http://localhost/api/society/upi-qr', { method: 'POST', body: fd }) as unknown as NextRequest;
}

describe('POST /api/society/upi-qr', () => {
  it('accepts a genuine PNG from an Admin, uploads it, updates the config, and returns ok', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const { client, rpc } = societyConfigClient({ previousKey: null });
    (createClient as jest.Mock).mockResolvedValue(client);
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await POST(uploadRequest(pngFile()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(uploadPrivateAttachment).toHaveBeenCalledWith(NEW_OBJECT_KEY, expect.any(Uint8Array), 'image/png');
    expect(rpc).toHaveBeenCalledWith('set_financial_setup_qr', { p_society_id: SOCIETY_ID, p_object_key: NEW_OBJECT_KEY });
    expect(deletePrivateAttachment).not.toHaveBeenCalled();
  });

  it('deletes the previously stored object after a successful replace', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const previousKey = 'society/x/upi-qr-old.png';
    const { client } = societyConfigClient({ previousKey });
    (createClient as jest.Mock).mockResolvedValue(client);
    (uploadPrivateAttachment as jest.Mock).mockResolvedValue(undefined);

    const response = await POST(uploadRequest(pngFile()));

    expect(response.status).toBe(200);
    expect(deletePrivateAttachment).toHaveBeenCalledWith(previousKey);
  });

  it('returns the guard response for a caller without financial-setup access and never uploads', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue({
      userId: null, role: null, societyId: null, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await POST(uploadRequest(pngFile()));

    expect(response.status).toBe(403);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 422 when the uploaded bytes fail the real magic-byte check', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const badFile = new File([GARBAGE_BYTES], 'qr.png', { type: 'image/png' });

    const response = await POST(uploadRequest(badFile));

    expect(response.status).toBe(422);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 422 for a genuine PDF because only images are accepted', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const pdfFile = new File([PDF_BYTES], 'qr.pdf', { type: 'application/pdf' });

    const response = await POST(uploadRequest(pdfFile));

    expect(response.status).toBe(422);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
  });

  it('returns 413 when the file exceeds the 1 MiB limit', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const oversized = new File([new Uint8Array(1024 * 1024 + 10)], 'qr.png', { type: 'image/png' });

    const response = await POST(uploadRequest(oversized));

    expect(response.status).toBe(413);
    expect(uploadPrivateAttachment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/society/upi-qr
// ---------------------------------------------------------------------------

describe('DELETE /api/society/upi-qr', () => {
  it('returns ok without deleting anything when no QR is configured', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const { client } = societyConfigClient({ previousKey: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deletePrivateAttachment).not.toHaveBeenCalled();
  });

  it('nulls the config column and deletes the stored object when one exists', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue(ADMIN_AUTH);
    const existingKey = 'society/x/upi-qr-current.png';
    const { client, rpc } = societyConfigClient({ previousKey: existingKey });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_financial_setup_qr', { p_society_id: SOCIETY_ID, p_object_key: null });
    expect(deletePrivateAttachment).toHaveBeenCalledWith(existingKey);
  });

  it('returns the guard response for a caller without financial-setup access', async () => {
    (requireFinancialSetupManager as jest.Mock).mockResolvedValue({
      userId: null, role: null, societyId: null, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await DELETE();

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
