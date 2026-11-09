#!/usr/bin/env node
// Disaster-recovery drill. Proves a stored snapshot can actually rebuild the
// books, which writing snapshots daily does NOT prove on its own.
//
// The drill is deliberately end-to-end and destructive to the LOCAL disposable
// database: seed -> snapshot -> wipe -> restore -> snapshot -> compare. The
// comparison is `snapshotContentHash`, which covers every row of every table and
// ignores only the volatile `exported_at`, so equality means the restore was
// lossless — including that the audit-log and payment-hash triggers did not
// fabricate or rewrite rows on the way in.
//
// The wipe between phases is a real `supabase db reset`, because "restore into a
// freshly migrated empty database" is the only scenario that matters in a real
// recovery. Nothing here ever touches a hosted project: the connection details
// always come from `supabase status` on this machine, behind a localhost guard.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });

function fail(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function step(label) {
  process.stdout.write(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}\n`);
}

step('1/6  Reading local Supabase connection details');

let status = run('npx', ['supabase', 'status', '-o', 'env']);
if (status.status !== 0) {
  process.stdout.write('Local stack is not running — starting it...\n');
  if (run('npx', ['supabase', 'start'], { stdio: 'inherit' }).status !== 0) {
    fail('Could not start the local Supabase stack. Is Docker running?');
  }
  status = run('npx', ['supabase', 'status', '-o', 'env']);
  if (status.status !== 0) fail('Stack started but `supabase status` still failed.');
}

const env = {};
for (const line of status.stdout.split('\n')) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (match) env[match[1]] = match[2];
}

const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL'];
const missing = required.filter(key => !env[key]);
if (missing.length) fail(`\`supabase status\` did not report: ${missing.join(', ')}`);

// Same guard as scripts/rls-local.mjs: this drill wipes its target, so it must
// never be able to reach a hosted project even by misconfiguration.
for (const [label, value] of [['API_URL', env.API_URL], ['DB_URL', env.DB_URL]]) {
  let hostname = '';
  try { hostname = new URL(value).hostname; } catch { hostname = ''; }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    fail(`Refusing to run: ${label} host "${hostname}" is not a local address. This drill wipes its target.`);
  }
}
process.stdout.write(`Target: ${env.DB_URL}\n`);

const rehearsalDir = process.env.REHEARSAL_DIR ?? join(tmpdir(), 'trezia-restore-drill');
rmSync(rehearsalDir, { recursive: true, force: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- drill-owned scratch directory, never caller input
mkdirSync(rehearsalDir, { recursive: true });
process.stdout.write(`Artifacts: ${rehearsalDir}\n`);

const jestEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  REHEARSAL_DIR: rehearsalDir,
};

// Jest exits 0 when a name filter matches nothing, so a typo'd filter would make
// this drill report success having verified nothing at all. Every phase therefore
// asserts on the machine-readable result that tests actually ran and passed.
const jest = (nameFilter, phase) => {
  const resultFile = join(rehearsalDir, `jest-${phase}.json`);
  // Invoked through node directly with shell:false. Under shell:true Windows
  // concatenates argv without quoting, which silently split a multi-word -t
  // filter into a separate path pattern and matched nothing.
  spawnSync(process.execPath, [
    join('node_modules', 'jest', 'bin', 'jest.js'),
    '--config', 'jest.restore.config.cjs', '--runInBand',
    '-t', nameFilter, '--json', '--outputFile', resultFile,
  ], { stdio: 'inherit', env: jestEnv, encoding: 'utf8' });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- drill-owned scratch directory
  if (!existsSync(resultFile)) fail(`${phase} phase produced no Jest result file.`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from the drill's own scratch directory
  const summary = JSON.parse(readFileSync(resultFile, 'utf8'));
  const { numPassedTests = 0, numFailedTests = 0, numTotalTests = 0 } = summary;
  process.stdout.write(`${phase}: ${numPassedTests} passed, ${numFailedTests} failed, ${numTotalTests} matched\n`);
  if (numFailedTests > 0) fail(`${phase} phase failed.`);
  if (numPassedTests === 0) {
    fail(`${phase} phase ran ZERO tests — the "-t ${nameFilter}" filter matched nothing. Nothing was proven.`);
  }
};

const reset = label => {
  step(label);
  if (run('npx', ['supabase', 'db', 'reset', '--local'], { stdio: 'inherit' }).status !== 0) {
    fail('Could not reset the disposable local database.');
  }
};

reset('2/6  Resetting to a freshly migrated database');

step('3/6  Seeding a society and capturing a snapshot');
jest('captures', 'capture');

const snapshotPath = join(rehearsalDir, 'snapshot.json.gz');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- drill-owned scratch directory
if (!existsSync(snapshotPath)) fail(`Capture phase did not write ${snapshotPath}.`);

reset('4/6  Wiping — this is the simulated disaster');

step('5/6  Restoring the snapshot into the empty database');
const restore = run('node', [
  'scripts/restore-snapshot.mjs', snapshotPath,
  '--database-url', env.DB_URL,
  '--execute',
], { stdio: 'inherit' });
if (restore.status !== 0) fail('Restore failed. The snapshot could not rebuild the books.');

step('6/6  Verifying the restored database reproduces the original snapshot');
jest('verifies', 'verify');

process.stdout.write(`\n${'='.repeat(72)}\nDRILL PASSED\n${'='.repeat(72)}\n`);
process.stdout.write('A snapshot was restored into an empty migrated database and reproduced a\n');
process.stdout.write('byte-identical content hash. Recovery from a stored snapshot is proven.\n');
