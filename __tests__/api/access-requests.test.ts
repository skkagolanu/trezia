import { POST, GET } from '@/app/api/access-requests/route';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { notifySocietyOperators } from '@/lib/notifications/notify';
import { _resetForTests } from '@/lib/utils/rate-limit';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/notifications/notify', () => ({
  notifySocietyOperators: jest.fn().mockResolvedValue(undefined),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SOCIETY_SLUG = 'green-heights';

function jsonRequest(body: unknown, ip = '203.0.113.5'): Request {
  return new Request('http://localhost/api/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

type LookupResult = { data: unknown; error: unknown };

function serviceFor(society: LookupResult, unit: LookupResult, rpc: { error: unknown }) {
  const societyChain: Record<string, jest.Mock> = {};
  societyChain.select = jest.fn(() => societyChain);
  societyChain.eq = jest.fn(() => societyChain);
  societyChain.maybeSingle = jest.fn(async () => society);

  const unitChain: Record<string, jest.Mock> = {};
  unitChain.select = jest.fn(() => unitChain);
  unitChain.eq = jest.fn(() => unitChain);
  unitChain.maybeSingle = jest.fn(async () => unit);

  return {
    societyChain,
    unitChain,
    client: {
      from: jest.fn((table: string) => (table === 'societies' ? societyChain : unitChain)),
      rpc: jest.fn(async () => rpc),
    },
  };
}

const validBody = {
  society_id: SOCIETY_ID,
  unit_id: UNIT_ID,
  email: 'resident@example.com',
  name: 'Resident Name',
  phone: '9876543210',
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

describe('POST /api/access-requests', () => {
  it('submits a request and alerts the society operators without leaking submitter details', async () => {
    const { client } = serviceFor(
      { data: { id: SOCIETY_ID, slug: SOCIETY_SLUG }, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: null },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(notifySocietyOperators).toHaveBeenCalledTimes(1);
    expect(notifySocietyOperators).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({
      title: 'New access request',
      url: `/s/${SOCIETY_SLUG}/settings`,
    }));
    // No email, name or phone in the push payload (PWA privacy rule).
    const payload = JSON.stringify((notifySocietyOperators as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toContain(validBody.email);
    expect(payload).not.toContain(validBody.name);
    expect(payload).not.toContain(validBody.phone);
  });

  it('falls back to an unscoped settings link when the society has no slug', async () => {
    const { client } = serviceFor(
      { data: { id: SOCIETY_ID, slug: null }, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: null },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(201);
    expect(notifySocietyOperators).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({ url: '/settings' }));
  });

  it('still returns 201 when the operator alert fails', async () => {
    const { client } = serviceFor(
      { data: { id: SOCIETY_ID, slug: SOCIETY_SLUG }, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: null },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (notifySocietyOperators as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const response = await POST(jsonRequest(validBody));

    // The request row is already committed; a push failure must not turn a
    // successful submission into an error for the (unauthenticated) requester.
    expect(response.status).toBe(201);
  });

  it('does not alert operators when the society or unit lookup fails validation', async () => {
    const { client } = serviceFor(
      { data: null, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: null },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(422);
    expect(notifySocietyOperators).not.toHaveBeenCalled();
  });

  it('does not alert operators when the RPC insert fails', async () => {
    const { client } = serviceFor(
      { data: { id: SOCIETY_ID, slug: SOCIETY_SLUG }, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: { message: 'insert failed' } },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(500);
    expect(notifySocietyOperators).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rate-limits repeated submissions from the same IP', async () => {
    const { client } = serviceFor(
      { data: { id: SOCIETY_ID, slug: SOCIETY_SLUG }, error: null },
      { data: { id: UNIT_ID }, error: null },
      { error: null },
    );
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    for (let i = 0; i < 5; i++) {
      const response = await POST(jsonRequest(validBody, '198.51.100.9'));
      expect(response.status).toBe(201);
    }
    const response = await POST(jsonRequest(validBody, '198.51.100.9'));

    expect(response.status).toBe(429);
    expect(notifySocietyOperators).toHaveBeenCalledTimes(5);
  });
});

describe('GET /api/access-requests', () => {
  it('requires admin authorization', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    (requireAdmin as jest.Mock).mockResolvedValue({ unauthorized: denied });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
