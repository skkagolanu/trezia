import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/072_automatic_resident_credit.sql'),
  'utf8',
);

describe('automatic resident account credit migration', () => {
  it('uses one tenant/unit lock and deterministic FIFO indexes', () => {
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0))');
    expect(sql).toContain('idx_payments_unapplied_fifo');
    expect(sql).toContain('ORDER BY p.payment_date, p.created_at, p.id');
    expect(sql).toContain('ORDER BY b.bill_period_year, b.bill_period_month, b.id');
  });

  it('keeps directed short payments out of the automatic bucket', () => {
    expect(sql).toContain('auto_apply_credit boolean NOT NULL DEFAULT false');
    expect(sql).toContain('private.classify_undirected_payment_credit');
    expect(sql).toContain("COALESCE(NEW.notes, '') NOT ILIKE '%reconciliation required%'");
    expect(sql).toContain('AND p.auto_apply_credit = true');
  });

  it('records every automatic source-to-bill draw and permits multiple sources per bill', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS public.advance_settlements_one_per_bill');
    expect(sql).toContain('advance_settlements_one_per_payment_bill');
    expect(sql).toContain("'Automatically applied from resident account credit'");
    expect(sql).toContain('array_append(COALESCE(p.bill_ids');
  });

  it('runs at both trust boundaries and reverses through RPCs', () => {
    expect(sql).toContain('AFTER INSERT OR UPDATE OF unapplied_amount, is_voided ON public.payments');
    expect(sql).toContain('AFTER INSERT OR UPDATE OF status, base_amount, previous_due, penalty_amount');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.void_advance_settlement');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.void_payment_transactional');
    expect(sql).toContain('Source payment voided:');
  });

  it('keeps internal allocation functions unavailable to residents and anonymous callers', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION private.apply_unit_payment_credit');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
