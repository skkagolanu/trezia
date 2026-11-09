import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const root = join(process.cwd(), 'src');
const serviceClientAccess = [
  // Named imports and re-exports, including aliases and multiline clauses.
  /(?:import|export)\s*{[^}]*\bcreateServiceClient\b[^}]*}\s*from\s*['"][^'"]*lib\/supabase\/server['"]/, 
  // Namespace imports/re-exports expose every export, including the service client.
  /(?:import|export)\s*\*[^;\n]*from\s*['"][^'"]*lib\/supabase\/server['"]/, 
  // CommonJS and dynamic imports expose the complete module namespace. This also
  // catches destructuring, property access, and an intermediate re-export.
  /(?:require|import)\s*\(\s*['"][^'"]*lib\/supabase\/server['"]\s*\)/,
];

function usesServiceClientModule(source: string): boolean {
  return serviceClientAccess.some(pattern => pattern.test(source));
}

function sourceFiles(directory: string): string[] {
  // Paths originate only from the fixed repository root and its own directory entries.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

describe('service-role client boundary', () => {
  it('detects aliases, namespace access, require, dynamic import, and re-exports', () => {
    const forbiddenForms = [
      `import { createServiceClient as privileged } from '@/lib/supabase/server'`,
      `import * as supabaseServer from '@/lib/supabase/server'`,
      `const supabaseServer = require('@/lib/supabase/server')`,
      `const supabaseServer = await import('@/lib/supabase/server')`,
      `export { createServiceClient } from '@/lib/supabase/server'`,
      `export * from '@/lib/supabase/server'`,
      `import * as supabaseServer from '../../../lib/supabase/server'`,
    ];

    for (const source of forbiddenForms) expect(usesServiceClientModule(source)).toBe(true);
    expect(usesServiceClientModule(`import { createClient } from '@/lib/supabase/server'`)).toBe(false);
  });

  it('is imported only by reviewed lifecycle and system operations', () => {
    const allowed = new Set([
      'app/api/access-requests/[id]/route.ts',
      'app/api/access-requests/route.ts',
      // durable per-day assistant quota via the service-only consume_agent_quota RPC
      'app/api/agent/route.ts',
      'app/api/cron/gdpr-cleanup/route.ts',
      'app/api/cron/snapshot/route.ts',
      // staged society import — service-only lifecycle RPCs (migration 063)
      'app/api/imports/route.ts',
      'app/api/imports/[id]/validate/route.ts',
      'app/api/imports/[id]/commit/route.ts',
      'app/api/imports/[id]/cancel/route.ts',
      'app/api/invites/[id]/route.ts',
      'app/api/invites/route.ts',
      // service_role-only raise_levy_assessment (migration 067) writes an
      // obligation row for every unit in the society, so it must run behind
      // requireFinancialOperator rather than the caller's own row policies.
      'app/api/levy-assessments/route.ts',
      'app/api/me/societies/route.ts',
      'app/api/notifications/subscribe/route.ts',
      'app/api/bank-statement/[batchId]/lines/[lineId]/route.ts',
      'app/api/payments/route.ts',
      'app/api/payments/claim/route.ts',
      // service_role-only submit_resident_levy_claim (migration 067) — the
      // resident levy-claim sibling of app/api/payments/claim/route.ts.
      'app/api/payments/claim/levy/route.ts',
      'app/api/payments/claim/[id]/approve/route.ts',
      'app/api/payments/claim/[id]/reject/route.ts',
      // Retraction is a resident action, but resident_payment_claims has no
      // client write policy by design — every state change goes through a
      // service-role RPC that re-verifies the caller owns the claim's unit.
      'app/api/payments/claim/[id]/retract/route.ts',
      'app/api/payments/claim/[id]/screenshot/route.ts',
      'app/api/payments/link/route.ts',
      'app/api/platform/snapshots/migrate-legacy/route.ts',
      'app/api/platform/societies/[id]/admins/[inviteId]/route.ts',
      'app/api/platform/societies/[id]/admins/route.ts',
      'app/api/societies/route.ts',
      'app/api/webhooks/razorpay/route.ts',
      'app/auth/callback/route.ts',
      // public redacted lookup (slug only) for the DPDP contact fallback
      'app/privacy/page.tsx',
      // cron-only monthly bill generation — same active-society/service-client
      // pattern as lib/billing/lifecycle.ts, invoked by the billing cron the
      // caller wires up separately.
      'lib/billing/auto-generate.ts',
      'lib/billing/lifecycle.ts',
      'lib/notifications/notify.ts',
      'lib/snapshots/create.ts',
    ]);

    const actual = sourceFiles(root)
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      .filter(path => usesServiceClientModule(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).split(sep).join('/'));

    expect(actual.sort()).toEqual([...allowed].sort());
  });
});
