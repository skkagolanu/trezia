#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });

const status = () => run('npx', ['supabase', 'status', '-o', 'env']);

let result = status();
if (result.status !== 0) {
  process.stdout.write('Local Supabase stack is not running — starting it (first run pulls images)...\n');
  const started = run('npx', ['supabase', 'start'], { stdio: 'inherit' });
  if (started.status !== 0) {
    process.stderr.write('\nCould not start the local Supabase stack. Is Docker running?\n');
    process.exit(1);
  }
  result = status();
  if (result.status !== 0) {
    process.stderr.write('\nStack started but `supabase status` still failed.\n');
    process.exit(1);
  }
}

const env = {};
for (const line of result.stdout.split('\n')) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (match) env[match[1]] = match[2];
}

const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'];
const missing = required.filter(key => !env[key]);
if (missing.length) {
  process.stderr.write(`\n\`supabase status\` did not report: ${missing.join(', ')}\n`);
  process.exit(1);
}

let hostname = '';
try { hostname = new URL(env.API_URL).hostname; } catch { hostname = ''; }
if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
  process.stderr.write(`\nRefusing to run: ${env.API_URL} is not a local address.\n`);
  process.exit(1);
}

// A warm local stack may predate the newest migration. Reset only after the
// localhost guard above so this gate always tests the full candidate schema
// instead of silently exercising whichever version happened to be running.
const reset = run('npx', ['supabase', 'db', 'reset', '--local'], { stdio: 'inherit' });
if (reset.status !== 0) {
  process.stderr.write('\nCould not reset the disposable local Supabase database.\n');
  process.exit(1);
}

const jest = run('npx', ['jest', '--config', 'jest.rls.config.cjs', '--runInBand'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  },
});
process.exit(jest.status ?? 1);
