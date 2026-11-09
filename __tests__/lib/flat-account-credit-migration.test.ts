import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/073_flat_wide_account_credit.sql'),
  'utf8',
);
const orderingSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/074_account_credit_bill_period_order.sql'),
  'utf8',
);

describe('flat-wide account credit migration', () => {
  it('journals exactly one obligation target without duplicating cash', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS levy_assessment_id uuid');
    expect(sql).toContain('CHECK (bill_id IS NULL OR levy_assessment_id IS NULL)');
    expect(sql).toContain('advance_settlements_one_per_payment_levy');
    expect(sql).not.toContain("INSERT INTO public.amc_collections (\n+          unit_id, society_id");
  });

  it('orders bills and levies together and locks the unit before allocation', () => {
    expect(sql).toContain("'BILL'::text AS obligation_kind");
    expect(sql).toContain("'LEVY'::text");
    expect(sql).toContain('ORDER BY obligation_date, obligation_kind, obligation_id');
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(p_unit_id::text, 0))');
    expect(sql).toContain('ORDER BY p.payment_date, p.created_at, p.id');
    expect(orderingSql).toContain('make_date(b.bill_period_year, b.bill_period_month, 1) AS obligation_date');
  });

  it('feeds new gateway receipts into the same account bucket', () => {
    expect(sql).toContain('ALTER TABLE public.resident_payment_links');
    expect(sql).toContain('IF v_link.auto_apply_credit THEN');
    expect(sql).toContain("'Online flat-account payment via Razorpay'");
    expect(sql).toContain('p_razorpay_payment_id, v_link.amount, true');
  });

  it('reverses both target types and repairs levy collection edits and voids', () => {
    expect(sql).toContain('SELECT s.levy_assessment_id, SUM(s.settled_amount)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.update_levy_collection_transactional');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.void_levy_collection_transactional');
    expect(sql).toContain('a.amount_settled - v_collection.amount_paid');
  });

  it('only exposes a resident allocation trail through their membership unit', () => {
    expect(sql).toContain('CREATE POLICY advance_settlements_resident_own_payment');
    expect(sql).toContain('p.unit_id = private.auth_membership_unit(advance_settlements.society_id)');
  });
});
