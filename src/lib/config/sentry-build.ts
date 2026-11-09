type SentryBuildEnvironment = Partial<Pick<NodeJS.ProcessEnv,
  'NODE_ENV' | 'SENTRY_AUTH_TOKEN' | 'SENTRY_ORG' | 'SENTRY_PROJECT'>>;

const SENTRY_BUILD_KEYS = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const;

export function shouldUploadSentrySourceMaps(environment: SentryBuildEnvironment): boolean {
  if (environment.NODE_ENV !== 'production') return false;

  const configured = SENTRY_BUILD_KEYS.filter(key => Boolean(environment[key]));
  if (configured.length > 0 && configured.length < SENTRY_BUILD_KEYS.length) {
    const missing = SENTRY_BUILD_KEYS.filter(key => !environment[key]);
    throw new Error(`Sentry source-map upload requires the complete credential set; missing ${missing.join(', ')}.`);
  }

  return configured.length === SENTRY_BUILD_KEYS.length;
}
