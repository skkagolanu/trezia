import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createServiceClient } from '@/lib/supabase/server';
import { DEMO_COOKIE } from '@/lib/demo/session';
import { isAppRole, roleHome } from '@/lib/auth/roles';
import { multiSocietyRoutingEnabled } from '@/lib/features';

type CookieItem = { name: string; value: string; options?: Record<string, unknown> };

function redirect(url: string, cookies: CookieItem[]): NextResponse {
  const res = NextResponse.redirect(url);
  cookies.forEach(({ name, value, options }) =>
    res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
  );
  // Belt-and-suspenders: a real auth attempt reaching this route means the
  // visitor is no longer "just browsing demo" — a stale demo cookie from an
  res.cookies.delete(DEMO_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code       = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type       = searchParams.get('type');

  try {
    // Collect cookies written during the exchange so they can be applied to
    // whichever final redirect we return — not hardcoded to /payments.
    const sessionCookies: CookieItem[] = [];

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) { sessionCookies.push(...cookiesToSet); },
        },
      }
    );

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`, sessionCookies);
    } else if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as EmailOtpType });
      if (error) return redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`, sessionCookies);
    } else {
      return redirect(`${origin}/login?error=missing_credentials`, sessionCookies);
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return redirect(`${origin}/login?error=no_user`, sessionCookies);

    const service = await createServiceClient();

    if (!multiSocietyRoutingEnabled()) {
      const { data: existingProfile } = await service
        .from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (existingProfile && isAppRole(existingProfile.role)) {
        return redirect(`${origin}${roleHome(existingProfile.role)}`, sessionCookies);
      }
      const { data: claimed, error } = await service.rpc('claim_access_invite', {
        p_user_id: user.id, p_email: user.email,
      });
      const row = (claimed as Array<{ app_role: unknown }> | null)?.[0];
      if (error || !row || !isAppRole(row.app_role)) {
        return redirect(`${origin}/access-denied?error=setup_failed`, sessionCookies);
      }
      return redirect(`${origin}${roleHome(row.app_role)}`, sessionCookies);
    }

    // Claim on every login. Returning users may have received authorizations
    const { error: claimError } = await service.rpc('claim_access_authorizations', {
      p_user_id: user.id,
      p_email: user.email,
    });
    if (claimError) {
      console.error('access authorization claim failed:', claimError.message);
      return redirect(`${origin}/access-denied?error=setup_failed`, sessionCookies);
    }

    const [{ data: owner }, { data: memberships, error: membershipError }] = await Promise.all([
      service.from('platform_owners').select('user_id').eq('user_id', user.id).maybeSingle(),
      service.from('society_memberships')
        .select('role, societies!inner(slug)')
        .eq('user_id', user.id)
        .eq('status', 'active'),
    ]);

    if (membershipError) {
      console.error('membership destination lookup failed:', membershipError.message);
      return redirect(`${origin}/access-denied?error=setup_failed`, sessionCookies);
    }
    if (owner || (memberships?.length ?? 0) > 1) return redirect(`${origin}/societies`, sessionCookies);

    const membership = memberships?.[0] as unknown as { role: unknown; societies: { slug: string } | null } | undefined;
    if (!membership?.societies?.slug || !isAppRole(membership.role)) {
      return redirect(`${origin}/access-denied`, sessionCookies);
    }
    return redirect(`${origin}/s/${membership.societies.slug}${roleHome(membership.role)}`, sessionCookies);
  } catch (err) {
    console.error('[auth/callback] uncaught error:', err);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(String(err))}`);
  }
}
