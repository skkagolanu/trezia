// Shared between proxy.ts (auth gating) and robots.ts (crawl control) so the
// two never drift — a route added to one list is protected AND kept out of
// search results without having to remember to update both.

export const ADMIN_PREFIXES = [
  '/payments', '/expenses', '/balance-sheet', '/bills',
  '/residents', '/reports', '/export', '/audit', '/settings',
  '/other-income', '/balance-snapshots', '/units', '/levies', '/receipts', '/dashboard',
  '/handovers', '/opening-balances', '/fund-ledger', '/advances', '/bank-reconciliation',
  '/claims',
];

export const RESIDENT_PREFIXES = ['/my-flat', '/community', '/summary'];

export const SHARED_PREFIXES = ['/notices', '/operations'];

export const PLATFORM_PREFIXES = ['/societies'];

export const PROTECTED_PREFIXES = [
  ...ADMIN_PREFIXES,
  ...RESIDENT_PREFIXES,
  ...SHARED_PREFIXES,
  ...PLATFORM_PREFIXES,
];
