function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedRequestOrigin(
  origin: string,
  environment: {
    NODE_ENV?: string;
    NEXT_PUBLIC_SITE_URL?: string;
    NEXT_PUBLIC_APP_URL?: string;
    VERCEL_PROJECT_PRODUCTION_URL?: string;
    VERCEL_URL?: string;
  } = process.env,
  developmentHost?: string | null,
): boolean {
  const originHost = hostFromUrl(origin);
  if (!originHost) return false;

  const trustedHosts = new Set([
    hostFromUrl(environment.NEXT_PUBLIC_SITE_URL),
    // NEXT_PUBLIC_APP_URL is the deployment's original canonical-site key.
    // Keep accepting it while NEXT_PUBLIC_SITE_URL becomes the documented name.
    hostFromUrl(environment.NEXT_PUBLIC_APP_URL),
    // Unlike VERCEL_URL (the unique deployment hostname), this is the stable
    // production custom domain and is exactly what a same-origin browser sends.
    hostFromUrl(environment.VERCEL_PROJECT_PRODUCTION_URL),
    hostFromUrl(environment.VERCEL_URL),
  ].filter((host): host is string => host !== null));

  if (environment.NODE_ENV !== 'production') {
    const localHost = developmentHost?.toLowerCase() ?? null;
    if (localHost) trustedHosts.add(localHost);
    trustedHosts.add('localhost:3000');
    trustedHosts.add('127.0.0.1:3000');
  }

  return trustedHosts.has(originHost);
}
