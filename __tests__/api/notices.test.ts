import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/notices/route';
import { PATCH } from '@/app/api/notices/[id]/route';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, requireFinancialOperator } from '@/lib/supabase/require-auth';
import { notifySocietyResidents } from '@/lib/notifications/notify';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireAuth: jest.fn(),
  requireFinancialOperator: jest.fn(),
}));
jest.mock('@/lib/notifications/notify', () => ({
  notifySocietyResidents: jest.fn().mockResolvedValue(undefined),
}));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOTICE_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SOCIETY_SLUG = 'green-heights';
type NoticeFixture = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  expires_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const notice: NoticeFixture = {
  id: NOTICE_ID,
  title: 'Water shutdown',
  body: 'Water will be unavailable on Sunday morning.',
  published_at: '2026-07-19T09:00:00.000Z',
  expires_at: null,
  archived_at: null,
  created_at: '2026-07-18T09:00:00.000Z',
  updated_at: '2026-07-18T09:00:00.000Z',
};

function jsonRequest(url: string, method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-society-slug': SOCIETY_SLUG },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function listClient(result: { data: typeof notice[] | null; error: unknown }) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.not = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.or = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.range = jest.fn(() => query);
  query.then = jest.fn((resolve: (value: typeof result) => unknown) => resolve(result));
  return { client: { from: jest.fn(() => query) }, query };
}

function mutationClient(result: { data: typeof notice | null; error: unknown }) {
  const query: Record<string, jest.Mock> = {};
  query.insert = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.single = jest.fn(async () => result);
  query.maybeSingle = jest.fn(async () => result);
  return { client: { from: jest.fn(() => query) }, query };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({
    userId: 'resident-1', role: 'resident', unitId: 'unit-1', societyId: SOCIETY_ID,
    societySlug: SOCIETY_SLUG,
    unauthorized: null,
  });
  (requireFinancialOperator as jest.Mock).mockResolvedValue({
    userId: 'operator-1', role: 'treasurer', societyId: SOCIETY_ID, societySlug: SOCIETY_SLUG, unauthorized: null,
  });
});

describe('GET /api/notices', () => {
  it('returns only the resident-safe published, active notice projection', async () => {
    const { client, query } = listClient({ data: [notice], error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notices: [notice], page: 1, limit: 25 });
    expect(client.from).toHaveBeenCalledWith('society_notices');
    expect(query.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(query.not).toHaveBeenCalledWith('published_at', 'is', null);
    expect(query.is).toHaveBeenCalledWith('archived_at', null);
    expect(query.in).toHaveBeenCalledWith('audience', ['ALL_MEMBERS', 'RESIDENTS']);
    expect(query.or).toHaveBeenCalledWith(expect.stringMatching(/^expires_at\.is\.null,expires_at\.gt\./));
    expect(query.select).toHaveBeenCalledWith(expect.not.stringContaining('created_by'));
  });

  it('allows an operator to see all tenant notices without resident visibility filters', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({
      userId: 'operator-1', role: 'treasurer', unitId: null, societyId: SOCIETY_ID, unauthorized: null,
      societySlug: SOCIETY_SLUG,
    });
    const { client, query } = listClient({ data: [notice], error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(query.not).not.toHaveBeenCalled();
    expect(query.is).not.toHaveBeenCalled();
    expect(query.or).not.toHaveBeenCalled();
  });

  it('does not expose a database error while loading notices', async () => {
    const { client } = listClient({ data: null, error: { message: 'private RLS detail' } });
    (createClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load notices' });
    expect(consoleError).toHaveBeenCalledWith('[notices] list failed');
    consoleError.mockRestore();
  });
});

describe('notice writes', () => {
  it('creates a notice with the operator-derived tenant and author', async () => {
    const { client, query } = mutationClient({ data: notice, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
      published_at: notice.published_at,
    }));

    expect(response.status).toBe(201);
    expect(client.from).toHaveBeenCalledWith('society_notices');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      society_id: SOCIETY_ID,
      created_by: 'operator-1',
      title: notice.title,
      body: notice.body,
    }));
  });

  it('archives only the specified notice inside the operator society', async () => {
    const { client, query } = mutationClient({ data: { ...notice, archived_at: '2026-07-19T10:00:00.000Z' }, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await PATCH(
      jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices/${NOTICE_ID}`, 'PATCH', { archive: true }),
      { params: Promise.resolve({ id: NOTICE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith('society_notices');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', NOTICE_ID);
    expect(query.eq).toHaveBeenNthCalledWith(2, 'society_id', SOCIETY_ID);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
  });

  it('rejects resident writes through the financial-operator guard', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    (requireFinancialOperator as jest.Mock).mockResolvedValue({ unauthorized: denied });

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
    }));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('alerts residents of the society for the default ALL_MEMBERS audience without leaking the notice content', async () => {
    const { client } = mutationClient({ data: notice, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
    }));

    expect(response.status).toBe(201);
    expect(notifySocietyResidents).toHaveBeenCalledTimes(1);
    expect(notifySocietyResidents).toHaveBeenCalledWith(SOCIETY_ID, expect.objectContaining({
      title: 'New notice posted',
      url: `/s/${SOCIETY_SLUG}/notices`,
    }));
    // No notice title or body in the push payload (PWA privacy rule) — a
    // title plus a link only.
    const payload = JSON.stringify((notifySocietyResidents as jest.Mock).mock.calls[0][1]);
    expect(payload).not.toContain(notice.title);
    expect(payload).not.toContain(notice.body);
  });

  it('alerts residents for an explicit RESIDENTS audience', async () => {
    const { client } = mutationClient({ data: notice, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
      audience: 'RESIDENTS',
    }));

    expect(response.status).toBe(201);
    expect(notifySocietyResidents).toHaveBeenCalledTimes(1);
  });

  it('does not alert residents for an OPERATORS-only notice', async () => {
    const { client } = mutationClient({ data: notice, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
      audience: 'OPERATORS',
    }));

    expect(response.status).toBe(201);
    expect(notifySocietyResidents).not.toHaveBeenCalled();
  });

  it('still returns 201 when the resident alert fails', async () => {
    const { client } = mutationClient({ data: notice, error: null });
    (createClient as jest.Mock).mockResolvedValue(client);
    (notifySocietyResidents as jest.Mock).mockRejectedValueOnce(new Error('push gateway down'));

    const response = await POST(jsonRequest(`http://localhost/api/s/${SOCIETY_SLUG}/notices`, 'POST', {
      title: notice.title,
      body: notice.body,
    }));

    // The notice is already committed; a push failure must not turn a
    // successful post into an error for the operator.
    expect(response.status).toBe(201);
  });
});
