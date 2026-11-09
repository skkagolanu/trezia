import { createBrowserClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createDemoClient } from './mock-client';
import { DEMO_COOKIE } from '@/lib/demo/session';

// next/headers' cookies() is server-only — client components read the same
// cookie via document.cookie instead. Not httpOnly on purpose, for exactly
// this reason: it carries no sensitive data, just a boolean demo flag.
export function isDemoSessionClient(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').includes(`${DEMO_COOKIE}=1`);
}

export function createClient(): SupabaseClient<Database> {
  // Never constructs a real browser client in demo mode, so the real anon
  // key is never read even though it's technically public.
  if (isDemoSessionClient()) return createDemoClient<SupabaseClient<Database>>();

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init = {}) => {
          const parts = typeof window === 'undefined' ? [] : window.location.pathname.split('/').filter(Boolean);
          const requestHeaders = new Headers(init.headers);
          if (parts[0] === 's' && parts[1]) requestHeaders.set('x-society-slug', parts[1]);
          return fetch(input, { ...init, headers: requestHeaders });
        },
      },
    },
  ) as unknown as SupabaseClient<Database>;
}
