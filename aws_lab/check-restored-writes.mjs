// Prove replayed audit IDs do not prevent subsequent financial writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const dbUrl = process.env.DATABASE_URL;
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(dbUrl).hostname)) {
  throw new Error('Write probe only supports disposable localhost databases');
}
const expected = JSON.parse(readFileSync(process.env.REHEARSAL_DIR + '/expected.json', 'utf8'));
const db = new Client({ connectionString: dbUrl });
await db.connect();
let report;
try {
  await db.query('BEGIN');
  const before = await db.query('SELECT count(*)::text AS count, max(id)::text AS maximum FROM public.audit_log');
  await db.query(`INSERT INTO public.expenditures (society_id, expense_date, category, description, amount)
    VALUES ($1, current_date, 'MISC', 'Synthetic recovery write probe - rolled back', 1.00)`, [expected.societyId]);
  const after = await db.query('SELECT count(*)::text AS count, max(id)::text AS maximum FROM public.audit_log');
  if (BigInt(after.rows[0].count) <= BigInt(before.rows[0].count)
      || BigInt(after.rows[0].maximum) <= BigInt(before.rows[0].maximum)) {
    throw new Error('A restored financial write did not create a fresh audit identity');
  }
  await db.query('ROLLBACK');
  report = { financial_write_succeeded: true, fresh_audit_identity_created: true,
    rolled_back: true, before: before.rows[0], during_probe: after.rows[0] };
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
writeFileSync(process.env.REHEARSAL_DIR + '/post-restore-write-check.json', JSON.stringify(report, null, 2));
console.log('Post-restore financial write and fresh audit identity verified; probe rolled back');
