import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_PREFIXES, PROTECTED_PREFIXES } from '@/lib/constants/routes';
import { DEMO_COOKIE, DEMO_SOCIETY_SLUG } from '@/lib/demo/session';
import { isAppRole, roleHome as homeForRole } from '@/lib/auth/roles';
import { multiSocietyRoutingEnabled } from '@/lib/features';
import { classifyApiRequest, parseScopedPage, resolveBridgeRedirect } from '@/lib/request-scope';
import { contentSecurityPolicy } from '@/lib/security/csp';

const MFA_CHALLENGE_PATH = '/mfa-challenge';

export function demoBridgeDestination(
  multiSocietyEnabled: boolean,
  hasScopedRequest: boolean,
  originalPath: string,
): string | null {
  if (
    !multiSocietyEnabled
    || hasScopedRequest
    || !PROTECTED_PREFIXES.some(prefix => originalPath.startsWith(prefix))
    || originalPath.startsWith('/societies')
  ) {
    return null;
  }

  return `/s/${DEMO_SOCIETY_SLUG}${originalPath}`;
}

export function isDemoLifecycleApi(pathname: string): boolean {
  return pathname === '/api/demo/start' || pathname === '/api/demo/end';
}

export function shouldExitDemoSession(pathname: string, scopedSlug: string | null): boolean {
  if (scopedSlug !== null && scopedSlug !== DEMO_SOCIETY_SLUG) return true;
  return pathname === '/login'
    || pathname === '/verify'
    || pathname === '/societies'
    || pathname.startsWith('/auth/');
}

async function roleHome(supabase: SupabaseClient, userId: string): Promise<string> {
  if (!multiSocietyRoutingEnabled()) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    return isAppRole(profile?.role) ? homeForRole(profile.role) : '/access-denied';
  }
  const [{ data: owner }, { data: memberships }] = await Promise.all([
    supabase.from('platform_owners').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('society_memberships')
      .select('role, societies(slug, status)')
      .eq('user_id', userId)
      .eq('status', 'active'),
  ]);
  // Platform owners keep the existing owner/multi-membership '/societies' behavior
  // unconditionally — they may enter a suspended society read-only. For everyone
  // else, a membership whose society is suspended must not be treated as a usable
  // home: routing there would 423 the page guard, which redirects back to /login,
  // which calls roleHome() again — an infinite /login <-> /s/{slug} redirect loop.
  if (owner) return '/societies';
  const typedMemberships = (memberships ?? []) as {
    role?: unknown;
    societies?: { slug?: string; status?: string } | null;
  }[];
  const activeMemberships = typedMemberships.filter(m => m.societies?.status === 'active');
  if (activeMemberships.length > 1) return '/societies';
  const membership = activeMemberships[0];
  if (!membership?.societies?.slug || !isAppRole(membership.role)) return '/access-denied';
  return `/s/${membership.societies.slug}${homeForRole(membership.role)}`;
}

export async function proxy(request: NextRequest) {
  const originalPath = request.nextUrl.pathname;
  const multiSocietyEnabled = multiSocietyRoutingEnabled();
  const apiClass = multiSocietyEnabled
    ? classifyApiRequest(request.method, originalPath)
    : { kind: 'not-api' as const };
  const scopedPage = multiSocietyEnabled ? parseScopedPage(originalPath) : null;
  const effectiveScoped = apiClass.kind === 'scoped-operational'
    ? { slug: apiClass.slug, logicalPath: apiClass.logicalPath, isApi: true }
    : scopedPage
      ? { ...scopedPage, isApi: false }
      : null;
  const hadDemoCookie = request.cookies.get(DEMO_COOKIE)?.value === '1';
  const exitDemo = hadDemoCookie && shouldExitDemoSession(
    originalPath,
    effectiveScoped?.slug ?? null,
  );
  // A demo cookie is UI state, never an application principal. Once the
  // browser enters a real society or auth route, remove it from both the
  // downstream request and response so it cannot shadow a valid login.
  if (exitDemo) request.cookies.delete(DEMO_COOKIE);
  const requestHeaders = new Headers(request.headers);
  let response: NextResponse;
  if (effectiveScoped) {
    requestHeaders.set('x-society-slug', effectiveScoped.slug);
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = effectiveScoped.logicalPath;
    response = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (exitDemo) response.cookies.delete(DEMO_COOKIE);

  // Demo mode: gated per-browser by a cookie, not a deployment-wide env var —
  // a visitor who clicked "Try Demo" skips real auth entirely for this request.
  if (hadDemoCookie && !exitDemo) {
    // Demo is not an application principal. It may render only local fixture
    // data; it cannot use operational/control-plane APIs, even when a future
    // route forgets to use the demo-safe Supabase factory. Keep only the two
    // cookie lifecycle endpoints reachable.
    if (originalPath.startsWith('/api/') && !isDemoLifecycleApi(originalPath)) {
      return NextResponse.json({ error: 'API access is unavailable in demo mode' }, {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    // With routing on, an unscoped protected path (e.g. a stale bookmark to
    // /payments) carries no x-society-slug header, so the app layout downgrades
    // the demo admin to a capability-less role. Land the demo on its scoped
    // reasoning as the /api/demo/start entry redirect.
    const demoDestination = demoBridgeDestination(
      multiSocietyEnabled,
      effectiveScoped !== null,
      originalPath,
    );
    if (demoDestination) {
      return NextResponse.redirect(new URL(demoDestination, request.url));
    }
    // Browser-enforced second boundary: demo pages may fetch only same-origin
    // RSC/static resources. Supabase and telemetry origins are absent.
    response.headers.set('Content-Security-Policy', contentSecurityPolicy(process.env.NODE_ENV === 'development', true));
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Trezia-Demo', 'fixture-only');
    return response;
  }

  if (apiClass.kind === 'legacy-operational') {
    return NextResponse.json({ error: 'Society-scoped API path required' }, { status: 400 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          );
        },
      },
    }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  const pathname = effectiveScoped?.logicalPath ?? originalPath;

  // A stale/used refresh token throws here while the bad sb-* cookies persist, so
  // every subsequent load re-throws — the wedged state a non-technical user can
  // only escape by clearing cookies by hand. Clear them ourselves and send to a
  // clean login. Gated on sb-* cookies actually being present: a cleanly
  // has no cookies, so this leaves the public pages (landing, request-access)
  // untouched for them.
  //
  // CRITICAL: never fire on the auth flow itself. /auth/callback establishes the
  // cookies from a prior login) — intercepting it here would eat the magic-link
  // token before it's exchanged and make sign-in look broken.
  const isAuthFlow = pathname.startsWith('/auth/') || pathname === '/login' || pathname === '/verify';
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-'));
  if (userError && hasAuthCookie && !isAuthFlow) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith('sb-')) redirect.cookies.delete(c.name);
    }
    return redirect;
  }

  const isProtected        = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  const isAdminRoute       = ADMIN_PREFIXES.some(p => pathname.startsWith(p));
  const isAuthPage         = pathname === '/login' || pathname === '/verify';
  const isMfaChallengePage = pathname === MFA_CHALLENGE_PATH;

  // Unauthenticated → login. The MFA challenge page also needs at least an
  if (!user && (isProtected || isMfaChallengePage) && !effectiveScoped?.isApi) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user) {
    // MFA (optional TOTP — Settings → Security). getAuthenticatorAssuranceLevel()
    // A user with no enrolled factor always has nextLevel === currentLevel, so this
    // is a no-op for the common case and only gates users who opted into MFA.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const mfaPending = !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2';

    if (isMfaChallengePage) {
      // Nothing to challenge (no factor enrolled, or already elevated this
      if (!mfaPending) {
        return NextResponse.redirect(new URL(await roleHome(supabase, user.id), request.url));
      }
      return response;
    }

    if (mfaPending && (isProtected || isAuthPage)) {
      return NextResponse.redirect(new URL(MFA_CHALLENGE_PATH, request.url));
    }

    // Authenticated on login/verify → redirect to role-appropriate home
    if (isAuthPage) {
      return NextResponse.redirect(new URL(await roleHome(supabase, user.id), request.url));
    }

    // Compatibility bridge while saved links and old bookmarks still use the
    // pre-membership routes. Only meaningful when scoped routing is enabled —
    // with it disabled, roleHome() returns a bare legacy path (not a scoped
    // one), so there is nothing to bridge to and this must not run: it used
    // to fire unconditionally here, sending every legacy-mode request through
    // resolveBridgeRedirect's slug-splice path and producing /s/undefined/...
    if (multiSocietyEnabled && !scopedPage && isProtected && !pathname.startsWith('/societies')) {
      const destination = await roleHome(supabase, user.id);
      const target = resolveBridgeRedirect(destination, pathname);
      if (target !== pathname) {
        return NextResponse.redirect(new URL(target, request.url));
      }
    }

    // Scoped page authorization is repeated in the server page guard. This
    // proxy check is only an early role-specific redirect for clearer UX.
    if (effectiveScoped && !effectiveScoped.isApi && isAdminRoute) {
      const { data: membership } = await supabase
        .from('society_memberships')
        .select('role, societies!inner(slug)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .eq('societies.slug', effectiveScoped.slug)
        .maybeSingle();
      if (!isAppRole(membership?.role) || !['admin', 'treasurer'].includes(membership.role)) {
        return NextResponse.redirect(new URL(`/s/${effectiveScoped.slug}${homeForRole(isAppRole(membership?.role) ? membership.role : null)}`, request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|api/|privacy|manifest.json|sw.js|robots.txt|sitemap.xml|icon.svg|offline).*)',
  ],
};
