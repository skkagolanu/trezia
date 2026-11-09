import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/061_audit_remediation.sql'), 'utf8');

describe('audit remediation migration', () => {
  it('locks and validates every bill before claim, gateway, or manual settlement', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.assert_payable_bills');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('DUPLICATE_OR_EMPTY_BILL_IDS');
    expect(sql).toContain('PAYMENT_AMOUNT_MISMATCH');
    expect(sql).toContain("b.status IN ('ISSUED', 'OVERDUE')");
    expect(sql).toContain('AND b.society_id = p_society_id AND b.unit_id = p_unit_id');
    expect(sql).toContain('AND b.society_id=v_payment.society_id AND b.unit_id=v_payment.unit_id FOR UPDATE');
  });

  it('requires verified gateway facts and records conflicts without settlement', () => {
    expect(sql).toContain('p_amount_subunits bigint, p_currency text, p_status text');
    expect(sql).toContain('reconciliation_required=true');
    expect(sql).toContain("'{}'::uuid[]");
    expect(sql).toContain("status='paid'");
    expect(sql).toContain("RAISE EXCEPTION 'GATEWAY_PAYMENT_CONFLICT'");
    expect(sql).toContain('Webhook facts conflict with payment link');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.confirm_resident_payment(uuid, text, text)');
  });

  it('preserves payment-to-bill integrity across voids, manual records, and bank matching', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.void_payment_transactional');
    expect(sql).toContain('p.id<>v_payment.id AND p.is_voided=false');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.record_manual_payment');
    expect(sql).toContain("coalesce((p_payload->>'amount_paid')::numeric,(p_payload->>'amount')::numeric)");
    expect(sql).toContain("IF cardinality(v_bill_ids) > 0 THEN PERFORM public.assert_payable_bills");
    expect(sql).toContain('bank_statement_lines_active_target_key');
    expect(sql).toContain('BANK_MATCH_TARGET_INVALID');
    expect(sql).toContain("IF p_action = 'ignore' THEN");
    expect(sql).toContain('BANK_LINE_NOT_IGNORABLE');
    expect(sql).toContain("IF p_action = 'unmatch' THEN");
    expect(sql).toContain("IF v_line.id IS NULL OR v_society_id IS DISTINCT FROM p_society_id THEN RAISE EXCEPTION 'BANK_LINE_NOT_FOUND'; END IF;");
    expect(sql).not.toContain('v_line.id IS NULL OR NOT FOUND OR');
  });

  it('keeps ownership and financial RPC execution service-only', () => {
    expect(sql).toContain('PUSH_SUBSCRIPTION_OWNER_IMMUTABLE');
    expect(sql).toContain('WHERE public.push_subscriptions.user_id=EXCLUDED.user_id');
    expect(sql).toContain('public.list_resident_attachments(text,uuid,integer,integer)');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO service_role');
  });
});
