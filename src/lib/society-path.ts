export function societyPath(slug: string | null | undefined, path: string): string {
  if (!slug || !path.startsWith('/') || path.startsWith('/s/')) return path;
  return `/s/${encodeURIComponent(slug)}${path}`;
}

export function currentSocietySlug(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function societyApiPath(pathname: string, apiPath: string): string {
  const slug = currentSocietySlug(pathname);
  if (!slug || !apiPath.startsWith('/api/') || apiPath.startsWith('/api/s/')) return apiPath;
  return `/api/s/${encodeURIComponent(slug)}${apiPath.slice(4)}`;
}

export function societyFetch(apiPath: string, init?: RequestInit): Promise<Response> {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  return fetch(societyApiPath(pathname, apiPath), init);
}
