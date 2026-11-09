import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/052_transactional_bank_statement_import.sql'),
  'utf8',
);

describe('transactional bank statement import migration', () => {
  it('creates one security-definer function for the batch and every line', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.create_bank_statement_batch');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = \'\'');
    expect(sql).toContain('INSERT INTO public.bank_statement_batches');
    expect(sql).toContain('INSERT INTO public.bank_statement_lines');
    expect(sql).toContain('jsonb_array_elements(p_lines)');
  });

  it('derives identity and count inside the transaction', () => {
    expect(sql).toContain('jsonb_array_length(p_lines)');
    expect(sql).toContain('(SELECT auth.uid())');
    expect(sql).not.toMatch(/uploaded_by\s*\n?\s*\)\s*VALUES[\s\S]*p_uploaded_by/);
  });

  it('requires an active request-scoped finance membership and nonempty array', () => {
    expect(sql).toContain('private.auth_society_finance(p_society_id) IS DISTINCT FROM TRUE');
    expect(sql).toContain("jsonb_typeof(p_lines) <> 'array'");
    expect(sql).toContain('jsonb_array_length(p_lines) = 0');
  });

  it('bounds direct RPC payloads before either table insert', () => {
    const validationStart = sql.indexOf('IF p_filename IS NOT NULL');
    const batchInsert = sql.indexOf('INSERT INTO public.bank_statement_batches');

    expect(validationStart).toBeGreaterThan(0);
    expect(validationStart).toBeLessThan(batchInsert);
    expect(sql).toContain('char_length(p_filename) > 255');
    expect(sql).toContain('p_statement_from > p_statement_to');
    expect(sql).toContain("p_statement_from < DATE '1900-01-01'");
    expect(sql).toContain("p_statement_to > (current_date + INTERVAL '1 year')::date");
    expect(sql).toContain('jsonb_array_length(p_lines) > 20000');
    expect(sql).toContain('pg_column_size(p_lines) > 4000000');
  });

  it('validates every line and raises one stable input error', () => {
    expect(sql).toContain("jsonb_typeof(v_line) IS DISTINCT FROM 'object'");
    expect(sql).toContain("jsonb_typeof(v_line -> 'line_date') IS DISTINCT FROM 'string'");
    expect(sql).toContain("(v_line ->> 'line_date')::date < p_statement_from");
    expect(sql).toContain("(v_line ->> 'line_date')::date > p_statement_to");
    expect(sql).toContain("jsonb_typeof(v_line -> 'description') IS DISTINCT FROM 'string'");
    expect(sql).toContain("char_length(btrim(v_line ->> 'description')) = 0");
    expect(sql).toContain("char_length(v_line ->> 'description') > 500");
    expect(sql).toContain("jsonb_typeof(v_line -> 'amount') IS DISTINCT FROM 'number'");
    expect(sql).toContain("(v_line ->> 'amount')::numeric = 0");
    expect(sql).toContain("abs((v_line ->> 'amount')::numeric) > 9999999999.99");
    expect(sql).toContain("RAISE EXCEPTION 'INVALID_BANK_STATEMENT_IMPORT'");
  });

  it('exposes execution only to authenticated callers and reloads PostgREST', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated;/);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
