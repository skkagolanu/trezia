import { createServerClient } from '@supabase/ssr';
import { createClient as createRawClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { Database } from '@/types/database';
import { createDemoClient } from './mock-client';
import { isDemoSession } from '@/lib/demo/session.server';

type CookieItem = { name: string; value: string; options?: Record<string, unknown> };

// @supabase/ssr@0.12.0 and @supabase/supabase-js@2.110.x expose different
// generic factory signatures. Returning SupabaseClient<Database> keeps the
// schema default inferred by supabase-js instead of leaking the wrapper's
// positional generic mismatch through every caller.
export async function createClient(): Promise<SupabaseClient<Database>> {
  // Demo mode never constructs a real client at all — not "construct then
  // wrap." createDemoClient() never touches the URL/key env vars, so an
  // unmocked property (`.auth`, `.storage`, `.rpc`) can't fall through to a
  // live call. Gated per-browser by a cookie, not a deployment env var.
  if (await isDemoSession()) return createDemoClient<SupabaseClient<Database>>();

  const cookieStore = await cookies();
  const societySlug = (await headers()).get('x-society-slug');

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieItem[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            );
          } catch {
            // Server Component — cookies set by middleware
          }
        },
      },
      global: societySlug ? { headers: { 'x-society-slug': societySlug } } : undefined,
    }
  ) as unknown as SupabaseClient<Database>;
}

export async function createServiceClient(): Promise<SupabaseClient<Database>> {
  if (await isDemoSession()) return createDemoClient<SupabaseClient<Database>>();

  return createRawClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
}
