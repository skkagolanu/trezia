#!/usr/bin/env node
// Replays an R2 backup snapshot (buildBackupSnapshot -> serializeSnapshot,
// see src/lib/snapshots/create.ts and serialize.ts) into a freshly migrated
// Postgres database. Snapshots have only ever been written, never read back —
// this is the first restore path this app has had. Operator recovery tool,
// not part of the running app.
//
//   node scripts/restore-snapshot.mjs <snapshot.json.gz|snapshot.json> --database-url <url> [--execute] [--allow-remote]
//
// Dry run (no --execute) is the default: it connects only to read
// information_schema and check which ids already exist, reports exactly what
// it would do, and writes nothing.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// ── CLI args ─────────────────────────────────────────────────────────────
//
// Everything in this section is gated on isMainModule so that importing this
// file (e.g. __tests__ exercising chunkInsert's SQL generation directly, see
// that test's own comment for why it needs a real `node` subprocess rather
// than Jest's module registry) never parses argv, validates a database URL,
// or calls process.exit — it only gets the plain function/const exports.
const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

let snapshotPath;
let databaseUrl;
let execute = false;
let allowRemote = false;
let targetHost = '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

if (isMainModule) {
  const argv = process.argv.slice(2);
  execute = argv.includes('--execute');
  allowRemote = argv.includes('--allow-remote');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--database-url') { databaseUrl = argv[++i]; continue; }
    if (arg === '--execute' || arg === '--allow-remote') continue;
    if (!snapshotPath && !arg.startsWith('--')) snapshotPath = arg;
  }
  databaseUrl = databaseUrl ?? process.env.DATABASE_URL;

  if (!snapshotPath || !databaseUrl) {
    console.error('Usage: node scripts/restore-snapshot.mjs <snapshot.json.gz|snapshot.json> --database-url <url> [--execute] [--allow-remote]');
    console.error('(--database-url may also come from the DATABASE_URL env var)');
    process.exit(1);
  }

  // Mirrors the localhost guard in scripts/rls-local.mjs: this tool disables
  // triggers and writes financial rows directly, so an accidental run against a
  // hosted project would be far more damaging than the RLS suite ever could be.
  try { targetHost = new URL(databaseUrl).hostname; } catch { targetHost = ''; }
  if (!allowRemote && !LOCAL_HOSTS.has(targetHost)) {
    console.error(`\nRefusing to run: "${targetHost || databaseUrl}" is not a local address.`);
    console.error('Pass --allow-remote if you really intend to restore into a remote database.\n');
    process.exit(1);
  }
}

// ── Snapshot loading ─────────────────────────────────────────────────────

function readSnapshot(path) {
  // path is an operator-supplied CLI argument, not remote/attacker input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = readFileSync(path);
  const json = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(json);
}

// Snapshot key -> table name is identity except the single-object `society`
// key, which lands in the `societies` table (see buildBackupSnapshot).
const TABLE_ORDER = [
  // levy_assessments after units (its unit_id FK) and levy_configs (conceptual
  // parent), before amc_collections which settles against it.
  'societies', 'society_config', 'units', 'residents', 'levy_configs', 'levy_assessments', 'bills',
  'payments', 'expenditures', 'amc_collections', 'other_income', 'balance_snapshots',
  'treasurer_handovers', 'opening_balances', 'fund_ledger_entries', 'advance_settlements',
  'bank_statement_batches', 'bank_statement_lines', 'society_notices', 'society_documents',
  'vendors', 'vendor_contracts', 'assets', 'asset_service_records', 'operational_expense_links',
  'society_attachments', 'society_memberships', 'resident_invites', 'access_requests',
  'fy_treasurers', 'resident_payment_links', 'resident_payment_claims',
  // Import provenance. Batches before records — records carry a NOT NULL
  // batch_id FK, and restore keeps foreign keys enforced (triggers are disabled,
  // constraints are not), so the parent must land first.
  'society_import_batches', 'society_import_records',
  'audit_log',
];

function snapshotKeyForTable(table) {
  return table === 'societies' ? 'society' : table;
}

// `society` / `society_config` are exported as single objects, not arrays.
export function rowsForTable(snapshot, table) {
  const value = snapshot[snapshotKeyForTable(table)];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}


async function loadSchema(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type, is_generated
     FROM information_schema.columns
     WHERE table_schema = 'public'`
  );
  const tables = new Map();
  for (const row of rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = { columns: new Map(), generated: new Set() };
      tables.set(row.table_name, table);
    }
    table.columns.set(row.column_name, row.data_type);
    if (row.is_generated === 'ALWAYS') table.generated.add(row.column_name);
  }
  return tables;
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

// pg already serializes plain JS objects to JSON and real JS arrays to
// Postgres array literals (see prepareValue/prepareObject in pg/lib/utils.js) —
// correct for jsonb *objects* (audit_log.old_data/new_data) and for real
// array columns (payments.bill_ids uuid[]) without any help from us. The one
// case pg gets wrong on its own is a JS array destined for a json/jsonb
// column (would be sent as a Postgres array literal, not a JSON array) — a
// column shape this snapshot doesn't currently have, but schema discovery is
// dynamic specifically so a future one doesn't silently corrupt on restore.
export function prepareValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if ((dataType === 'json' || dataType === 'jsonb') && Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

// Drops columns that aren't real, non-generated columns on this table
// (schema drift tolerance + bills' 4 GENERATED columns) and reports what was
// dropped so a silent truncation is never actually silent.
export function buildPlan(table, snapshot, schema) {
  const rowsInSnapshot = rowsForTable(snapshot, table);
  const meta = schema.get(table);
  if (!meta) {
    return { table, missing: true, rowsInSnapshot: rowsInSnapshot.length, dropped: [] };
  }

  const dropped = new Set();
  const columnSet = new Set();
  for (const row of rowsInSnapshot) {
    for (const key of Object.keys(row)) {
      if (meta.generated.has(key)) { dropped.add(key); continue; }
      if (!meta.columns.has(key)) { dropped.add(key); continue; }
      columnSet.add(key);
    }
  }
  const columns = [...columnSet];
  const values = rowsInSnapshot.map(row => columns.map(col => prepareValue(row[col] ?? null, meta.columns.get(col))));
  const hasId = meta.columns.has('id');
  const idIndex = columns.indexOf('id');

  return {
    table,
    missing: false,
    rowsInSnapshot: rowsInSnapshot.length,
    columns,
    dropped: [...dropped],
    values,
    hasId,
    idIndex,
  };
}

// ── auth.users placeholders ─────────────────────────────────────────────
// A snapshot is society-scoped and never contains auth.users rows, but many
// tables carry NOT NULL FKs into it (society_notices.created_by, the
// migration-055 operating-layer tables, ...) plus nullable ones
// (society_memberships.user_id, resident_invites.invited_by,
// resident_payment_claims.submitted_by). Without a stand-in row those FKs
// reject every insert. `_by`/`user_id` is a naming convention, not a schema
// property, so this is a heuristic scan over the actual restored values —
// deliberately over-inclusive (a stray null-shaped or non-uuid value is just
// skipped) rather than a hardcoded column list that a new table could miss.
const ZERO_INSTANCE_ID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isActorColumn(name) {
  return name === 'user_id' || name.endsWith('_by');
}

function collectActorIds(plans) {
  const ids = new Set();
  for (const plan of plans) {
    if (plan.missing) continue;
    plan.columns.forEach((col, colIndex) => {
      if (!isActorColumn(col)) return;
      for (const row of plan.values) {
        const value = row[colIndex];
        if (typeof value === 'string' && UUID_RE.test(value)) ids.add(value);
      }
    });
  }
  return ids;
}

// ── Parameterised, chunked multi-row insert ─────────────────────────────
// `qualifiedTable` and `columns` are always built from information_schema
// discovery, the hardcoded TABLE_ORDER list, or the fixed auth.users
// placeholder shape below — never from snapshot row content — so
// interpolating them into the SQL text is not a SQL-injection vector; every
// row *value* still goes through $n parameters. `conflictTarget` is the same
// kind of fixed, caller-supplied identifier (a literal string or array of
// literal strings in the calling code, never snapshot data), so accepting an
// array here to express a composite conflict target preserves that property
// exactly — it still only ever contributes quoted identifiers to the SQL
// text, never a value.
const CHUNK_SIZE = 200;

// conflictTarget: undefined/null for no ON CONFLICT clause, a single column
// name (existing callers, unchanged), or an array of column names for a
// composite conflict target (e.g. a table whose primary key has no single
// `id` column, such as usage_counters' (counter_type, scope_id, period_date)).
export async function chunkInsert(client, qualifiedTable, columns, rows, conflictTarget) {
  let inserted = 0;
  const columnList = columns.map(quoteIdent).join(', ');
  const conflictColumns = conflictTarget == null ? [] : Array.isArray(conflictTarget) ? conflictTarget : [conflictTarget];
  const conflictClause = conflictColumns.length > 0
    ? ` ON CONFLICT (${conflictColumns.map(quoteIdent).join(', ')}) DO NOTHING`
    : '';
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    const params = [];
    const tuples = chunk.map((row, rowIndex) => {
      const base = rowIndex * columns.length;
      params.push(...row);
      const placeholders = [];
      for (let colIndex = 0; colIndex < columns.length; colIndex++) placeholders.push(`$${base + colIndex + 1}`);
      return `(${placeholders.join(', ')})`;
    });
    const sql = `INSERT INTO ${qualifiedTable} (${columnList}) VALUES ${tuples.join(', ')}${conflictClause} RETURNING 1`;
    const result = await client.query(sql, params);
    inserted += result.rowCount ?? 0;
  }
  return { inserted, skipped: rows.length - inserted };
}

async function countExistingIds(client, qualifiedTable, ids) {
  if (ids.length === 0) return 0;
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${qualifiedTable} WHERE id = ANY($1)`, [ids]);
  return rows[0].n;
}

// ── Reporting ────────────────────────────────────────────────────────────

function printTable(rows) {
  const header = ['table', 'rows_in_snapshot', 'inserted', 'skipped'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = cells => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const snapshot = readSnapshot(snapshotPath);
  console.log(`Snapshot:     ${snapshotPath}`);
  console.log(`exported_at:  ${snapshot.exported_at ?? '(missing)'}`);
  console.log(`manifest.version: ${snapshot.manifest?.version ?? '(missing)'}`);
  console.log(`Target:       ${targetHost || databaseUrl}`);
  console.log(`Mode:         ${execute ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}\n`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const schema = await loadSchema(client);
    const plans = TABLE_ORDER.map(table => buildPlan(table, snapshot, schema));

    for (const plan of plans) {
      if (plan.missing) console.log(`WARNING: table "${plan.table}" not found in target schema — skipping ${plan.rowsInSnapshot} row(s).`);
      else if (plan.dropped.length > 0) console.log(`NOTE: "${plan.table}" dropping column(s) not present on target (generated or drifted): ${plan.dropped.join(', ')}`);
    }

    const actorIds = [...collectActorIds(plans)];
    const existingAuthCount = actorIds.length > 0 ? await countExistingIds(client, 'auth.users', actorIds) : 0;
    const placeholderCount = actorIds.length - existingAuthCount;

    console.log(`\nauth.users placeholders: ${actorIds.length} distinct actor id(s) referenced, ${existingAuthCount} already present, ${placeholderCount} placeholder row(s) ${execute ? 'to be created' : 'would be created'}.`);
    console.log('IMPORTANT: placeholder auth.users rows are NOT working logins — they exist only to satisfy foreign keys. Restore the real identities from the Auth backup separately.\n');

    if (!execute) {
      const summaryRows = [];
      for (const plan of plans) {
        if (plan.missing) { summaryRows.push([plan.table, plan.rowsInSnapshot, 0, plan.rowsInSnapshot]); continue; }
        if (plan.rowsInSnapshot === 0) { summaryRows.push([plan.table, 0, 0, 0]); continue; }
        if (!plan.hasId) { summaryRows.push([plan.table, plan.rowsInSnapshot, plan.rowsInSnapshot, 0]); continue; }
        const ids = plan.values.map(row => row[plan.idIndex]).filter(id => typeof id === 'string');
        const existing = await countExistingIds(client, `public.${quoteIdent(plan.table)}`, ids);
        summaryRows.push([plan.table, plan.rowsInSnapshot, plan.rowsInSnapshot - existing, existing]);
      }
      printTable(summaryRows);
      const totals = summaryRows.reduce((acc, r) => [acc[0] + r[1], acc[1] + r[2], acc[2] + r[3]], [0, 0, 0]);
      console.log(`\nTOTAL   rows_in_snapshot=${totals[0]}  would_insert=${totals[1]}  would_skip=${totals[2]}`);
      console.log('\nDry run complete. No rows were written. Re-run with --execute to restore.');
      process.exit(0);
    }

    // audit-log and payment-hash/receipt-number triggers, which would
    // otherwise fabricate a duplicate audit history or rewrite restored
    // values, while leaving foreign-key constraint triggers active — so a
    // successful restore still proves the snapshot is internally consistent.
    // enforcement and accept a corrupt snapshot.
    let currentStep = 'auth.users placeholders';
    await client.query('BEGIN');
    try {
      // ON CONFLICT (id) DO NOTHING below makes re-checking existence here
      // unnecessary — every actor id is offered as a placeholder candidate.
      const placeholderRows = actorIds
        .map(id => [id, ZERO_INSTANCE_ID, `restored+${id}@invalid.local`, new Date().toISOString(), new Date().toISOString()]);
      const { inserted: placeholdersCreated } = placeholderRows.length
        ? await chunkInsert(client, 'auth.users', ['id', 'instance_id', 'email', 'created_at', 'updated_at'], placeholderRows, 'id')
        : { inserted: 0 };

      for (const plan of plans) {
        if (plan.missing) continue;
        currentStep = plan.table;
        await client.query(`ALTER TABLE public.${quoteIdent(plan.table)} DISABLE TRIGGER USER`);
      }

      const results = [];
      for (const plan of plans) {
        if (plan.missing) { results.push([plan.table, plan.rowsInSnapshot, 0, plan.rowsInSnapshot]); continue; }
        if (plan.rowsInSnapshot === 0) { results.push([plan.table, 0, 0, 0]); continue; }
        currentStep = plan.table;
        const { inserted, skipped } = await chunkInsert(
          client,
          `public.${quoteIdent(plan.table)}`,
          plan.columns,
          plan.values,
          plan.hasId ? 'id' : null,
        );
        results.push([plan.table, plan.rowsInSnapshot, inserted, skipped]);
      }

      // Replaying explicit bigint audit IDs must not leave nextval behind them.
      // Sequence state is not part of the row snapshot and setval is not rolled
      // back by PostgreSQL; never rewind an already advanced sequence.
      currentStep = 'audit sequence repair';
      await client.query(`DO $$
        DECLARE audit_sequence regclass; maximum_id bigint; sequence_value bigint;
        BEGIN
          SELECT pg_get_serial_sequence('public.audit_log', 'id')::regclass INTO audit_sequence;
          IF audit_sequence IS NULL THEN RAISE EXCEPTION 'Audit identity sequence is absent'; END IF;
          SELECT max(id) INTO maximum_id FROM public.audit_log;
          IF maximum_id IS NOT NULL THEN
            EXECUTE format('SELECT last_value FROM %s', audit_sequence) INTO sequence_value;
            PERFORM setval(audit_sequence, GREATEST(maximum_id, sequence_value), true);
          END IF;
        END $$`);

      for (const plan of plans) {
        if (plan.missing) continue;
        currentStep = plan.table;
        await client.query(`ALTER TABLE public.${quoteIdent(plan.table)} ENABLE TRIGGER USER`);
      }

      currentStep = 'COMMIT';
      await client.query('COMMIT');

      console.log(`Placeholder auth.users rows created: ${placeholdersCreated}\n`);
      printTable(results);
      const totals = results.reduce((acc, r) => [acc[0] + r[1], acc[1] + r[2], acc[2] + r[3]], [0, 0, 0]);
      console.log(`\nTOTAL   rows_in_snapshot=${totals[0]}  inserted=${totals[1]}  skipped=${totals[2]}`);
      console.log('\nRestore committed.');
    } catch (err) {
      console.error(`\nRestore failed on "${currentStep}": ${err.message}`);
      // Best-effort only: ROLLBACK below undoes the DISABLE TRIGGER DDL
      // regardless (it's transactional), this just guards against a
      // pooled/reused connection seeing a half-disabled state in between.
      try {
        for (const plan of plans) {
          if (plan.missing) continue;
          await client.query(`ALTER TABLE public.${quoteIdent(plan.table)} ENABLE TRIGGER USER`);
        }
      } catch { /* ignore — rolling back regardless */ }
      await client.query('ROLLBACK');
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

if (isMainModule) {
  main().catch(err => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  });
}
