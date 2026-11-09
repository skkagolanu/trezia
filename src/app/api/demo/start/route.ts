import { NextResponse } from 'next/server';
import { DEMO_COOKIE, DEMO_SOCIETY_SLUG } from '@/lib/demo/session';
import { multiSocietyRoutingEnabled } from '@/lib/features';

// Entering demo mode is just a link — nothing to configure, no separate
// deployment, works the same on this exact production URL for anyone.
export async function GET(request: Request) {
  // With routing on, an unscoped landing carries no x-society-slug header, so the
  // app layout downgrades the demo admin to a capability-less role. Land the demo
  const home = multiSocietyRoutingEnabled() ? `/s/${DEMO_SOCIETY_SLUG}/payments` : '/payments';
  const response = NextResponse.redirect(new URL(home, request.url));
  response.cookies.set(DEMO_COOKIE, '1', {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 4, // 4 hours — a demo browsing session, not a standing state
  });
  return response;
}
