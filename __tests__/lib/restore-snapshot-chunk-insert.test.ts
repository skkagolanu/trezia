/** Exercise the ESM restore planner and parameterized inserts through a Node subprocess. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('chunkInsert (scripts/restore-snapshot.mjs)', () => {
  it('builds insert SQL and restore plans without a database connection', () => {
    const scriptUrl = pathToFileURL(join(process.cwd(), 'scripts', 'restore-snapshot.mjs')).href;
    const dir = mkdtempSync(join(tmpdir(), 'chunk-insert-test-'));
    const harnessPath = join(dir, 'harness.mjs');

    const harness = `
      import { buildPlan, chunkInsert } from ${JSON.stringify(scriptUrl)};

      const calls = [];
      const fakeClient = {
        query: async (sql, params) => {
          calls.push({ sql, params });
          return { rowCount: 0 };
        },
      };

      // Composite conflict target — the new capability under test.
      await chunkInsert(
        fakeClient,
        'public."usage_counters"',
        ['counter_type', 'scope_id', 'period_date', 'count'],
        [
          ['DAILY', 'soc-1', '2026-01-01', 3],
          ['DAILY', 'soc-2', '2026-01-01', 5],
        ],
        ['counter_type', 'scope_id', 'period_date'],
      );

      // Single conflict column — every existing caller's shape, must be unchanged.
      await chunkInsert(
        fakeClient,
        'public."payments"',
        ['id', 'amount'],
        [['pay-1', 100]],
        'id',
      );

      // No conflict target at all — tables with no id (bank_statement_lines, etc.).
      await chunkInsert(
        fakeClient,
        'public."bank_statement_lines"',
        ['batch_id', 'amount'],
        [['batch-1', 42]],
        null,
      );

      const schema = new Map([
        ['payments', {
          columns: new Map([['id', 'uuid'], ['metadata', 'jsonb']]),
          generated: new Set(['payable_amount']),
        }],
      ]);
      const snapshot = {
        payments: [{
          id: 'pay-1',
          metadata: ['first', { nested: true }],
          payable_amount: 100,
          removed_column: 'legacy',
        }],
        society: { id: 'soc-1' },
      };
      const paymentPlan = buildPlan('payments', snapshot, schema);
      const missingPlan = buildPlan('societies', snapshot, schema);
      const emptyPlan = buildPlan('payments', {}, schema);

      process.stdout.write(JSON.stringify({ calls, paymentPlan, missingPlan, emptyPlan }));
    `;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- harnessPath is built from mkdtempSync's own return value, not external input.
    writeFileSync(harnessPath, harness, 'utf8');

    try {
      const result = spawnSync(process.execPath, [harnessPath], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      // Surface the failure loudly if the harness itself threw or the module
      // export was missing (e.g. a regression in the isMainModule guard).
      if (result.status !== 0) throw new Error(`harness failed: ${result.stderr}`);

      const output = JSON.parse(result.stdout) as {
        calls: Array<{ sql: string; params: unknown[] }>;
        paymentPlan: { missing: boolean; columns: string[]; dropped: string[]; values: unknown[][] };
        missingPlan: { table: string; missing: boolean; rowsInSnapshot: number; dropped: string[] };
        emptyPlan: { missing: boolean; rowsInSnapshot: number; columns: string[]; values: unknown[][] };
      };
      const { calls } = output;
      expect(calls).toHaveLength(3);

      const [composite, single, none] = calls;

      expect(composite.sql).toContain('ON CONFLICT ("counter_type", "scope_id", "period_date") DO NOTHING');
      expect(composite.params).toEqual(['DAILY', 'soc-1', '2026-01-01', 3, 'DAILY', 'soc-2', '2026-01-01', 5]);
      // Every value must arrive only through $n placeholders, never as SQL text.
      expect(composite.sql).not.toContain("'DAILY'");
      expect(composite.sql).not.toContain('soc-1');
      expect(composite.sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4\), \(\$5, \$6, \$7, \$8\)/);

      expect(single.sql).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(single.params).toEqual(['pay-1', 100]);
      expect(single.sql).not.toContain("'pay-1'");

      expect(none.sql).not.toContain('ON CONFLICT');
      expect(none.params).toEqual(['batch-1', 42]);

      // The planner reports a target table that does not exist instead of
      // discarding its snapshot row, and keeps an empty target plan usable.
      expect(output.missingPlan).toEqual({ table: 'societies', missing: true, rowsInSnapshot: 1, dropped: [] });
      expect(output.emptyPlan).toMatchObject({ missing: false, rowsInSnapshot: 0, columns: [], values: [] });

      // Generated and drifted columns never reach an INSERT, while a JS array
      // for jsonb is encoded as JSON rather than PostgreSQL's array literal.
      expect(output.paymentPlan.missing).toBe(false);
      expect(output.paymentPlan.columns).toEqual(['id', 'metadata']);
      expect(output.paymentPlan.dropped).toEqual(expect.arrayContaining(['payable_amount', 'removed_column']));
      expect(output.paymentPlan.values).toEqual([['pay-1', '["first",{"nested":true}]']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
