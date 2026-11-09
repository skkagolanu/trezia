import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { isDemoSession } from '@/lib/demo/session.server';
import { DEMO_SOCIETY_SLUG } from '@/lib/demo/session';
import { check } from '@/lib/utils/rate-limit';
import { hasCapability, isAppRole, type AppRole, type Capability } from '@/lib/auth/roles';
import { isTrustedRequestOrigin } from '@/lib/security/same-origin';

// Mirrors the Origin/Host check Next.js Server Actions perform internally. Our writes go
// through cookie-authenticated API routes, which have no built-in CSRF defense, so we
// replicate it at the single chokepoint every admin/write route passes through (requireAdmin).
// Rule: if an Origin header is present it must match the request host; absent Origin
// (top-level GET navigations, same-origin reads) has nothing to forge and is allowed.
async function assertSameOrigin(): Promise<Response | null> {
  const h = await headers();
  const origin = h.get('origin');
  if (!origin) return null;
  if (!isTrustedRequestOrigin(origin, process.env, h.get('host'))) {
    return Response.json({ error: 'Cross-origin request blocked' }, { status: 403 });
  }
  return null;
}

export type AuthResult =
  | { userId: string; role: AppRole; unitId: string | null; societyId: string; societySlug: string | null; societyStatus: 'active' | 'suspended'; isPlatformOwner: boolean; unauthorized: null }
  | { userId: null; role: null; unitId: null; societyId: null; societySlug: null; societyStatus: null; isPlatformOwner: false; unauthorized: Response };

const DEMO_AUTH: AuthResult = { userId: 'demo-user', role: 'admin', unitId: null, societyId: 'demo-society', societySlug: null, societyStatus: 'active', isPlatformOwner: false, unauthorized: null };

export async function requireAuth(): Promise<AuthResult> {
  // Demo mode short-circuits before ANY Supabase call, gated by a per-browser
  // cookie (not a deployment-wide env var) so it works on the real production
  // URL with nothing to configure. Fixed as an admin identity so the
  // flagship (treasurer-side) features are what a visitor sees.
  if (await isDemoSession()) return DEMO_AUTH;

  // S11: CSRF check lives here (not just requireAdmin) so resident write paths —
  // /api/access-requests is the first — are covered too. Harmless on GET page
  // loads: they carry no Origin header, so assertSameOrigin returns null.
  const csrf = await assertSameOrigin();
  if (csrf) return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: csrf };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const requestHeaders = await headers();
  const societySlug = requestHeaders.get('x-society-slug');
  if (societySlug) {
    const context = await loadUserSocieties(user.id, supabase);
    const society = context.societies.find(item => item.slug === societySlug);
    if (!society) {
      return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Society access not configured' }, { status: 403 }) };
    }
    if (society.status !== 'active' && !context.isPlatformOwner) {
      return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Society is suspended' }, { status: 423 }) };
    }
    return {
      userId: user.id,
      role: society.role,
      unitId: society.unitId,
      societyId: society.id,
      societySlug: society.slug,
      societyStatus: society.status,
      isPlatformOwner: context.isPlatformOwner,
      unauthorized: null,
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id, society_id')
    .eq('id', user.id)
    .single();

  // No profile row means the user has not been set up yet (either an admin whose
  // profile hasn't been seeded after migration 017/018, or a first-time login that
  // somehow bypassed the callback). Treat as unauthorized so page guards redirect
  // to /login — they'll hit /access-denied if no invite exists.
  if (!profile) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Profile not configured' }, { status: 401 }) };
  }

  if (!isAppRole(profile.role) || !profile.society_id) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Profile role is not supported' }, { status: 403 }) };
  }

  return {
    userId: user.id,
    role: profile.role,
    unitId: profile.unit_id ?? null,
    societyId: profile.society_id,
    societySlug: null,
    societyStatus: 'active',
    isPlatformOwner: false,
    unauthorized: null,
  };
}

export type AdminAuthResult =
  | { userId: string; role: AppRole; societyId: string; unauthorized: null }
  | { userId: null; role: null; societyId: null; unauthorized: Response };

export async function requireCapability(capability: Capability): Promise<AdminAuthResult> {
  const auth = await requireAuth();
  if (auth.unauthorized) return { userId: null, role: null, societyId: null, unauthorized: auth.unauthorized };
  const suspendedOwnerRead = auth.societyStatus === 'suspended'
    && auth.isPlatformOwner
    && ['finance_read', 'export_audit', 'manage_backups', 'operations_read'].includes(capability);
  if (auth.societyStatus !== 'active' && !suspendedOwnerRead) {
    return { userId: null, role: null, societyId: null, unauthorized: Response.json({ error: 'Society is suspended' }, { status: 423 }) };
  }
  if (!hasCapability(auth.role, capability) && !suspendedOwnerRead) {
    return { userId: null, role: null, societyId: null, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const rl = check(`${capability}:${auth.societyId}:${auth.userId}`, 100, 60_000);
  if (!rl.allowed) {
    return {
      userId: null,
      role: null,
      societyId: null,
      unauthorized: Response.json({ error: 'Too many requests — please slow down.' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }),
    };
  }

  return { userId: auth.userId, role: auth.role, societyId: auth.societyId, unauthorized: null };
}

export async function requireAdmin(): Promise<AdminAuthResult> {
  return requireCapability('manage_access');
}

export async function requireFinancialOperator(): Promise<AdminAuthResult> {
  return requireCapability('finance_write');
}

export async function requireFinancialSetupManager(): Promise<AdminAuthResult> {
  return requireCapability('manage_financial_setup');
}

export async function requireFinancialReader(): Promise<AdminAuthResult> {
  return requireCapability('finance_read');
}

export async function requireBackupManager(): Promise<AdminAuthResult> {
  return requireCapability('manage_backups');
}

export async function requireOperationsReader(): Promise<AuthResult> {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth;
  const suspendedOwnerRead = auth.societyStatus === 'suspended' && auth.isPlatformOwner;
  if (auth.societyStatus !== 'active' && !suspendedOwnerRead) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Society is suspended' }, { status: 423 }) };
  }
  if (!hasCapability(auth.role, 'operations_read') && !suspendedOwnerRead) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const rl = check(`operations_read:${auth.societyId}:${auth.userId}`, 100, 60_000);
  if (!rl.allowed) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Too many requests — please slow down.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }) };
  }
  return auth;
}

export async function requirePublishedDocumentsReader(): Promise<AuthResult> {
  const auth = await requireAuth();
  if (auth.unauthorized) return auth;
  const suspendedOwnerRead = auth.societyStatus === 'suspended' && auth.isPlatformOwner;
  const allowed = hasCapability(auth.role, 'published_documents_read') || hasCapability(auth.role, 'operations_read');
  if (auth.societyStatus !== 'active' && !suspendedOwnerRead) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Society is suspended' }, { status: 423 }) };
  }
  if (!allowed && !suspendedOwnerRead) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const rl = check(`published_documents_read:${auth.societyId}:${auth.userId}`, 100, 60_000);
  if (!rl.allowed) {
    return { userId: null, role: null, unitId: null, societyId: null, societySlug: null, societyStatus: null, isPlatformOwner: false, unauthorized: Response.json({ error: 'Too many requests — please slow down.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }) };
  }
  return auth;
}

export async function requireOperationsOperator(): Promise<AdminAuthResult> {
  return requireCapability('operations_write');
}

export type SocietyAccess = {
  userId: string;
  societyId: string;
  societySlug: string;
  societyName: string;
  societyShortName: string | null;
  societyStatus: 'active' | 'suspended';
  role: AppRole;
  unitId: string | null;
  isPlatformOwner: boolean;
};

export type SocietyAuthResult =
  | (SocietyAccess & { unauthorized: null })
  | { userId: null; societyId: null; societySlug: null; societyName: null; societyShortName: null; societyStatus: null; role: null; unitId: null; isPlatformOwner: false; unauthorized: Response };

export type UserSociety = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  status: 'active' | 'suspended';
  role: AppRole;
  unitId: string | null;
};

type AuthenticatedSupabase = Awaited<ReturnType<typeof createClient>>;

async function loadUserSocieties(userId: string, supabase: AuthenticatedSupabase) {
  const [{ data: owner }, { data: memberships }] = await Promise.all([
    supabase.from('platform_owners').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('society_memberships')
      .select('role, unit_id, societies(id, slug, name, short_name, status)')
      .eq('user_id', userId).eq('status', 'active'),
  ]);
  const societies = (memberships ?? []).flatMap(row => {
    const society = (row as unknown as { societies: { id: string; slug: string; name: string; short_name: string | null; status: 'active' | 'suspended' } | null }).societies;
    if (!society || !isAppRole(row.role)) return [];
    return [{ id: society.id, slug: society.slug, name: society.name, shortName: society.short_name, status: society.status, role: row.role, unitId: row.unit_id ?? null }];
  });
  return { userId, isPlatformOwner: !!owner, societies };
}

export async function listUserSocieties(): Promise<{ userId: string; isPlatformOwner: boolean; societies: UserSociety[] } | null> {
  if (await isDemoSession()) return {
    userId: 'demo-user', isPlatformOwner: false,
    societies: [{ id: 'demo-society', slug: DEMO_SOCIETY_SLUG, name: 'Demo Apartments', shortName: 'DA', status: 'active', role: 'admin', unitId: null }],
  };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return loadUserSocieties(user.id, supabase);
}

function denied(error: string, status: number): SocietyAuthResult {
  return {
    userId: null, societyId: null, societySlug: null, societyName: null,
    societyShortName: null, societyStatus: null, role: null, unitId: null,
    isPlatformOwner: false, unauthorized: Response.json({ error }, { status }),
  };
}

export async function requireSocietyAuth(societySlug: string): Promise<SocietyAuthResult> {
  const csrf = await assertSameOrigin();
  if (csrf) return denied('Cross-origin request blocked', 403);
  const context = await listUserSocieties();
  if (!context) return denied('Unauthorized', 401);
  const society = context.societies.find(item => item.slug === societySlug);
  if (!society) return denied('Society access not configured', 403);
  return {
    userId: context.userId,
    societyId: society.id,
    societySlug: society.slug,
    societyName: society.name,
    societyShortName: society.shortName,
    societyStatus: society.status,
    role: society.role,
    unitId: society.unitId,
    isPlatformOwner: context.isPlatformOwner,
    unauthorized: null,
  };
}

export async function requireSocietyCapability(
  societySlug: string,
  capability: Capability,
): Promise<SocietyAuthResult> {
  const auth = await requireSocietyAuth(societySlug);
  if (auth.unauthorized) return auth;
  const suspendedOwnerRead = auth.societyStatus === 'suspended'
    && auth.isPlatformOwner
    && ['finance_read', 'export_audit', 'manage_backups', 'operations_read'].includes(capability);
  if (auth.societyStatus !== 'active' && !suspendedOwnerRead) return denied('Society is suspended', 423);
  if (!hasCapability(auth.role, capability) && !suspendedOwnerRead) return denied('Forbidden', 403);
  const rl = check(`${capability}:${auth.societyId}:${auth.userId}`, 100, 60_000);
  if (!rl.allowed) return denied('Too many requests — please slow down.', 429);
  return auth;
}

export async function requirePlatformOwner(): Promise<{ userId: string; unauthorized: null } | { userId: null; unauthorized: Response }> {
  const csrf = await assertSameOrigin();
  if (csrf) return { userId: null, unauthorized: csrf };
  const context = await listUserSocieties();
  if (!context) return { userId: null, unauthorized: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!context.isPlatformOwner) return { userId: null, unauthorized: Response.json({ error: 'Platform Owner required' }, { status: 403 }) };
  return { userId: context.userId, unauthorized: null };
}
