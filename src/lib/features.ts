// Once migrations 044-046 are applied, membership RLS is the only data path —
// every table policy requires the x-society-slug header this flag's rewrite
// produces. Flag-off against a migrated database silently returns zero rows
// everywhere rather than erroring, so a single loud log line (once per
// server instance, not per request) is the only signal an operator gets in
// Vercel logs if the flag is ever missing in production.
let warnedRoutingDisabledInProduction = false;

export function multiSocietyRoutingEnabled(): boolean {
  const enabled = process.env.MULTI_SOCIETY_ROUTING_ENABLED === 'true';
  if (!enabled && process.env.VERCEL_ENV === 'production' && !warnedRoutingDisabledInProduction) {
    warnedRoutingDisabledInProduction = true;
    console.error(
      '[features] MULTI_SOCIETY_ROUTING_ENABLED is not "true" in production. ' +
      'If migrations 044-046 are applied, every request is denied by RLS (no x-society-slug header is sent). ' +
      'Set this env var in Vercel and redeploy.'
    );
  }
  return enabled;
}

export function platformCreationEnabled(): boolean {
  return process.env.PLATFORM_CREATION_ENABLED === 'true';
}
