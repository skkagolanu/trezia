import { POST } from '@/app/api/invites/route';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/require-auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn() }));

const SOCIETY_ID = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UNIT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const RESIDENT_ID = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';

function request(body: unknown) {
  return new Request('http://localhost/api/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function serviceFor(options: {
  resident?: { id: string; email: string | null; unit_id: string; is_active: boolean } | null;
  residentEmails?: Array<{ email: string | null }>;
  unit?: { id: string; society_id: string } | null;
  insertError?: { code: string; message?: string } | null;
  existingInviteRole?: string | null;
} = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const resident = options.resident === undefined
    ? { id: RESIDENT_ID, email: 'Resident@Example.com', unit_id: UNIT_ID, is_active: true }
    : options.resident;
  const unit = options.unit === undefined ? { id: UNIT_ID, society_id: SOCIETY_ID } : options.unit;

  const residentLookup: Record<string, jest.Mock> = {};
  residentLookup.select = jest.fn(() => residentLookup);
  residentLookup.eq = jest.fn(() => residentLookup);
  residentLookup.single = jest.fn(async () => ({ data: resident, error: resident ? null : { code: 'PGRST116' } }));
  residentLookup.not = jest.fn(async () => ({ data: options.residentEmails ?? [], error: null }));

  const unitLookup: Record<string, jest.Mock> = {};
  unitLookup.select = jest.fn(() => unitLookup);
  unitLookup.eq = jest.fn(() => unitLookup);
  unitLookup.single = jest.fn(async () => ({ data: unit, error: unit ? null : { code: 'PGRST116' } }));

  // The conflict path looks up the role already authorized for this (society, email)
  // so the 409 can name it. `existingRole` defaults to 'treasurer' unless overridden.
  const existingInviteRole = options.existingInviteRole === undefined ? 'treasurer' : options.existingInviteRole;
  const inviteLookup: Record<string, jest.Mock> = {};
  inviteLookup.select = jest.fn(() => inviteLookup);
  inviteLookup.eq = jest.fn(() => inviteLookup);
  inviteLookup.maybeSingle = jest.fn(async () => (
    existingInviteRole === null
      ? { data: null, error: null }
      : { data: { role: existingInviteRole }, error: null }
  ));

  return {
    inserted,
    residentLookup,
    unitLookup,
    inviteLookup,
    client: {
      from: jest.fn((table: string) => {
        if (table === 'residents') return residentLookup;
        if (table === 'units') return unitLookup;
        if (table === 'resident_invites') return inviteLookup;
        throw new Error(`Unexpected table ${table}`);
      }),
      rpc: jest.fn(async (_name: string, args: Record<string, unknown>) => {
        inserted.push({
          society_id: args.p_society_id,
          email: args.p_email,
          role: args.p_role,
          unit_id: args.p_unit_id,
          invited_by: args.p_actor_id,
        });
        return options.insertError
          ? { data: null, error: { message: options.insertError.code, ...options.insertError } }
          : { data: 'invite-1', error: null };
      }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({
    userId: 'admin-1', societyId: SOCIETY_ID, role: 'admin', unauthorized: null,
  });
});

describe('POST /api/invites', () => {
  it('derives resident email and flat on the server', async () => {
    const { client, inserted, residentLookup, unitLookup } = serviceFor();
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'resident', resident_id: RESIDENT_ID }));

    expect(response.status).toBe(201);
    expect(inserted[0]).toMatchObject({
      society_id: SOCIETY_ID,
      email: 'resident@example.com',
      role: 'resident',
      unit_id: UNIT_ID,
    });
    expect(residentLookup.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
    expect(unitLookup.eq).toHaveBeenCalledWith('society_id', SOCIETY_ID);
  });

  it('rejects a selected resident whose flat is outside the admin society', async () => {
    const { client, inserted } = serviceFor({ unit: null });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'resident', resident_id: RESIDENT_ID }));

    expect(response.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it('requires confirmation when a manual email differs from active resident emails', async () => {
    const { client, inserted } = serviceFor({ residentEmails: [{ email: 'known@example.com' }] });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'manual', unit_id: UNIT_ID, email: 'other@example.com' }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('EMAIL_MISMATCH');
    expect(inserted).toHaveLength(0);
  });

  it('creates a normalized manual resident authorization after confirmation', async () => {
    const { client, inserted } = serviceFor({ residentEmails: [{ email: 'known@example.com' }] });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({
      source: 'manual', unit_id: UNIT_ID, email: 'OTHER@EXAMPLE.COM', confirm_email_mismatch: true,
    }));

    expect(response.status).toBe(201);
    expect(inserted[0]).toMatchObject({ email: 'other@example.com', role: 'resident', unit_id: UNIT_ID });
  });

  it('creates only Treasurer access from the staff flow', async () => {
    const { client, inserted } = serviceFor();
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'treasurer', email: 'TREASURER@example.com' }));

    expect(response.status).toBe(201);
    expect(inserted[0]).toMatchObject({ email: 'treasurer@example.com', role: 'treasurer', unit_id: null });
  });

  it('does not accept an Admin invitation payload', async () => {
    const response = await POST(request({ source: 'admin', email: 'admin@example.com' }));

    expect(response.status).toBe(422);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    { code: '23505', message: 'duplicate key value violates unique constraint' },
    { code: 'P0001', message: 'ACTIVE_ACCESS_EXISTS' },
    { code: 'P0001', message: 'PENDING_ACCESS_EXISTS' },
  ])('maps an existing-access conflict to 409 ($message)', async insertError => {
    const { client } = serviceFor({ insertError });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'treasurer', email: 'treasurer@example.com' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Access already exists for this email',
      code: 'ACCESS_EXISTS',
      existingRole: 'treasurer',
    });
  });

  it('falls back to a null existingRole when the conflict-role lookup finds nothing', async () => {
    const { client } = serviceFor({
      insertError: { code: 'P0001', message: 'ACTIVE_ACCESS_EXISTS' },
      existingInviteRole: null,
    });
    (createServiceClient as jest.Mock).mockResolvedValue(client);

    const response = await POST(request({ source: 'treasurer', email: 'treasurer@example.com' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Access already exists for this email',
      code: 'ACCESS_EXISTS',
      existingRole: null,
    });
  });

  it('returns a stable non-sensitive code for an unknown RPC failure', async () => {
    const rpcError = {
      code: '42703',
      message: 'column resident_invites.created_by does not exist',
    };
    const { client } = serviceFor({ insertError: rpcError });
    (createServiceClient as jest.Mock).mockResolvedValue(client);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request({ source: 'treasurer', email: 'private@example.com' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to authorize access',
      code: 'ACCESS_AUTHORIZATION_FAILED',
    });
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining(rpcError));
    consoleError.mockRestore();
  });
});
