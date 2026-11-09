// A single non-sensitive cookie (readable client-side too, hence not
// httpOnly) gates demo mode per-browser on the real production deployment —
// no separate environment, no DEMO_MODE env var to ever set on a live app.
// Just the constant lives here (no imports) so client components — via
// lib/supabase/client.ts — can reference the name without pulling
// next/headers into the browser bundle. The actual cookies() read lives in
export const DEMO_COOKIE = 'trezia_demo';

// The demo tenant's immutable slug. Shared so the demo entry redirect and the
// demo membership stub in require-auth cannot drift apart.
export const DEMO_SOCIETY_SLUG = 'demo-apartments';
