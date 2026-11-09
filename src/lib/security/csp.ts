export function contentSecurityPolicy(isDevelopment: boolean, demoMode = false): string {
  return [
    "default-src 'self'",
    demoMode
      ? "connect-src 'self'"
      : "connect-src 'self' https://*.supabase.co https://*.sentry.io",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "worker-src 'self'",
  ].join('; ');
}
