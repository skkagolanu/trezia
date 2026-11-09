export type ApiRequestClass =
  | { kind: 'public' }
  | { kind: 'control-plane' }
  | { kind: 'scoped-operational'; slug: string; logicalPath: string }
  | { kind: 'legacy-operational' }
  | { kind: 'not-api' };

export function classifyApiRequest(method: string, pathname: string): ApiRequestClass {
  if (!pathname.startsWith('/api/')) return { kind: 'not-api' };

  const parts = pathname.split('/').filter(Boolean);
  if (parts[1] === 's' && parts[2] && parts.length > 3) {
    return {
      kind: 'scoped-operational',
      slug: parts[2],
      logicalPath: `/api/${parts.slice(3).join('/')}`,
    };
  }

  if (
    pathname.startsWith('/api/demo/')
    || pathname.startsWith('/api/cron/')
    || (method === 'GET' && pathname === '/api/societies')
    || (method === 'POST' && pathname === '/api/access-requests')
  ) return { kind: 'public' };

  if (pathname === '/api/me/societies' || pathname.startsWith('/api/platform/')) {
    return { kind: 'control-plane' };
  }

  return { kind: 'legacy-operational' };
}

export function parseScopedPage(pathname: string): { slug: string; logicalPath: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 's' || !parts[1]) return null;
  return {
    slug: parts[1],
    logicalPath: parts.length > 2 ? `/${parts.slice(2).join('/')}` : '/payments',
  };
}

// The proxy's compatibility bridge sends an unscoped bookmark (e.g. /my-flat)
// to the caller's scoped equivalent (e.g. /s/oak/my-flat). `destination` is a
// roleHome() result: either a control path (/societies, /access-denied) or a
// scoped home (/s/{slug}{home}) — never a bare legacy path while routing is
// enabled, since roleHome's multi-society branch always prefixes with /s/.
// Only a /s/-prefixed destination carries a slug to splice with `pathname`;
// anything else (control paths, or a bare path if this is ever called with
// routing disabled) is returned unchanged rather than guessing a slug —
// guessing produced /s/undefined/... in production.
export function resolveBridgeRedirect(destination: string, pathname: string): string {
  if (!destination.startsWith('/s/')) return destination;
  const slug = destination.split('/')[2];
  return `/s/${slug}${pathname}`;
}
