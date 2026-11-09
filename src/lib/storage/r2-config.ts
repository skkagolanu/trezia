export type R2Jurisdiction = 'eu' | 'fedramp' | 'us';

const R2_JURISDICTIONS = new Set<R2Jurisdiction>(['eu', 'fedramp', 'us']);

export function r2Endpoint(
  environment: { R2_ACCOUNT_ID?: string; R2_JURISDICTION?: string } = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_JURISDICTION: process.env.R2_JURISDICTION,
  },
): string {
  const accountId = environment.R2_ACCOUNT_ID?.trim().toLowerCase();
  if (!accountId || !/^[a-z0-9]+$/.test(accountId)) {
    throw new Error('R2_ACCOUNT_ID is not configured correctly');
  }

  const rawJurisdiction = environment.R2_JURISDICTION?.trim().toLowerCase();
  if (rawJurisdiction && !R2_JURISDICTIONS.has(rawJurisdiction as R2Jurisdiction)) {
    throw new Error('R2_JURISDICTION must be eu, fedramp, or us');
  }

  const jurisdiction = rawJurisdiction ? `.${rawJurisdiction}` : '';
  return `https://${accountId}${jurisdiction}.r2.cloudflarestorage.com`;
}

export function r2JurisdictionEndpoint(
  accountId: string | undefined,
  jurisdiction: string | undefined,
  variableName: 'R2_LEGACY_JURISDICTION' | 'R2_PRIVATE_JURISDICTION',
): string {
  try {
    return r2Endpoint({ R2_ACCOUNT_ID: accountId, R2_JURISDICTION: jurisdiction });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('R2_JURISDICTION')) {
      throw new Error(`${variableName} must be eu, fedramp, or us`);
    }
    throw error;
  }
}
