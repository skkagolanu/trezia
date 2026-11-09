import { notifyUser, notifySocietyOperators, notifySocietyResidents, notifyUnitResidents } from '@/lib/notifications/notify';
import { createServiceClient } from '@/lib/supabase/server';
import { pushEnabled, sendPush } from '@/lib/notifications/push';

jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));
jest.mock('@/lib/notifications/push', () => ({
  pushEnabled: jest.fn(),
  sendPush: jest.fn(),
}));

const USER_ID = 'user-1';
const SOCIETY_ID = 'society-1';
const MESSAGE = { title: 'Claim approved', body: 'Your payment was recorded.' };
const SAFE_MESSAGE = { title: 'Claim approved', body: 'Open Trezia to review your latest update.' };

type Row = { id: string; endpoint: string; p256dh: string; auth: string };

function serviceFor(rows: Row[]) {
  const deleted: string[] = [];

  const selectChain: Record<string, jest.Mock> = {};
  selectChain.select = jest.fn(() => selectChain);
  selectChain.eq = jest.fn(async () => ({ data: rows, error: null }));

  const deleteChain: Record<string, jest.Mock> = {};
  deleteChain.delete = jest.fn(() => deleteChain);
  deleteChain.eq = jest.fn(async (_col: string, value: string) => {
    deleted.push(value);
    return { data: null, error: null };
  });

  return {
    deleted,
    selectChain,
    deleteChain,
    client: {
      from: jest.fn(() => ({
        select: selectChain.select,
        delete: deleteChain.delete,
      })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notifyUser', () => {
  it('returns without loading subscriptions when push is disabled', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(false);

    await notifyUser(USER_ID, MESSAGE);

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends push to every subscription and deletes none when all succeed', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const rows: Row[] = [
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' },
      { id: 'sub-2', endpoint: 'https://push.example/2', p256dh: 'key2', auth: 'auth2' },
    ];
    const { client, deleted } = serviceFor(rows);
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifyUser(USER_ID, MESSAGE);

    expect(client.from).toHaveBeenCalledWith('push_subscriptions');
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenNthCalledWith(
      1,
      { endpoint: 'https://push.example/1', keys: { p256dh: 'key1', auth: 'auth1' } },
      SAFE_MESSAGE
    );
    expect(sendPush).toHaveBeenNthCalledWith(
      2,
      { endpoint: 'https://push.example/2', keys: { p256dh: 'key2', auth: 'auth2' } },
      SAFE_MESSAGE
    );
    expect(deleted).toHaveLength(0);
  });

  it('deletes the subscription row when sendPush reports gone', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const rows: Row[] = [
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' },
    ];
    const { client, deleted } = serviceFor(rows);
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: false, gone: true });

    await notifyUser(USER_ID, MESSAGE);

    expect(deleted).toEqual(['sub-1']);
  });

  it('never throws when sendPush rejects', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const rows: Row[] = [
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' },
    ];
    const { client } = serviceFor(rows);
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(notifyUser(USER_ID, MESSAGE)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// notifySocietyOperators — fan-out to a society's Admins and Treasurers.
// ---------------------------------------------------------------------------

type MembershipResult = { data: Array<{ user_id: string }> | null; error: { code: string } | null };

// notifyUser lives in the same module and is deliberately not mocked, so the
// fan-out has to satisfy both table reads: memberships, then each user's subs.
function serviceForOperators(memberships: MembershipResult) {
  const membershipChain: Record<string, jest.Mock> = {};
  membershipChain.select = jest.fn(() => membershipChain);
  membershipChain.eq = jest.fn(() => membershipChain);
  membershipChain.in = jest.fn(async () => memberships);

  const subscriptionChain: Record<string, jest.Mock> = {};
  subscriptionChain.select = jest.fn(() => subscriptionChain);
  subscriptionChain.eq = jest.fn(async () => ({
    data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' }],
    error: null,
  }));

  return {
    membershipChain,
    client: {
      from: jest.fn((table: string) => (table === 'society_memberships' ? membershipChain : subscriptionChain)),
    },
  };
}

describe('notifySocietyOperators', () => {
  it('returns without a query when push is disabled', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(false);

    await notifySocietyOperators(SOCIETY_ID, MESSAGE);

    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('sends to each active admin and treasurer exactly once', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client, membershipChain } = serviceForOperators({
      data: [{ user_id: 'admin-1' }, { user_id: 'treasurer-1' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifySocietyOperators(SOCIETY_ID, MESSAGE);

    // Revoked members must not be alerted, and role comes from memberships,
    // never the legacy profiles.role column.
    expect(membershipChain.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(membershipChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(membershipChain.in).toHaveBeenCalledWith('role', ['admin', 'treasurer']);
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledWith(expect.anything(), SAFE_MESSAGE);
  });

  it('deduplicates a user holding more than one operator membership', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForOperators({
      data: [{ user_id: 'admin-1' }, { user_id: 'admin-1' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifySocietyOperators(SOCIETY_ID, MESSAGE);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the society has no active operators', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForOperators({ data: [], error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await notifySocietyOperators(SOCIETY_ID, MESSAGE);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the membership lookup fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForOperators({ data: null, error: { code: 'PGRST500' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(notifySocietyOperators(SOCIETY_ID, MESSAGE)).resolves.toBeUndefined();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the service client itself fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    (createServiceClient as jest.Mock).mockRejectedValue(new Error('no service key'));

    await expect(notifySocietyOperators(SOCIETY_ID, MESSAGE)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// notifySocietyResidents — fan-out to a society's active Residents (e.g. a
// newly published notice). Mirrors notifySocietyOperators exactly, except
// for the role filter and the query method (.eq instead of .in, since there
// is exactly one resident role to match).
// ---------------------------------------------------------------------------

function serviceForResidents(memberships: MembershipResult) {
  // notify.ts chains three .eq() calls (society_id, status, role) and awaits
  // the result directly, the way the real PostgREST query builder is
  // thenable at any point in the chain — so this mock stays thenable at
  // every step rather than only resolving on a hardcoded call count.
  const membershipChain: Record<string, jest.Mock> = {};
  membershipChain.select = jest.fn(() => membershipChain);
  membershipChain.eq = jest.fn(() => membershipChain);
  membershipChain.then = jest.fn((resolve: (value: MembershipResult) => unknown) => resolve(memberships));

  const subscriptionChain: Record<string, jest.Mock> = {};
  subscriptionChain.select = jest.fn(() => subscriptionChain);
  subscriptionChain.eq = jest.fn(async () => ({
    data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' }],
    error: null,
  }));

  return {
    membershipChain,
    client: {
      from: jest.fn((table: string) => (table === 'society_memberships' ? membershipChain : subscriptionChain)),
    },
  };
}

describe('notifySocietyResidents', () => {
  it('returns without a query when push is disabled', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(false);

    await notifySocietyResidents(SOCIETY_ID, MESSAGE);

    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('sends to each active resident exactly once', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client, membershipChain } = serviceForResidents({
      data: [{ user_id: 'resident-1' }, { user_id: 'resident-2' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifySocietyResidents(SOCIETY_ID, MESSAGE);

    // Revoked members must not be alerted, and role comes from memberships,
    // never the legacy profiles.role column.
    expect(membershipChain.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(membershipChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(membershipChain.eq).toHaveBeenCalledWith('role', 'resident');
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledWith(expect.anything(), SAFE_MESSAGE);
  });

  it('deduplicates a user holding more than one resident membership', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForResidents({
      data: [{ user_id: 'resident-1' }, { user_id: 'resident-1' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifySocietyResidents(SOCIETY_ID, MESSAGE);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the society has no active residents', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForResidents({ data: [], error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await notifySocietyResidents(SOCIETY_ID, MESSAGE);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the membership lookup fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForResidents({ data: null, error: { code: 'PGRST500' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(notifySocietyResidents(SOCIETY_ID, MESSAGE)).resolves.toBeUndefined();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the service client itself fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    (createServiceClient as jest.Mock).mockRejectedValue(new Error('no service key'));

    await expect(notifySocietyResidents(SOCIETY_ID, MESSAGE)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// notifyUnitResidents — targets the active residents of specific units (bill
// overdue for a flat, payment recorded for a flat). Mirrors
// notifySocietyResidents except scoped by unit_id via .in() rather than every
// resident of the society, and fans the per-user push out through
// mapWithConcurrency instead of a sequential loop, since a run can name many
// units at once.
// ---------------------------------------------------------------------------

const UNIT_IDS = ['unit-1', 'unit-2'];

function serviceForUnitResidents(memberships: MembershipResult) {
  // Stays thenable at every point in the chain (select/eq/in all return the
  // same object) so the real call shape — .eq(society).in(unit_ids).eq(status).eq(role) —
  // resolves regardless of exact method-call count.
  const membershipChain: Record<string, jest.Mock> = {};
  membershipChain.select = jest.fn(() => membershipChain);
  membershipChain.eq = jest.fn(() => membershipChain);
  membershipChain.in = jest.fn(() => membershipChain);
  membershipChain.then = jest.fn((resolve: (value: MembershipResult) => unknown) => resolve(memberships));

  const subscriptionChain: Record<string, jest.Mock> = {};
  subscriptionChain.select = jest.fn(() => subscriptionChain);
  subscriptionChain.eq = jest.fn(async () => ({
    data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'key1', auth: 'auth1' }],
    error: null,
  }));

  return {
    membershipChain,
    client: {
      from: jest.fn((table: string) => (table === 'society_memberships' ? membershipChain : subscriptionChain)),
    },
  };
}

describe('notifyUnitResidents', () => {
  it('returns without a query when push is disabled', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(false);

    await notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE);

    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns without a query when no unit ids are given', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);

    await notifyUnitResidents(SOCIETY_ID, [], MESSAGE);

    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('sends to each active resident of the named units exactly once, scoped by unit_id', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client, membershipChain } = serviceForUnitResidents({
      data: [{ user_id: 'resident-1' }, { user_id: 'resident-2' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE);

    // Scoped to the given units and active resident memberships only — never
    // the legacy profiles.role column, and revoked members excluded.
    expect(membershipChain.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(membershipChain.in).toHaveBeenCalledWith('unit_id', UNIT_IDS);
    expect(membershipChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(membershipChain.eq).toHaveBeenCalledWith('role', 'resident');
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledWith(expect.anything(), SAFE_MESSAGE);
  });

  it('deduplicates a user who is resident of more than one of the named units', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForUnitResidents({
      data: [{ user_id: 'resident-1' }, { user_id: 'resident-1' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockResolvedValue({ ok: true, gone: false });

    await notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when none of the named units has an active resident', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForUnitResidents({ data: [], error: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the membership lookup fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForUnitResidents({ data: null, error: { code: 'PGRST500' } });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    await expect(notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE)).resolves.toBeUndefined();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('never throws when the service client itself fails', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    (createServiceClient as jest.Mock).mockRejectedValue(new Error('no service key'));

    await expect(notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE)).resolves.toBeUndefined();
  });

  it('never throws when a push send rejects for one of several residents', async () => {
    (pushEnabled as jest.Mock).mockReturnValue(true);
    const { client } = serviceForUnitResidents({
      data: [{ user_id: 'resident-1' }, { user_id: 'resident-2' }],
      error: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    (sendPush as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(notifyUnitResidents(SOCIETY_ID, UNIT_IDS, MESSAGE)).resolves.toBeUndefined();
  });
});
