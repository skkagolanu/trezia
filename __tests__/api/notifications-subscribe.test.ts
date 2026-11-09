import type { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/notifications/subscribe/route';
import { requireAuth } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { pushEnabled, getVapidPublicKey, hasValidPushKeys, isAllowedPushEndpoint } from '@/lib/notifications/push';
import { _resetForTests } from '@/lib/utils/rate-limit';

jest.mock('@/lib/supabase/require-auth', () => ({ requireAuth: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/notifications/push', () => ({
  pushEnabled: jest.fn(),
  getVapidPublicKey: jest.fn(),
  hasValidPushKeys: jest.fn(),
  isAllowedPushEndpoint: jest.fn(),
}));

const USER_ID = 'user-1';
const SOCIETY_ID = 'society-1';

function postRequest(body: unknown) {
  return new Request('http://localhost/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function deleteRequest(body: unknown) {
  return new Request('http://localhost/api/notifications/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function serviceFor(options: {
  upsertError?: { code: string; message?: string } | null;
  deleteError?: { code: string } | null;
  statusData?: { id: string } | null;
  statusError?: { code: string } | null;
} = {}) {
  const rpc = jest.fn(async () => ({ data: null, error: options.upsertError ?? null }));

  const deleteChain: Record<string, jest.Mock> = {};
  deleteChain.delete = jest.fn(() => deleteChain);
  deleteChain.eq = jest.fn(() => deleteChain);
  // Terminal await resolves the chain — mimic PostgREST thenable by making eq awaitable on final call.
  let eqCallCount = 0;
  deleteChain.eq = jest.fn(() => {
    eqCallCount += 1;
    if (eqCallCount === 2) {
      return Promise.resolve({ error: options.deleteError ?? null });
    }
    return deleteChain;
  });

  const statusChain: Record<string, jest.Mock> = {};
  statusChain.select = jest.fn(() => statusChain);
  statusChain.eq = jest.fn(() => statusChain);
  statusChain.maybeSingle = jest.fn(async () => ({
    data: options.statusData ?? null,
    error: options.statusError ?? null,
  }));

  return {
    rpc,
    deleteChain,
    statusChain,
    client: {
      rpc,
      from: jest.fn(() => ({
        delete: deleteChain.delete,
        select: statusChain.select,
      })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  (isAllowedPushEndpoint as jest.Mock).mockReturnValue(true);
  (hasValidPushKeys as jest.Mock).mockReturnValue(true);
  (requireAuth as jest.Mock).mockResolvedValue({
    userId: USER_ID, role: 'admin', societyId: SOCIETY_ID, unauthorized: null,
  });
});

describe('GET /api/notifications/subscribe', () => {
  it('returns the vapid public key and enabled flag', async () => {
    (getVapidPublicKey as jest.Mock).mockReturnValue('pub-key');
    (pushEnabled as jest.Mock).mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vapidPublicKey: 'pub-key', enabled: true, subscribed: false });
  });

  it('reports subscribed only for the current user and society endpoint row', async () => {
    (getVapidPublicKey as jest.Mock).mockReturnValue('pub-key');
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client, statusChain } = serviceFor({ statusData: { id: 'subscription-1' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const request = new Request('http://localhost/api/notifications/subscribe?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2Fabc') as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vapidPublicKey: 'pub-key', enabled: true, subscribed: true });
    expect(statusChain.eq).toHaveBeenNthCalledWith(1, 'endpoint', 'https://fcm.googleapis.com/fcm/send/abc');
    expect(statusChain.eq).toHaveBeenNthCalledWith(2, 'user_id', USER_ID);
    expect(statusChain.eq).toHaveBeenNthCalledWith(3, 'society_id', SOCIETY_ID);
  });

  it('returns the unauthorized response when not authed', async () => {
    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 });
    (requireAuth as jest.Mock).mockResolvedValue({ userId: null, unauthorized });

    const response = await GET();

    expect(response.status).toBe(401);
  });
});

describe('POST /api/notifications/subscribe', () => {
  it('returns 503 when push is not configured', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(false);

    const response = await POST(postRequest({
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }));

    expect(response.status).toBe(503);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('upserts the subscription scoped to the authed user on conflict endpoint', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client, rpc } = serviceFor();
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(postRequest({
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'key1', auth: 'auth1' },
      userAgent: 'test-agent',
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('upsert_push_subscription', {
      p_user_id: USER_ID,
      p_society_id: SOCIETY_ID,
      p_endpoint: 'https://push.example/1',
      p_p256dh: 'key1',
      p_auth: 'auth1',
      p_user_agent: 'test-agent',
    });
  });

  it('rejects endpoint reassignment to another account', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceFor({ upsertError: { code: 'P0001', message: 'PUSH_ENDPOINT_OWNED_BY_ANOTHER_USER' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(postRequest({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }));

    expect(response.status).toBe(409);
  });

  it('rejects unsupported push endpoints before storage', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    (isAllowedPushEndpoint as jest.Mock).mockReturnValue(false);

    const response = await POST(postRequest({
      endpoint: 'https://127.0.0.1/push',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 422 for an invalid body missing keys', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);

    const response = await POST(postRequest({ endpoint: 'https://push.example/1' }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns the unauthorized response when not authed', async () => {
    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 });
    (requireAuth as jest.Mock).mockResolvedValue({ userId: null, unauthorized });

    const response = await POST(postRequest({
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }));

    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/notifications/subscribe', () => {
  it('deletes the subscription scoped to endpoint and authed user', async () => {
    const { client, deleteChain } = serviceFor();
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await DELETE(deleteRequest({ endpoint: 'https://push.example/1' }));

    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith('push_subscriptions');
    expect(deleteChain.eq).toHaveBeenNthCalledWith(1, 'endpoint', 'https://push.example/1');
    expect(deleteChain.eq).toHaveBeenNthCalledWith(2, 'user_id', USER_ID);
  });

  it('returns the unauthorized response when not authed', async () => {
    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 });
    (requireAuth as jest.Mock).mockResolvedValue({ userId: null, unauthorized });

    const response = await DELETE(deleteRequest({ endpoint: 'https://push.example/1' }));

    expect(response.status).toBe(401);
  });
});
