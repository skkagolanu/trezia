/**
 * Live RLS/RPC regression gate for resident payment claims (migration 059) and
 * push subscriptions (migration 060).
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
 * SUPABASE_SERVICE_ROLE_KEY. It never skips: run it only against a freshly
 * migrated disposable database, never production. Financial fixtures cannot be
 * deleted because the production hard-delete triggers intentionally apply to
 * the service role too, so the disposable database itself is the cleanup unit.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = [
  !URL && 'NEXT_PUBLIC_SUPABASE_URL',
  !ANON && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  !SERVICE && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

type AppRole = 'admin' | 'treasurer' | 'resident' | 'committee' | 'auditor';
type TestUser = { client: SupabaseClient; userId: string; email: string; password: string };

const serviceClient = () => createClient(URL!, SERVICE!, { auth: { persistSession: false } });
const runId = crypto.randomUUID().slice(0, 8);
const id = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getUTCFullYear();
const currentMonth = new Date().getUTCMonth() + 1;

function scopedClient(slug: string) {
  return createClient(URL!, ANON!, {
    auth: { persistSession: false },
    global: { headers: { 'x-society-slug': slug } },
  });
}

async function expectSetup<T>(result: { data: T; error: { message: string } | null }, operation: string): Promise<T> {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

async function createUser(
  societyId: string,
  societySlug: string,
  role: AppRole,
  unitId: string | null = null,
): Promise<TestUser> {
  const svc = serviceClient();
  const email = `rls-claims-${role}-${runId}-${id()}@example.test`;
  const password = id();
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`create ${role} auth user: ${createError.message}`);
  if (!created.user) throw new Error(`create ${role} auth user returned no user`);

  await expectSetup(
    await svc.from('profiles').insert({ id: created.user.id, role, society_id: societyId, unit_id: unitId }),
    `create ${role} profile`,
  );
  await expectSetup(
    await svc.from('society_memberships').insert({
      user_id: created.user.id,
      role,
      society_id: societyId,
      unit_id: unitId,
      status: 'active',
    }),
    `create ${role} membership`,
  );

  const client = scopedClient(societySlug);
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign in ${role}: ${signInError.message}`);
  if (!signedIn.session) throw new Error(`sign in ${role} returned no session`);
  return { client, userId: created.user.id, email, password };
}

async function makeBill(
  svc: SupabaseClient,
  societyId: string,
  unitId: string,
  invoiceSuffix: string,
  monthOffset: number,
): Promise<string> {
  const billId = id();
  const month = ((currentMonth - 1 + monthOffset + 12) % 12) + 1;
  const year = currentYear + Math.floor((currentMonth - 1 + monthOffset) / 12);
  await expectSetup(
    await svc.from('bills').insert({
      id: billId,
      society_id: societyId,
      unit_id: unitId,
      bill_period_year: year,
      bill_period_month: month,
      invoice_number: `RLSCLAIM-${runId}-${invoiceSuffix}`,
      invoice_date: today,
      due_date: today,
      base_amount: 1200,
      status: 'ISSUED',
    }),
    `create bill ${invoiceSuffix}`,
  );
  return billId;
}

describe('live resident payment claims RLS and RPC contract', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(
        `RLS integration credentials are required: ${missing.join(', ')}. `
        + 'Use an isolated disposable test database, never production.',
      );
    }
  });

  it('enforces the resident_payment_claims RLS write boundary, submit/approve/reject RPC contract, and push_subscriptions read boundary', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-claims-a-${runId}`;
    const slugB = `rls-claims-b-${runId}`;
    const unitA = id();
    const otherUnitA = id();
    const unitB = id();

    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS Claims A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS Claims B ${runId}`, slug: slugB },
    ]), 'create societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: `${runId}-CA-101`, is_test_unit: false },
      { id: otherUnitA, society_id: societyA, flat_number: `${runId}-CA-102`, is_test_unit: false },
      { id: unitB, society_id: societyB, flat_number: `${runId}-CB-101`, is_test_unit: false },
    ]), 'create units');
    await expectSetup(await svc.from('society_config').insert([
      { id: id(), society_id: societyA, name: `RLS Claims config A ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
      { id: id(), society_id: societyB, name: `RLS Claims config B ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
    ]), 'create society config');

    const residentA = await createUser(societyA, slugA, 'resident', unitA);
    const operatorA = await createUser(societyA, slugA, 'treasurer');
    const residentB = await createUser(societyB, slugB, 'resident', unitB);
    const otherResidentA = await createUser(societyA, slugA, 'resident', otherUnitA);
    const residentRecordA = id();
    const treasurerRecordA = id();
    await expectSetup(await svc.from('residents').insert([
      {
        id: residentRecordA, society_id: societyA, unit_id: unitA,
        full_name: `Resident A ${runId}`, email: residentA.email,
        is_primary: true, is_active: true,
      },
      {
        id: treasurerRecordA, society_id: societyA, unit_id: unitA,
        full_name: `Treasurer A ${runId}`, email: operatorA.email,
        is_primary: false, is_active: true,
      },
    ]), 'create payment-party residents');
    const fyStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;
    await expectSetup(await svc.from('fy_treasurers').insert({
      society_id: societyA, fy_start_year: fyStartYear, resident_id: treasurerRecordA,
    }), 'map payment-party treasurer');

    // 1. RLS write boundary: no client can INSERT/UPDATE/DELETE on resident_payment_claims.
    const forgedClaimId = id();
    const { error: insertDenied } = await residentA.client.from('resident_payment_claims').insert({
      id: forgedClaimId,
      society_id: societyA,
      unit_id: unitA,
      bill_ids: [],
      amount: 100,
      screenshot_object_key: `claims/${societyA}/${forgedClaimId}.jpg`,
    }).select();
    expect(insertDenied).toBeTruthy();

    // UPDATE/DELETE have no policy either, so they match zero rows and change nothing
    // silently (RLS does not error on a zero-row write). Prove the boundary by seeding a
    // real claim the resident CAN see, then confirming their update/delete leave it intact.
    const boundaryBill = await makeBill(svc, societyA, unitA, 'BOUND', 2);
    const boundaryClaimId = id();
    await expectSetup(await svc.from('resident_payment_claims').insert({
      id: boundaryClaimId,
      society_id: societyA,
      unit_id: unitA,
      bill_ids: [boundaryBill],
      amount: 2000,
      screenshot_object_key: `claims/${societyA}/${boundaryClaimId}.jpg`,
      status: 'pending',
    }).select(), 'seed claim for write-boundary');

    await residentA.client.from('resident_payment_claims').update({ status: 'approved' }).eq('id', boundaryClaimId);
    const afterUpdate = await expectSetup(await svc.from('resident_payment_claims')
      .select('status').eq('id', boundaryClaimId).single(), 'reread after resident update');
    expect(afterUpdate?.status).toBe('pending');

    await residentA.client.from('resident_payment_claims').delete().eq('id', boundaryClaimId);
    const { data: afterDelete } = await svc.from('resident_payment_claims')
      .select('id').eq('id', boundaryClaimId).maybeSingle();
    expect(afterDelete).not.toBeNull();

    // 2. Submit + read visibility: resident's own unit sees it, another society / unit does not.
    const billOne = await makeBill(svc, societyA, unitA, 'BILL1', 0);
    const { data: claimId, error: submitError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA,
      p_society_id: societyA,
      p_bill_ids: [billOne],
      p_amount: 1200,
      p_utr: `UTR-${runId}-1`,
      p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/${unitA}/1.jpg`,
      p_user_id: residentA.userId,
    });
    expect(submitError).toBeNull();
    expect(claimId).toBeTruthy();

    const { data: ownClaim, error: ownClaimError } = await residentA.client
      .from('resident_payment_claims').select('id').eq('id', claimId as string);
    expect(ownClaimError).toBeNull();
    expect(ownClaim).toEqual([{ id: claimId }]);

    const { data: otherUnitClaim } = await otherResidentA.client
      .from('resident_payment_claims').select('id').eq('id', claimId as string);
    expect(otherUnitClaim ?? []).toHaveLength(0);
    const { data: otherSocietyClaim } = await residentB.client
      .from('resident_payment_claims').select('id').eq('id', claimId as string);
    expect(otherSocietyClaim ?? []).toHaveLength(0);

    const { data: operatorClaim, error: operatorClaimError } = await operatorA.client
      .from('resident_payment_claims').select('id').eq('id', claimId as string);
    expect(operatorClaimError).toBeNull();
    expect(operatorClaim).toEqual([{ id: claimId }]);

    // 3. Dedup: a second submit for the same bill throws PENDING_CLAIM_EXISTS.
    const { error: dedupError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA,
      p_society_id: societyA,
      p_bill_ids: [billOne],
      p_amount: 1200,
      p_utr: `UTR-${runId}-1-dup`,
      p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/${unitA}/1-dup.jpg`,
      p_user_id: residentA.userId,
    });
    expect(dedupError?.message).toContain('PENDING_CLAIM_EXISTS');

    // 4. Approve: creates a payment, marks the bill PAID; a second approve is idempotent.
    const { data: approvedPaymentId, error: approveError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: claimId as string,
      p_reviewer_id: operatorA.userId,
      p_method: 'upi',
    });
    expect(approveError).toBeNull();
    expect(approvedPaymentId).toBeTruthy();

    const { data: billAfterApproval, error: billAfterApprovalError } = await svc
      .from('bills').select('status').eq('id', billOne).single();
    expect(billAfterApprovalError).toBeNull();
    expect(billAfterApproval?.status).toBe('PAID');

    const { data: claimAfterApproval, error: claimAfterApprovalError } = await svc
      .from('resident_payment_claims').select('status, payment_id').eq('id', claimId as string).single();
    expect(claimAfterApprovalError).toBeNull();
    expect(claimAfterApproval?.status).toBe('approved');
    expect(claimAfterApproval?.payment_id).toBe(approvedPaymentId);

    const { data: secondApprovePaymentId, error: secondApproveError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: claimId as string,
      p_reviewer_id: operatorA.userId,
      p_method: 'upi',
    });
    expect(secondApproveError).toBeNull();
    expect(secondApprovePaymentId).toBe(approvedPaymentId);

    const { data: paymentsForClaim, error: paymentsForClaimError } = await svc
      .from('payments').select('id, resident_id, recorded_by').contains('bill_ids', [billOne]);
    expect(paymentsForClaimError).toBeNull();
    expect(paymentsForClaim).toEqual([{
      id: approvedPaymentId,
      resident_id: residentRecordA,
      recorded_by: `Treasurer A ${runId}`,
    }]);

    // 4a. Migration 061 rejects both an amount that differs from the locked bill
    // total and a duplicate bill id; neither path may create a settlement.
    const amountBill = await makeBill(svc, societyA, unitA, 'AMOUNT', 3);
    const amountClaimId = id();
    await expectSetup(await svc.from('resident_payment_claims').insert({
      id: amountClaimId, society_id: societyA, unit_id: unitA, bill_ids: [amountBill], amount: 1199,
      screenshot_object_key: `claims/${societyA}/${amountClaimId}.jpg`, status: 'pending',
    }).select(), 'seed wrong-amount claim');
    const { error: wrongAmountError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: amountClaimId, p_reviewer_id: operatorA.userId, p_method: 'upi',
    });
    expect(wrongAmountError?.message).toContain('PAYMENT_AMOUNT_MISMATCH');
    const duplicateClaimId = id();
    await expectSetup(await svc.from('resident_payment_claims').insert({
      id: duplicateClaimId, society_id: societyA, unit_id: unitA, bill_ids: [amountBill, amountBill], amount: 2400,
      screenshot_object_key: `claims/${societyA}/${duplicateClaimId}.jpg`, status: 'pending',
    }).select(), 'seed duplicate-bill claim');
    const { error: duplicateIdsError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: duplicateClaimId, p_reviewer_id: operatorA.userId, p_method: 'upi',
    });
    expect(duplicateIdsError?.message).toContain('DUPLICATE_OR_EMPTY_BILL_IDS');

    // 4b. Manual settlement and void are atomic: voiding the sole active payment
    // reopens its bill, while the same RPC remains service-role only.
    const manualBill = await makeBill(svc, societyA, unitA, 'MANUAL', 4);
    const { data: manualPaymentId, error: manualError } = await svc.rpc('record_manual_payment', {
      p_society_id: societyA, p_actor_id: operatorA.userId,
      p_payload: { unit_id: unitA, bill_ids: [manualBill], amount_paid: 1200, payment_mode: 'MANUAL_COLLECTION', payment_date: today, months_covered: 1 },
    });
    expect(manualError).toBeNull();
    const { error: voidError } = await svc.rpc('void_payment_transactional', {
      p_payment_id: manualPaymentId as string, p_society_id: societyA, p_actor_id: operatorA.userId, p_reason: 'Disposable test void',
    });
    expect(voidError).toBeNull();
    const { data: reopenedBill } = await svc.from('bills').select('status').eq('id', manualBill).single();
    expect(reopenedBill?.status).toBe('ISSUED');
    const { error: clientRpcError } = await operatorA.client.rpc('record_manual_payment', {
      p_society_id: societyA, p_actor_id: operatorA.userId, p_payload: {},
    });
    expect(clientRpcError).toBeTruthy();

    // 4c. A target can have only one active bank-line match, even though the
    // polymorphic target column cannot carry a database foreign key.
    const batchId = id();
    const firstLineId = id();
    const secondLineId = id();
    await expectSetup(await svc.from('bank_statement_batches').insert({
      id: batchId, society_id: societyA, filename: `claims-${runId}.csv`, statement_from: today, statement_to: today, line_count: 2,
    }).select(), 'seed bank batch');
    await expectSetup(await svc.from('bank_statement_lines').insert([
      { id: firstLineId, batch_id: batchId, line_date: today, description: 'first match', amount: 1200 },
      { id: secondLineId, batch_id: batchId, line_date: today, description: 'duplicate match', amount: 1200 },
    ]).select(), 'seed bank lines');
    const bankMatchArgs = { p_society_id: societyA, p_batch_id: batchId, p_actor_id: operatorA.userId, p_action: 'match', p_matched_table: 'payments', p_matched_id: approvedPaymentId as string };
    const { error: firstMatchError } = await svc.rpc('reconcile_bank_statement_line', { ...bankMatchArgs, p_line_id: firstLineId });
    expect(firstMatchError).toBeNull();
    const { error: duplicateMatchError } = await svc.rpc('reconcile_bank_statement_line', { ...bankMatchArgs, p_line_id: secondLineId });
    expect(duplicateMatchError).toBeTruthy();
    const { error: ignoreError } = await svc.rpc('reconcile_bank_statement_line', {
      p_society_id: societyA, p_batch_id: batchId, p_line_id: secondLineId, p_actor_id: operatorA.userId,
      p_action: 'ignore', p_matched_table: null, p_matched_id: null,
    });
    expect(ignoreError).toBeNull();

    // 4d. A signed webhook fact conflict is retained for reconciliation and does
    // not mark its bill paid.
    const gatewayBill = await makeBill(svc, societyA, unitA, 'GATEWAY', 5);
    const linkId = id();
    await expectSetup(await svc.from('resident_payment_links').insert({
      id: linkId, society_id: societyA, unit_id: unitA, bill_ids: [gatewayBill], amount: 1200,
      razorpay_link_id: `plink-${runId}-${linkId}`, short_url: `https://pay.example.test/${linkId}`,
    }).select(), 'seed gateway link');
    const { data: conflictPaymentId, error: gatewayConflictError } = await svc.rpc('confirm_resident_payment', {
      p_link_id: linkId, p_razorpay_link_id: `plink-${runId}-${linkId}`, p_razorpay_payment_id: `pay-${runId}-${linkId}`,
      p_amount_subunits: 120000, p_currency: 'USD', p_status: 'captured', p_method: 'upi',
    });
    expect(gatewayConflictError).toBeNull();
    expect(conflictPaymentId).toBeNull();
    const { data: conflictedLink } = await svc.from('resident_payment_links').select('reconciliation_required, status').eq('id', linkId).single();
    expect(conflictedLink).toMatchObject({ reconciliation_required: true, status: 'created' });
    const { data: gatewayBillAfterConflict } = await svc.from('bills').select('status').eq('id', gatewayBill).single();
    expect(gatewayBillAfterConflict?.status).toBe('ISSUED');

    // 5. Reject path: a fresh pending claim on a different bill rejects, then cannot be approved.
    const billTwo = await makeBill(svc, societyA, unitA, 'BILL2', 1);
    const { data: rejectClaimId, error: rejectSubmitError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA,
      p_society_id: societyA,
      p_bill_ids: [billTwo],
      p_amount: 1200,
      p_utr: `UTR-${runId}-2`,
      p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/${unitA}/2.jpg`,
      p_user_id: residentA.userId,
    });
    expect(rejectSubmitError).toBeNull();

    const { error: rejectError } = await svc.rpc('reject_resident_payment_claim', {
      p_claim_id: rejectClaimId as string,
      p_reviewer_id: operatorA.userId,
      p_note: 'Screenshot amount does not match',
    });
    expect(rejectError).toBeNull();

    const { data: rejectedClaim, error: rejectedClaimError } = await svc
      .from('resident_payment_claims').select('status, review_note').eq('id', rejectClaimId as string).single();
    expect(rejectedClaimError).toBeNull();
    expect(rejectedClaim?.status).toBe('rejected');
    expect(rejectedClaim?.review_note).toBe('Screenshot amount does not match');

    const { error: approveRejectedError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: rejectClaimId as string,
      p_reviewer_id: operatorA.userId,
      p_method: 'upi',
    });
    expect(approveRejectedError?.message).toContain('CLAIM_NOT_PENDING');

    // 6. push_subscriptions RLS: a signed-in user sees only their own rows.
    const subscriptionA = id();
    const subscriptionB = id();
    await expectSetup(await svc.from('push_subscriptions').insert([
      {
        id: subscriptionA,
        user_id: residentA.userId,
        society_id: societyA,
        endpoint: `https://push.example.test/${runId}/a`,
        p256dh: 'p256dh-a',
        auth: 'auth-a',
      },
      {
        id: subscriptionB,
        user_id: residentB.userId,
        society_id: societyB,
        endpoint: `https://push.example.test/${runId}/b`,
        p256dh: 'p256dh-b',
        auth: 'auth-b',
      },
    ]), 'create push subscriptions');

    const { data: ownSubscriptions, error: ownSubscriptionsError } = await residentA.client
      .from('push_subscriptions').select('id').in('id', [subscriptionA, subscriptionB]);
    expect(ownSubscriptionsError).toBeNull();
    expect((ownSubscriptions ?? []).map((row: { id: string }) => row.id)).toEqual([subscriptionA]);

    // 7. get_resident_society_payment_info (migration 065). The RPC exists because
    // society_config is Admin/Treasurer-only and also holds bank, tax and receipt
    // columns, so the table read silently returned nothing for every Resident.
    await expectSetup(await svc.from('society_config').update({
      mobile: '+919000000001',
      upi_id: `societya-${runId}@upi`,
      upi_qr_object_key: `society/${societyA}/qr.png`,
      bank_account_no: '000111222333',
      pan_number: 'AAAAA0000A',
    }).eq('society_id', societyA), 'configure society A payment info');
    await expectSetup(await svc.from('society_config').update({
      mobile: '+919000000002',
      upi_id: `societyb-${runId}@upi`,
    }).eq('society_id', societyB), 'configure society B payment info');

    // The direct table read stays denied — that is the bug this RPC works around,
    // and widening the table policy instead would have exposed the financial columns.
    const { data: directConfig } = await residentA.client
      .from('society_config').select('upi_id').eq('society_id', societyA);
    expect(directConfig ?? []).toEqual([]);

    // A resident of society A gets society A's four safe fields, and only those.
    const { data: infoA, error: infoAError } = await residentA.client.rpc('get_resident_society_payment_info');
    expect(infoAError).toBeNull();
    const rowA = (infoA as Array<Record<string, unknown>> | null)?.[0];
    expect(rowA?.upi_id).toBe(`societya-${runId}@upi`);
    expect(rowA?.treasurer_mobile).toBe('+919000000001');
    expect(rowA?.upi_qr_object_key).toBe(`society/${societyA}/qr.png`);
    expect(Object.keys(rowA ?? {}).sort())
      .toEqual(['society_name', 'treasurer_mobile', 'upi_id', 'upi_qr_object_key']);
    expect(JSON.stringify(rowA)).not.toContain('000111222333');
    expect(JSON.stringify(rowA)).not.toContain('AAAAA0000A');

    // Operators reach the same four fields through one code path.
    const { data: infoOperator, error: infoOperatorError } = await operatorA.client.rpc('get_resident_society_payment_info');
    expect(infoOperatorError).toBeNull();
    expect((infoOperator as Array<Record<string, unknown>> | null)?.[0]?.upi_id).toBe(`societya-${runId}@upi`);

    // Tenant scope comes from the request slug, never a caller-supplied id: a
    const crossClient = scopedClient(slugB);
    await crossClient.auth.signInWithPassword({ email: residentA.email, password: residentA.password });
    const { data: crossData, error: crossError } = await crossClient.rpc('get_resident_society_payment_info');
    expect(crossError?.message ?? '').toContain('NOT_AUTHORIZED');
    expect(crossData ?? []).toEqual([]);

    // Society B's resident sees only society B — no bleed from the shared function.
    const { data: infoB, error: infoBError } = await residentB.client.rpc('get_resident_society_payment_info');
    expect(infoBError).toBeNull();
    expect((infoB as Array<Record<string, unknown>> | null)?.[0]?.upi_id).toBe(`societyb-${runId}@upi`);

    // Anonymous callers are rejected even with a valid society slug — and they
    // never reach the function body: EXECUTE is granted to authenticated only,
    // so the anon role is stopped at the grant, before the membership check.
    const { error: anonError } = await scopedClient(slugA).rpc('get_resident_society_payment_info');
    expect(anonError?.message ?? '').toContain('permission denied for function');

    // Revoking the membership withdraws access immediately.
    await expectSetup(await svc.from('society_memberships')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('user_id', otherResidentA.userId), 'revoke membership');
    const { error: revokedError } = await otherResidentA.client.rpc('get_resident_society_payment_info');
    expect(revokedError?.message ?? '').toContain('NOT_AUTHORIZED');
  }, 180_000);
});

/** Advance claims, oldest-first payment allocation, retraction and settlement links. */
describe('live migration 066 contract', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(`RLS integration credentials are required: ${missing.join(', ')}.`);
    }
  });

  it('accepts advance claims, appropriates oldest-first, and honours retraction', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-066-a-${runId}`;
    const slugB = `rls-066-b-${runId}`;
    const unitA = id();
    const unitOther = id();
    const unitB = id();

    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS 066 A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS 066 B ${runId}`, slug: slugB },
    ]), 'create societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: `${runId}-066-101`, is_test_unit: false },
      { id: unitOther, society_id: societyA, flat_number: `${runId}-066-102`, is_test_unit: false },
      { id: unitB, society_id: societyB, flat_number: `${runId}-066-201`, is_test_unit: false },
    ]), 'create units');
    await expectSetup(await svc.from('society_config').insert([
      { id: id(), society_id: societyA, name: `066 config A ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
      { id: id(), society_id: societyB, name: `066 config B ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
    ]), 'create society config');

    const resident = await createUser(societyA, slugA, 'resident', unitA);
    const otherResident = await createUser(societyA, slugA, 'resident', unitOther);
    const operator = await createUser(societyA, slugA, 'treasurer');
    // Three months of arrears at 1200 each, oldest first.
    const billJan = await makeBill(svc, societyA, unitA, '066JAN', -2);
    const billFeb = await makeBill(svc, societyA, unitA, '066FEB', -1);
    const billMar = await makeBill(svc, societyA, unitA, '066MAR', 0);


    const { data: advanceClaimId, error: advanceError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [], p_amount: 2000,
      p_utr: `UTR-066-${runId}-adv`, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/adv.jpg`, p_user_id: resident.userId,
    });
    expect(advanceError).toBeNull();
    expect(advanceClaimId).toBeTruthy();

    // 2. A second pending advance for the same unit is refused (`&&` never
    //    overlaps on an empty array, so without the explicit rule these stack).
    const { error: secondAdvanceError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [], p_amount: 500,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/adv2.jpg`, p_user_id: resident.userId,
    });
    expect(secondAdvanceError?.message ?? '').toContain('PENDING_CLAIM_EXISTS');

    // 3. ...but a bill-directed claim for the same unit is unaffected by it.
    const { error: billClaimError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [billMar], p_amount: 1200,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/bill.jpg`, p_user_id: resident.userId,
    });
    expect(billClaimError).toBeNull();

    // 4. Approving the undirected 2000 must backfill Jan fully (1200) and Feb
    //    partially (800), leaving March untouched and nothing unapplied.
    const { data: advancePaymentId, error: approveError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: advanceClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    expect(approveError).toBeNull();

    const paymentRow = await expectSetup(await svc.from('payments')
      .select('unapplied_amount, payment_mode, amount_paid').eq('id', advancePaymentId).single(), 'read advance payment');
    // The method stays truthful — this is the whole point of unapplied_amount.
    expect(paymentRow?.payment_mode).toBe('UPI');
    expect(Number(paymentRow?.unapplied_amount)).toBeCloseTo(0, 2);

    const settledBills = await expectSetup(await svc.from('bills')
      .select('id, amount_settled, status').in('id', [billJan, billFeb, billMar]), 'read settled bills');
    const byId = new Map((settledBills ?? []).map((b: { id: string; amount_settled: number; status: string }) => [b.id, b]));
    expect(Number(byId.get(billJan)!.amount_settled)).toBeCloseTo(1200, 2);
    expect(byId.get(billJan)!.status).toBe('PAID');
    expect(Number(byId.get(billFeb)!.amount_settled)).toBeCloseTo(800, 2);
    expect(byId.get(billFeb)!.status).not.toBe('PAID');
    expect(Number(byId.get(billMar)!.amount_settled)).toBeCloseTo(0, 2);

    // 5. Overpayment leaves the surplus unapplied rather than inventing a bill.
    const { data: surplusClaimId } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitOther, p_society_id: societyA, p_bill_ids: [], p_amount: 5000,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/surplus.jpg`, p_user_id: otherResident.userId,
    });
    const { data: surplusPaymentId } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: surplusClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    const surplusPayment = await expectSetup(await svc.from('payments')
      .select('unapplied_amount').eq('id', surplusPaymentId).single(), 'read surplus payment');
    // unitOther has no bills at all, so the entire amount is unallocated.
    expect(Number(surplusPayment?.unapplied_amount)).toBeCloseTo(5000, 2);

    // 6. Retraction: the owning resident may withdraw their own pending claim.
    const { data: retractableId } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [billFeb], p_amount: 400,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/retract.jpg`, p_user_id: resident.userId,
    });
    const { error: retractError } = await svc.rpc('retract_resident_payment_claim', {
      p_claim_id: retractableId, p_unit_id: unitA, p_user_id: resident.userId,
    });
    expect(retractError).toBeNull();
    const retracted = await expectSetup(await svc.from('resident_payment_claims')
      .select('status, screenshot_object_key').eq('id', retractableId).single(), 'read retracted claim');
    expect(retracted?.status).toBe('retracted');
    // The screenshot is deliberately preserved — a withdrawn claim is still audit.
    expect(retracted?.screenshot_object_key).toBe(`claims/${societyA}/retract.jpg`);

    // 7. Another flat's resident cannot retract it.
    const { data: otherClaimId } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [], p_amount: 100,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/x.jpg`, p_user_id: resident.userId,
    });
    const { error: crossUnitError } = await svc.rpc('retract_resident_payment_claim', {
      p_claim_id: otherClaimId, p_unit_id: unitOther, p_user_id: otherResident.userId,
    });
    expect(crossUnitError?.message ?? '').toContain('NOT_AUTHORIZED');

    // 8. An already-approved claim cannot be retracted out from under a payment.
    const { error: retractApprovedError } = await svc.rpc('retract_resident_payment_claim', {
      p_claim_id: advanceClaimId, p_unit_id: unitA, p_user_id: resident.userId,
    });
    expect(retractApprovedError?.message ?? '').toContain('CLAIM_NOT_PENDING');

    // 9. Retraction stays RPC-only — a resident writing the status directly must
    //    still silently affect nothing, i.e. no write policy was added.
    await resident.client.from('resident_payment_claims').update({ status: 'retracted' }).eq('id', otherClaimId);
    const stillPending = await expectSetup(await svc.from('resident_payment_claims')
      .select('status').eq('id', otherClaimId).single(), 'reread after direct update');
    expect(stillPending?.status).toBe('pending');

    // 10. A newly issued bill draws from the oldest account credit without a
    //     treasurer action, and records the exact source→bill allocation.
    const billOther = await makeBill(svc, societyA, unitOther, '066OTH', -3);
    const paidByAdvance = await expectSetup(await svc.from('bills')
      .select('status, amount_settled').eq('id', billOther).single(), 'read advance-settled bill');
    expect(paidByAdvance?.status).toBe('PAID');
    const drawnDown = await expectSetup(await svc.from('payments')
      .select('unapplied_amount').eq('id', surplusPaymentId).single(), 'read drawn-down advance');
    expect(Number(drawnDown?.unapplied_amount)).toBeCloseTo(3800, 2);
    const automaticDraw = await expectSetup(await svc.from('advance_settlements')
      .select('advance_id, bill_id, settled_amount, notes')
      .eq('advance_id', surplusPaymentId).eq('bill_id', billOther).single(), 'read automatic draw');
    expect(Number(automaticDraw?.settled_amount)).toBeCloseTo(1200, 2);
    expect(automaticDraw?.notes).toContain('Automatically applied');

    // 10b. The same receipt pays a newly raised levy without fabricating a
    // second cash row in amc_collections. Residents can read their own
    // source→obligation allocation, while tenant scope still hides others.
    const bucketLevyLabel = `AMC-${currentYear + 1}`;
    await expectSetup(await svc.from('levy_configs').insert({
      id: id(), society_id: societyA, levy_label: bucketLevyLabel,
      default_amount: 1500, is_active_for_new_collections: true,
    }), 'configure bucket levy');
    const { error: raiseBucketLevyError } = await svc.rpc('raise_levy_assessment', {
      p_society_id: societyA, p_levy_label: bucketLevyLabel, p_amount: 1500,
    });
    expect(raiseBucketLevyError).toBeNull();
    const bucketLevy = await expectSetup(await svc.from('levy_assessments')
      .select('id, amount_settled, status').eq('society_id', societyA)
      .eq('unit_id', unitOther).eq('levy_label', bucketLevyLabel).single(), 'read bucket levy');
    expect(Number(bucketLevy?.amount_settled)).toBeCloseTo(1500, 2);
    expect(bucketLevy?.status).toBe('PAID');
    const levyAllocation = await expectSetup(await otherResident.client.from('advance_settlements')
      .select('advance_id, levy_assessment_id, settled_amount')
      .eq('advance_id', surplusPaymentId).eq('levy_assessment_id', bucketLevy?.id).single(), 'resident reads levy allocation');
    expect(Number(levyAllocation?.settled_amount)).toBeCloseTo(1500, 2);
    const duplicateCash = await expectSetup(await svc.from('amc_collections')
      .select('id').eq('unit_id', unitOther).eq('levy_label', bucketLevyLabel), 'check no duplicate levy cash');
    expect(duplicateCash).toEqual([]);

    // 11. Cross-society: an account credit cannot settle another society's bill.
    const billForeign = await makeBill(svc, societyB, unitB, '066FGN', -1);
    const { error: foreignError } = await operator.client.rpc('create_advance_settlement', {
      p_society_id: societyA, p_advance_kind: 'PAYMENT', p_advance_id: surplusPaymentId,
      p_settled_amount: 100, p_settled_against: `Foreign ${runId}`,
      p_settled_date: today, p_notes: null, p_bill_id: billForeign,
    });
    expect(foreignError?.message ?? '').toContain('BILL_NOT_FOUND');

    // 11b. A signed gateway receipt uses the same whole-account allocator. It
    // is recorded once in payments and may split across a bill and levy.
    const gatewayLevyLabel = `AMC-${currentYear + 2}`;
    await expectSetup(await svc.from('levy_configs').insert({
      id: id(), society_id: societyB, levy_label: gatewayLevyLabel,
      default_amount: 500, is_active_for_new_collections: true,
    }), 'configure gateway levy');
    await expectSetup(await svc.rpc('raise_levy_assessment', {
      p_society_id: societyB, p_levy_label: gatewayLevyLabel, p_amount: 500,
    }), 'raise gateway levy');
    const gatewayLevy = await expectSetup(await svc.from('levy_assessments')
      .select('id').eq('society_id', societyB).eq('unit_id', unitB)
      .eq('levy_label', gatewayLevyLabel).single(), 'read gateway levy');
    const accountLinkId = id();
    const providerLinkId = `plink-${runId}-${accountLinkId}`;
    const providerPaymentId = `pay-${runId}-${accountLinkId}`;
    await expectSetup(await svc.from('resident_payment_links').insert({
      id: accountLinkId, society_id: societyB, unit_id: unitB, bill_ids: [],
      amount: 1500, razorpay_link_id: providerLinkId,
      short_url: `https://pay.example.test/${accountLinkId}`, status: 'created',
      auto_apply_credit: true,
    }), 'seed account gateway link');
    const { data: gatewayAccountPayment, error: gatewayAccountError } = await svc.rpc('confirm_resident_payment', {
      p_link_id: accountLinkId, p_razorpay_link_id: providerLinkId,
      p_razorpay_payment_id: providerPaymentId, p_amount_subunits: 150000,
      p_currency: 'INR', p_status: 'captured', p_method: 'upi',
    });
    expect(gatewayAccountError).toBeNull();
    const gatewayPayment = await expectSetup(await svc.from('payments')
      .select('amount_paid, unapplied_amount, auto_apply_credit').eq('id', gatewayAccountPayment).single(), 'read gateway account payment');
    expect(Number(gatewayPayment?.amount_paid)).toBeCloseTo(1500, 2);
    expect(Number(gatewayPayment?.unapplied_amount)).toBeCloseTo(0, 2);
    expect(gatewayPayment?.auto_apply_credit).toBe(true);
    const gatewayBillAfter = await expectSetup(await svc.from('bills')
      .select('status, amount_settled').eq('id', billForeign).single(), 'read gateway-paid bill');
    expect(gatewayBillAfter?.status).toBe('PAID');
    expect(Number(gatewayBillAfter?.amount_settled)).toBeCloseTo(1200, 2);
    const gatewayLevyAfter = await expectSetup(await svc.from('levy_assessments')
      .select('status, amount_settled').eq('id', gatewayLevy?.id).single(), 'read gateway-paid levy');
    expect(gatewayLevyAfter?.status).toBe('PENDING');
    expect(Number(gatewayLevyAfter?.amount_settled)).toBeCloseTo(300, 2);
    const gatewayDuplicateCash = await expectSetup(await svc.from('amc_collections')
      .select('id').eq('society_id', societyB).eq('unit_id', unitB)
      .eq('levy_label', gatewayLevyLabel), 'check gateway cash counted once');
    expect(gatewayDuplicateCash).toEqual([]);

    // 12. Different receipts may fill one large bill. Allocation stays FIFO
    //     and consumes each source only once.
    const { data: secondCreditClaim } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitOther, p_society_id: societyA, p_bill_ids: [], p_amount: 1000,
      p_utr: null, p_paid_on: null, p_screenshot_key: `claims/${societyA}/credit2.jpg`,
      p_user_id: otherResident.userId,
    });
    const { data: secondCreditPayment } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: secondCreditClaim, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    const largeBill = id();
    await expectSetup(await svc.from('bills').insert({
      id: largeBill, society_id: societyA, unit_id: unitOther,
      bill_period_year: currentYear + 1, bill_period_month: 1,
      invoice_number: `RLSCLAIM-${runId}-BUCKET-LARGE`, invoice_date: today,
      due_date: today, base_amount: 6000, status: 'ISSUED',
    }), 'create large bucket bill');

    const partiallyPaid = await expectSetup(await svc.from('bills')
      .select('status, amount_settled').eq('id', largeBill).single(), 'read multi-credit bill');
    expect(partiallyPaid?.status).toBe('ISSUED');
    expect(Number(partiallyPaid?.amount_settled)).toBeCloseTo(3300, 2);
    const drawRows = await expectSetup(await svc.from('advance_settlements')
      .select('advance_id, settled_amount').eq('bill_id', largeBill).eq('is_voided', false), 'read multi-credit draws');
    expect(new Map((drawRows ?? []).map(row => [row.advance_id, Number(row.settled_amount)]))).toEqual(new Map([
      [surplusPaymentId as string, 2300],
      [secondCreditPayment as string, 1000],
    ]));

    // 12b. Concurrent receipts serialize on the unit lock: together they may
    // fill the levy exactly once, with the unused paise left on one source.
    const concurrentUnit = id();
    await expectSetup(await svc.from('units').insert({
      id: concurrentUnit, society_id: societyA,
      flat_number: `${runId}-066-CONCURRENT`, is_test_unit: false,
    }), 'create concurrent bucket unit');
    const concurrentLevy = id();
    await expectSetup(await svc.from('levy_assessments').insert({
      id: concurrentLevy, society_id: societyA, unit_id: concurrentUnit,
      levy_label: `Concurrent levy ${runId}`, amount: 1500,
    }), 'create concurrent bucket levy');
    const concurrentReceipts = await Promise.all([1, 2].map(index => svc.from('payments').insert({
      id: id(), society_id: societyA, unit_id: concurrentUnit,
      amount_paid: 1000, payment_mode: 'UPI', payment_date: today,
      months_covered: 0, bill_ids: [], unapplied_amount: 1000,
      auto_apply_credit: true, notes: `Concurrent bucket receipt ${index}`,
    }).select('id').single()));
    concurrentReceipts.forEach(receipt => expect(receipt.error).toBeNull());
    const concurrentLevyAfter = await expectSetup(await svc.from('levy_assessments')
      .select('status, amount_settled').eq('id', concurrentLevy).single(), 'read concurrent bucket levy');
    expect(concurrentLevyAfter?.status).toBe('PAID');
    expect(Number(concurrentLevyAfter?.amount_settled)).toBeCloseTo(1500, 2);
    const concurrentPaymentIds = concurrentReceipts.map(receipt => receipt.data!.id);
    const concurrentBalances = await expectSetup(await svc.from('payments')
      .select('unapplied_amount').in('id', concurrentPaymentIds), 'read concurrent bucket balances');
    expect((concurrentBalances ?? []).reduce((sum, payment) => sum + Number(payment.unapplied_amount), 0)).toBeCloseTo(500, 2);
    const concurrentDraws = await expectSetup(await svc.from('advance_settlements')
      .select('settled_amount').eq('levy_assessment_id', concurrentLevy).eq('is_voided', false), 'read concurrent bucket draws');
    expect((concurrentDraws ?? []).reduce((sum, row) => sum + Number(row.settled_amount), 0)).toBeCloseTo(1500, 2);

    // 13. Voiding the source payment reverses all of its automatic draws while
    //     preserving credit contributed by a different receipt.
    const { error: voidBucketError } = await svc.rpc('void_payment_transactional', {
      p_payment_id: surplusPaymentId, p_society_id: societyA,
      p_actor_id: operator.userId, p_reason: `Bucket reversal ${runId}`,
    });
    expect(voidBucketError).toBeNull();
    const reopenedFirst = await expectSetup(await svc.from('bills')
      .select('status, amount_settled').eq('id', billOther).single(), 'read reopened first bucket bill');
    const preservedSecond = await expectSetup(await svc.from('bills')
      .select('status, amount_settled').eq('id', largeBill).single(), 'read preserved second-source credit');
    expect(reopenedFirst?.status).not.toBe('PAID');
    expect(Number(reopenedFirst?.amount_settled)).toBeCloseTo(0, 2);
    expect(Number(preservedSecond?.amount_settled)).toBeCloseTo(1000, 2);
    const reopenedLevy = await expectSetup(await svc.from('levy_assessments')
      .select('status, amount_settled').eq('id', bucketLevy?.id).single(), 'read reversed bucket levy');
    expect(reopenedLevy?.status).toBe('PENDING');
    expect(Number(reopenedLevy?.amount_settled)).toBeCloseTo(0, 2);
    const voidedDraws = await expectSetup(await svc.from('advance_settlements')
      .select('is_voided').eq('advance_id', surplusPaymentId), 'read voided bucket draws');
    expect((voidedDraws ?? []).every(row => row.is_voided)).toBe(true);
  }, 180_000);
});

/** Levy obligations gate direct collections and resident claim approval. */
describe('live migration 067 levy assessment contract', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(`RLS integration credentials are required: ${missing.join(', ')}.`);
    }
  });

  it('gates resident levy claims on the assessment and blocks double crediting', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-067-a-${runId}`;
    const slugB = `rls-067-b-${runId}`;
    const unitA = id();
    const unitOther = id();
    const unitB = id();
    const levyLabel = `AMC-${currentYear}`;

    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS 067 A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS 067 B ${runId}`, slug: slugB },
    ]), 'create societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: `${runId}-067-101`, is_test_unit: false },
      { id: unitOther, society_id: societyA, flat_number: `${runId}-067-102`, is_test_unit: false },
      { id: unitB, society_id: societyB, flat_number: `${runId}-067-201`, is_test_unit: false },
    ]), 'create units');
    await expectSetup(await svc.from('society_config').insert([
      { id: id(), society_id: societyA, name: `067 config A ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
      { id: id(), society_id: societyB, name: `067 config B ${runId}`, receipt_prefix: 'REC', next_receipt_no: 1 },
    ]), 'create society config');
    await expectSetup(await svc.from('levy_configs').insert({
      id: id(), society_id: societyA, levy_label: levyLabel,
      default_amount: 5000, is_active_for_new_collections: true,
    }), 'configure 067 levy');

    const resident = await createUser(societyA, slugA, 'resident', unitA);
    const otherResident = await createUser(societyA, slugA, 'resident', unitOther);
    const operator = await createUser(societyA, slugA, 'treasurer');
    const residentRecord = id();
    const treasurerRecord = id();
    await expectSetup(await svc.from('residents').insert([
      {
        id: residentRecord, society_id: societyA, unit_id: unitA,
        full_name: `AMC Resident ${runId}`, email: resident.email,
        is_primary: true, is_active: true,
      },
      {
        id: treasurerRecord, society_id: societyA, unit_id: unitA,
        full_name: `AMC Treasurer ${runId}`, email: operator.email,
        is_primary: false, is_active: true,
      },
    ]), 'create AMC payment-party residents');
    await expectSetup(await svc.from('fy_treasurers').insert({
      society_id: societyA,
      fy_start_year: currentMonth >= 4 ? currentYear : currentYear - 1,
      resident_id: treasurerRecord,
    }), 'map AMC payment-party treasurer');

    // 1. Raising a levy creates one assessment per active unit, and is idempotent.
    //    Service-role only: raising charges every flat in a society, so it is
    //    gated at the route (requireFinancialOperator) rather than exposed to
    const { error: raiseError } = await svc.rpc('raise_levy_assessment', {
      p_society_id: societyA, p_levy_label: levyLabel, p_amount: 5000,
    });
    expect(raiseError).toBeNull();

    const raised = await expectSetup(await svc.from('levy_assessments')
      .select('id, unit_id, amount, amount_settled, status')
      .eq('society_id', societyA).eq('levy_label', levyLabel), 'read raised assessments');
    expect((raised ?? []).length).toBe(2);

    // Re-raising must not duplicate — the unique index is the guarantee.
    await svc.rpc('raise_levy_assessment', {
      p_society_id: societyA, p_levy_label: levyLabel, p_amount: 5000,
    });
    const afterRerun = await expectSetup(await svc.from('levy_assessments')
      .select('id').eq('society_id', societyA).eq('levy_label', levyLabel), 're-read assessments');
    expect((afterRerun ?? []).length).toBe(2);

    const byUnit = new Map((raised ?? []).map((r: { unit_id: string; id: string }) => [r.unit_id, r.id]));
    const assessmentA = byUnit.get(unitA)!;
    const assessmentOther = byUnit.get(unitOther)!;

    // 2. A resident sees only their own flat's assessment.
    const visible = await expectSetup(await resident.client
      .from('levy_assessments').select('id').eq('society_id', societyA), 'resident reads assessments');
    expect((visible ?? []).map((r: { id: string }) => r.id)).toEqual([assessmentA]);

    // 3. A resident cannot claim another flat's assessment.
    const { error: crossFlatError } = await svc.rpc('submit_resident_levy_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_levy_assessment_ids: [assessmentOther],
      p_amount: 5000, p_utr: null, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/levy-cross.jpg`, p_user_id: resident.userId,
    });
    expect(crossFlatError?.message ?? '').toContain('ASSESSMENT_NOT_CLAIMABLE');

    // 4. Happy path: submit and approve against the resident's own assessment.
    const { data: levyClaimId, error: submitError } = await svc.rpc('submit_resident_levy_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_levy_assessment_ids: [assessmentA],
      p_amount: 5000, p_utr: `UTR-067-${runId}`, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/levy.jpg`, p_user_id: resident.userId,
    });
    expect(submitError).toBeNull();

    // 5. A second pending claim for the same assessment is refused.
    const { error: secondClaimError } = await svc.rpc('submit_resident_levy_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_levy_assessment_ids: [assessmentA],
      p_amount: 5000, p_utr: null, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/levy2.jpg`, p_user_id: resident.userId,
    });
    expect(secondClaimError?.message ?? '').toContain('PENDING_CLAIM_EXISTS');

    const { error: approveError } = await svc.rpc('approve_resident_levy_claim', {
      p_claim_id: levyClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    expect(approveError).toBeNull();

    const settled = await expectSetup(await svc.from('levy_assessments')
      .select('amount_settled, status').eq('id', assessmentA).single(), 'read settled assessment');
    expect(Number(settled?.amount_settled)).toBeCloseTo(5000, 2);
    expect(settled?.status).toBe('PAID');

    // The collection ledger got exactly one row — the money is recorded once.
    const collections = await expectSetup(await svc.from('amc_collections')
      .select('id, resident_id, recorded_by').eq('unit_id', unitA).eq('levy_label', levyLabel), 'read collections');
    expect(collections).toEqual([expect.objectContaining({
      resident_id: residentRecord,
      recorded_by: `AMC Treasurer ${runId}`,
    })]);

    // 6. THE DOUBLE-CREDIT GUARD. The treasurer's direct recording path must see
    //    the assessment is already settled — this is the whole reason the
    //    obligation row exists.
    const { error: doubleCreditError } = await operator.client.rpc('record_levy_collection', {
      p_society_id: societyA, p_unit_id: unitA, p_resident_id: null,
      p_levy_label: levyLabel, p_amount_paid: 5000, p_payment_date: today,
      p_payment_mode: 'UPI', p_notes: null, p_recorded_by: 'Treasurer',
    });
    expect(doubleCreditError?.message ?? '').toContain('LEVY_ALREADY_SETTLED');

    // 6b. A partial payment is still allowed, but cannot overshoot the amount.
    const { error: overshootError } = await operator.client.rpc('record_levy_collection', {
      p_society_id: societyA, p_unit_id: unitOther, p_resident_id: null,
      p_levy_label: levyLabel, p_amount_paid: 9000, p_payment_date: today,
      p_payment_mode: 'UPI', p_notes: null, p_recorded_by: 'Treasurer',
    });
    expect(overshootError?.message ?? '').toContain('COLLECTION_EXCEEDS_ASSESSMENT');

    const { data: partialCollection, error: partialError } = await operator.client.rpc('record_levy_collection', {
      p_society_id: societyA, p_unit_id: unitOther, p_resident_id: null,
      p_levy_label: levyLabel, p_amount_paid: 2000, p_payment_date: today,
      p_payment_mode: 'UPI', p_notes: null, p_recorded_by: 'Treasurer',
    });
    expect(partialError).toBeNull();
    const partly = await expectSetup(await svc.from('levy_assessments')
      .select('amount_settled, status').eq('id', assessmentOther).single(), 'read partly settled');
    expect(Number(partly?.amount_settled)).toBeCloseTo(2000, 2);
    expect(partly?.status).toBe('PENDING');

    // Editing and voiding the collection must move the assessment in the same
    // transaction. The old direct table update left this balance stale.
    const partialCollectionId = (partialCollection as { id: string }).id;
    const { error: editCollectionError } = await operator.client.rpc('update_levy_collection_transactional', {
      p_society_id: societyA, p_collection_id: partialCollectionId,
      p_amount_paid: 2500, p_payment_date: today, p_payment_mode: 'UPI',
      p_notes: 'Corrected amount', p_recorded_by: 'Treasurer',
    });
    expect(editCollectionError).toBeNull();
    const editedAssessment = await expectSetup(await svc.from('levy_assessments')
      .select('amount_settled').eq('id', assessmentOther).single(), 'read edited levy balance');
    expect(Number(editedAssessment?.amount_settled)).toBeCloseTo(2500, 2);

    const { error: voidCollectionError } = await operator.client.rpc('void_levy_collection_transactional', {
      p_society_id: societyA, p_collection_id: partialCollectionId,
      p_reason: 'Voided during transactional levy regression test',
    });
    expect(voidCollectionError).toBeNull();
    const voidedAssessment = await expectSetup(await svc.from('levy_assessments')
      .select('amount_settled, status').eq('id', assessmentOther).single(), 'read voided levy balance');
    expect(Number(voidedAssessment?.amount_settled)).toBeCloseTo(0, 2);
    expect(voidedAssessment?.status).toBe('PENDING');

    // 7. A settled assessment cannot be claimed again.
    const { error: paidClaimError } = await svc.rpc('submit_resident_levy_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_levy_assessment_ids: [assessmentA],
      p_amount: 5000, p_utr: null, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/levy3.jpg`, p_user_id: resident.userId,
    });
    expect(paidClaimError?.message ?? '').toContain('ASSESSMENT_NOT_CLAIMABLE');

    // 8. Approving is idempotent — a retry returns rather than crediting twice.
    const { error: reapproveError } = await svc.rpc('approve_resident_levy_claim', {
      p_claim_id: levyClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    expect(reapproveError).toBeNull();
    const stillOne = await expectSetup(await svc.from('amc_collections')
      .select('id').eq('unit_id', unitA).eq('levy_label', levyLabel), 're-read collections');
    expect((stillOne ?? []).length).toBe(1);

    // 9. Writes stay RPC-only: a resident updating the table directly no-ops.
    await otherResident.client.from('levy_assessments')
      .update({ status: 'PAID', amount_settled: 5000 }).eq('id', assessmentOther);
    const untouched = await expectSetup(await svc.from('levy_assessments')
      .select('status, amount_settled').eq('id', assessmentOther).single(), 'reread after direct update');
    expect(untouched?.status).toBe('PENDING');
    // Still zero after the transactional void above — the resident's direct
    // write changed nothing.
    expect(Number(untouched?.amount_settled)).toBeCloseTo(0, 2);

    // 9b. A levy claim sent to the BILL approval function must be refused.
    //     Without this guard it would take that function's undirected branch,
    //     appropriate the money across maintenance bills and book the remainder
    //     as an unapplied advance — while the levy the resident actually paid
    //     stayed outstanding. Silent misrouting of real money.
    const { data: strayClaimId } = await svc.rpc('submit_resident_levy_claim', {
      p_unit_id: unitOther, p_society_id: societyA, p_levy_assessment_ids: [assessmentOther],
      p_amount: 3000, p_utr: null, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/stray.jpg`, p_user_id: otherResident.userId,
    });
    const { error: misrouteError } = await svc.rpc('approve_resident_payment_claim', {
      p_claim_id: strayClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    expect(misrouteError?.message ?? '').toContain('CLAIM_IS_LEVY_CLAIM');

    // ...and the reverse: a bill claim sent to the levy function is refused too.
    const strayBill = await makeBill(svc, societyA, unitA, '067STRAY', -1);
    const { data: billClaimId } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unitA, p_society_id: societyA, p_bill_ids: [strayBill], p_amount: 1200,
      p_utr: null, p_paid_on: today,
      p_screenshot_key: `claims/${societyA}/straybill.jpg`, p_user_id: resident.userId,
    });
    const { error: reverseMisrouteError } = await svc.rpc('approve_resident_levy_claim', {
      p_claim_id: billClaimId, p_reviewer_id: operator.userId, p_method: 'upi',
    });
    expect(reverseMisrouteError?.message ?? '').toContain('NOT_A_LEVY_CLAIM');

    //     every flat in a society, so the only caller may be a server route that
    //     which is what would let an operator aim it at another society.
    const { error: sessionRaiseError } = await operator.client.rpc('raise_levy_assessment', {
      p_society_id: societyA, p_levy_label: `CMC-${currentYear}`, p_amount: 100,
    });
    expect(sessionRaiseError?.message ?? '').toContain('permission denied');

    // 11. The other society is untouched by everything above.
    const foreignRows = await expectSetup(await svc.from('levy_assessments')
      .select('id').eq('society_id', societyB), 'read other society assessments');
    expect(foreignRows ?? []).toEqual([]);

    //     payment from the UI), so its own society check must hold.
    const { error: foreignCollectError } = await operator.client.rpc('record_levy_collection', {
      p_society_id: societyB, p_unit_id: unitB, p_resident_id: null,
      p_levy_label: levyLabel, p_amount_paid: 100, p_payment_date: today,
      p_payment_mode: 'UPI', p_notes: null, p_recorded_by: 'Treasurer',
    });
    expect(foreignCollectError?.message ?? '').toContain('NOT_AUTHORIZED');
  }, 180_000);
});

describe('live migration 068 financial setup and legacy reconciliation contract', () => {
  beforeAll(() => {
    if (missing.length > 0) throw new Error(`RLS integration credentials are required: ${missing.join(', ')}.`);
  });

  it('keeps master tables Admin-only while exposing audited, tenant-scoped financial RPCs', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-068-a-${runId}`;
    const slugB = `rls-068-b-${runId}`;
    const unitA = id();
    const unitOther = id();
    const unitB = id();
    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS 068 A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS 068 B ${runId}`, slug: slugB },
    ]), 'create 068 societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: `${runId}-068-101`, monthly_amount: 2000, is_test_unit: false },
      { id: unitOther, society_id: societyA, flat_number: `${runId}-068-102`, monthly_amount: 2000, is_test_unit: false },
      { id: unitB, society_id: societyB, flat_number: `${runId}-068-201`, monthly_amount: 2000, is_test_unit: false },
    ]), 'create 068 units');
    await expectSetup(await svc.from('society_config').insert([
      { id: id(), society_id: societyA, name: `068 config A ${runId}`, monthly_maintenance_amount: 2000 },
      { id: id(), society_id: societyB, name: `068 config B ${runId}`, monthly_maintenance_amount: 2000 },
    ]), 'create 068 configs');

    const admin = await createUser(societyA, slugA, 'admin');
    const treasurer = await createUser(societyA, slugA, 'treasurer');
    const resident = await createUser(societyA, slugA, 'resident', unitA);
    const committee = await createUser(societyA, slugA, 'committee');

    for (const operator of [admin, treasurer]) {
      const { error } = await operator.client.rpc('update_financial_setup', {
        p_society_id: societyA,
        p_monthly_maintenance_amount: 2750,
        p_maintenance_payment_window_days: 10,
        p_penalty_rate_percent: 2,
        p_bank_name: 'Society Bank',
        p_bank_account_no: '1234567890',
        p_bank_ifsc: 'abcd0001234',
        p_upi_id: 'society@upi',
        p_dues_notice_title: 'Maintenance is due',
        p_dues_notice_payby_days: 5,
        p_dues_notice_footer: 'Please contact the Treasurer if this has already been paid.',
      });
      expect(error).toBeNull();
    }

    const { error: residentSetup } = await resident.client.rpc('update_financial_setup', {
      p_society_id: societyA, p_monthly_maintenance_amount: 1,
      p_maintenance_payment_window_days: 1, p_penalty_rate_percent: 0,
      p_bank_name: null, p_bank_account_no: null, p_bank_ifsc: null, p_upi_id: null,
      p_dues_notice_title: 'Invalid resident change', p_dues_notice_payby_days: 1, p_dues_notice_footer: '',
    });
    expect(residentSetup?.message ?? '').toContain('NOT_AUTHORIZED');
    const { error: committeeSetup } = await committee.client.rpc('update_financial_setup', {
      p_society_id: societyA, p_monthly_maintenance_amount: 1,
      p_maintenance_payment_window_days: 1, p_penalty_rate_percent: 0,
      p_bank_name: null, p_bank_account_no: null, p_bank_ifsc: null, p_upi_id: null,
      p_dues_notice_title: 'Invalid committee change', p_dues_notice_payby_days: 1, p_dues_notice_footer: '',
    });
    expect(committeeSetup?.message ?? '').toContain('NOT_AUTHORIZED');

    const { error: foreignSetup } = await treasurer.client.rpc('update_financial_setup', {
      p_society_id: societyB, p_monthly_maintenance_amount: 1,
      p_maintenance_payment_window_days: 1, p_penalty_rate_percent: 0,
      p_bank_name: null, p_bank_account_no: null, p_bank_ifsc: null, p_upi_id: null,
      p_dues_notice_title: 'Cross society change', p_dues_notice_payby_days: 1, p_dues_notice_footer: '',
    });
    expect(foreignSetup?.message ?? '').toContain('NOT_AUTHORIZED');

    // Direct master-table writes remain outside the Treasurer boundary.
    await treasurer.client.from('society_config').update({ monthly_maintenance_amount: 99 }).eq('society_id', societyA);
    await treasurer.client.from('units').update({ flat_number: 'FORGED', is_test_unit: true }).eq('id', unitA);
    const untouched = await expectSetup(await svc.from('units').select('flat_number, is_test_unit, monthly_amount').eq('id', unitA).single(), 'read protected unit');
    expect(untouched?.flat_number).toBe(`${runId}-068-101`);
    expect(untouched?.is_test_unit).toBe(false);

    const { error: amountError } = await treasurer.client.rpc('update_unit_monthly_amount', {
      p_society_id: societyA, p_unit_id: unitA, p_monthly_amount: 3100,
    });
    expect(amountError).toBeNull();
    const changedUnit = await expectSetup(await svc.from('units').select('monthly_amount, flat_number, is_test_unit').eq('id', unitA).single(), 'read amount-only change');
    expect(Number(changedUnit?.monthly_amount)).toBeCloseTo(3100, 2);
    expect(changedUnit?.flat_number).toBe(`${runId}-068-101`);
    expect(changedUnit?.is_test_unit).toBe(false);

    const auditRows = await expectSetup(await svc.from('audit_log')
      .select('table_name, old_data, new_data, notes').eq('society_id', societyA)
      .in('notes', ['Financial setup updated', 'Flat maintenance amount updated']), 'read 068 audit rows');
    expect((auditRows ?? []).some((row: { table_name: string; old_data: unknown; new_data: unknown }) =>
      row.table_name === 'society_config' && row.old_data && row.new_data)).toBe(true);
    expect((auditRows ?? []).some((row: { table_name: string; old_data: unknown; new_data: unknown }) =>
      row.table_name === 'units' && row.old_data && row.new_data)).toBe(true);

    await expectSetup(await svc.from('societies').update({ status: 'suspended' }).eq('id', societyA), 'suspend 068 society');
    const { error: suspendedError } = await treasurer.client.rpc('update_unit_monthly_amount', {
      p_society_id: societyA, p_unit_id: unitA, p_monthly_amount: 3200,
    });
    expect(suspendedError?.message ?? '').toContain('NOT_AUTHORIZED');
    await expectSetup(await svc.from('societies').update({ status: 'active' }).eq('id', societyA), 'reactivate 068 society');

    // Seed rows in the shape migration 066 deliberately left unresolved.
    const paymentId = id();
    const settlementId = id();
    await expectSetup(await svc.from('payments').insert({
      id: paymentId, society_id: societyA, unit_id: unitA, payment_date: today,
      amount_paid: 500, payment_mode: 'ADVANCE', unapplied_amount: 0,
    }), 'create legacy payment');
    await expectSetup(await svc.from('advance_settlements').insert({
      id: settlementId, society_id: societyA, advance_kind: 'PAYMENT', advance_id: paymentId,
      settled_amount: 500, settled_against: 'Legacy maintenance entry', settled_date: today,
    }), 'create unresolved legacy settlement');
    const bill = await makeBill(svc, societyA, unitA, '068LINK', -4);
    const { error: reconcileError } = await treasurer.client.rpc('reconcile_legacy_advance_settlement', {
      p_society_id: societyA, p_settlement_id: settlementId, p_bill_id: bill, p_historical_note: null,
    });
    expect(reconcileError).toBeNull();
    const linked = await expectSetup(await svc.from('advance_settlements')
      .select('bill_id, legacy_resolution').eq('id', settlementId).single(), 'read linked legacy settlement');
    expect(linked).toMatchObject({ bill_id: bill, legacy_resolution: 'LINKED' });
    const credited = await expectSetup(await svc.from('bills').select('amount_settled').eq('id', bill).single(), 'read credited legacy bill');
    expect(Number(credited?.amount_settled)).toBeCloseTo(500, 2);

    const { error: duplicateError } = await treasurer.client.rpc('reconcile_legacy_advance_settlement', {
      p_society_id: societyA, p_settlement_id: settlementId, p_bill_id: bill, p_historical_note: null,
    });
    expect(duplicateError?.message ?? '').toContain('SETTLEMENT_NOT_RECONCILABLE');

    const historicalPayment = id();
    const historicalSettlement = id();
    await expectSetup(await svc.from('payments').insert({ id: historicalPayment, society_id: societyA, unit_id: unitOther, payment_date: today, amount_paid: 300, payment_mode: 'ADVANCE', unapplied_amount: 0 }), 'create historical payment');
    await expectSetup(await svc.from('advance_settlements').insert({ id: historicalSettlement, society_id: societyA, advance_kind: 'PAYMENT', advance_id: historicalPayment, settled_amount: 300, settled_against: 'Old ledger note', settled_date: today }), 'create historical settlement');
    const { error: historicalError } = await admin.client.rpc('reconcile_legacy_advance_settlement', {
      p_society_id: societyA, p_settlement_id: historicalSettlement, p_bill_id: null,
      p_historical_note: 'The paper ledger does not identify a reliable bill number.',
    });
    expect(historicalError).toBeNull();
    const historical = await expectSetup(await svc.from('advance_settlements').select('bill_id, legacy_resolution, legacy_resolution_note').eq('id', historicalSettlement).single(), 'read historical resolution');
    expect(historical?.bill_id).toBeNull();
    expect(historical?.legacy_resolution).toBe('HISTORICAL_UNLINKED');
    expect(historical?.legacy_resolution_note).toContain('paper ledger');

    const foreignBill = await makeBill(svc, societyB, unitB, '068FOREIGN', -2);
    const extraPayment = id();
    const extraSettlement = id();
    await expectSetup(await svc.from('payments').insert({ id: extraPayment, society_id: societyA, unit_id: unitOther, payment_date: today, amount_paid: 200, payment_mode: 'ADVANCE', unapplied_amount: 0 }), 'create boundary payment');
    await expectSetup(await svc.from('advance_settlements').insert({ id: extraSettlement, society_id: societyA, advance_kind: 'PAYMENT', advance_id: extraPayment, settled_amount: 200, settled_against: 'Boundary entry', settled_date: today }), 'create boundary settlement');
    const { error: foreignBillError } = await treasurer.client.rpc('reconcile_legacy_advance_settlement', {
      p_society_id: societyA, p_settlement_id: extraSettlement, p_bill_id: foreignBill, p_historical_note: null,
    });
    expect(foreignBillError?.message ?? '').toContain('BILL_NOT_FOUND');
    const { error: crossFlatError } = await treasurer.client.rpc('reconcile_legacy_advance_settlement', {
      p_society_id: societyA, p_settlement_id: extraSettlement, p_bill_id: bill, p_historical_note: null,
    });
    expect(crossFlatError?.message ?? '').toContain('BILL_UNIT_MISMATCH');
  }, 180_000);
});

describe('live migrations 069/075 manual-payment appropriation and penalty resync contract', () => {
  beforeAll(() => {
    if (missing.length > 0) throw new Error(`RLS integration credentials are required: ${missing.join(', ')}.`);
  });

  // Bills with a due date safely in the past and a controllable base amount, so
  // dues, penalties and appropriation can all be asserted deterministically.
  // makeBill() above pins base_amount and a same-day due date, neither of which
  // works here.
  async function pastBill(
    svc: SupabaseClient,
    societyId: string,
    unitId: string,
    suffix: string,
    month: number,
    baseAmount: number,
    status: 'ISSUED' | 'OVERDUE' | 'PAID' = 'ISSUED',
    penaltyAmount = 0,
  ): Promise<string> {
    const billId = id();
    const year = currentYear - 1;
    await expectSetup(await svc.from('bills').insert({
      id: billId,
      society_id: societyId,
      unit_id: unitId,
      bill_period_year: year,
      bill_period_month: month,
      invoice_number: `RLS069-${runId}-${suffix}`,
      invoice_date: `${year}-${String(month).padStart(2, '0')}-01`,
      due_date: `${year}-${String(month).padStart(2, '0')}-10`,
      base_amount: baseAmount,
      penalty_amount: penaltyAmount,
      status,
    }), `create 069 bill ${suffix}`);
    return billId;
  }

  const readBill = async (svc: SupabaseClient, billId: string) => await expectSetup(
    await svc.from('bills').select('status, amount_settled, payable_amount, penalty_amount').eq('id', billId).single(),
    'read 069 bill',
  ) as unknown as { status: string; amount_settled: number; payable_amount: number; penalty_amount: number };

  const readPayment = async (svc: SupabaseClient, paymentId: string) => await expectSetup(
    await svc.from('payments').select('bill_ids, unapplied_amount, amount_paid').eq('id', paymentId).single(),
    'read 069 payment',
  ) as unknown as { bill_ids: string[]; unapplied_amount: number; amount_paid: number };

  it('settles the months a treasurer recorded against, keeps the rest unapplied, and reverses on void', async () => {
    const svc = serviceClient();
    const society = id();
    const slug = `rls-069-pay-${runId}`;
    const unit = id();
    await expectSetup(await svc.from('societies').insert({ id: society, name: `RLS 069 Pay ${runId}`, slug }), 'create 069 society');
    await expectSetup(await svc.from('units').insert({ id: unit, society_id: society, flat_number: `${runId}-069-101`, is_test_unit: false }), 'create 069 unit');
    await expectSetup(await svc.from('society_config').insert({
      id: id(), society_id: society, name: `069 config ${runId}`, monthly_maintenance_amount: 2000, penalty_rate_percent: 0,
    }), 'create 069 config');
    const treasurer = await createUser(society, slug, 'treasurer');

    const jan = await pastBill(svc, society, unit, 'JAN', 1, 2000);
    const feb = await pastBill(svc, society, unit, 'FEB', 2, 2000);
    const mar = await pastBill(svc, society, unit, 'MAR', 3, 2000);

    const duesBefore = await expectSetup(
      await treasurer.client.from('v_dues_summary').select('total_due, unpaid_months').eq('society_id', society).single(),
      'read 069 dues before',
    ) as unknown as { total_due: number; unpaid_months: number };
    expect(Number(duesBefore.total_due)).toBeCloseTo(6000, 2);
    expect(Number(duesBefore.unpaid_months)).toBe(3);

    // 1. Months named by the treasurer are honoured exactly (Contract Act s.59),
    //    and nothing else on the flat is touched.
    const { data: directedId, error: directedError } = await svc.rpc('record_manual_payment', {
      p_society_id: society, p_actor_id: treasurer.userId,
      p_payload: {
        unit_id: unit, amount_paid: 2000, payment_mode: 'UPI', payment_date: today,
        months_covered: 1, months_detail: 'Feb', bill_ids: [],
        month_periods: [{ year: currentYear - 1, month: 2 }],
      },
    });
    expect(directedError).toBeNull();
    const febPaid = await readBill(svc, feb);
    expect(febPaid.status).toBe('PAID');
    expect(Number(febPaid.amount_settled)).toBeCloseTo(2000, 2);
    expect((await readBill(svc, jan)).status).not.toBe('PAID');
    expect(Number((await readBill(svc, mar)).amount_settled)).toBeCloseTo(0, 2);

    const directedPayment = await readPayment(svc, directedId as string);
    expect(directedPayment.bill_ids).toEqual([feb]);
    expect(Number(directedPayment.unapplied_amount)).toBeCloseTo(0, 2);

    // The Residents dues column is driven by this view — the whole point of the fix.
    const duesAfterDirected = await expectSetup(
      await treasurer.client.from('v_dues_summary').select('total_due, unpaid_months').eq('society_id', society).single(),
      'read 069 dues after directed',
    ) as unknown as { total_due: number; unpaid_months: number };
    expect(Number(duesAfterDirected.total_due)).toBeCloseTo(4000, 2);
    expect(Number(duesAfterDirected.unpaid_months)).toBe(2);

    // 2. Treasurer override: a short receipt part-settles the named month and
    //    journals the exact draw, so the resident sees the reduced balance and
    //    a later void remains reversible.
    const { data: partialId, error: partialError } = await svc.rpc('record_manual_payment', {
      p_society_id: society, p_actor_id: treasurer.userId,
      p_payload: {
        unit_id: unit, amount_paid: 500, payment_mode: 'MANUAL_COLLECTION', payment_date: today,
        months_covered: 1, months_detail: 'Jan', bill_ids: [],
        month_periods: [{ year: currentYear - 1, month: 1 }],
      },
    });
    expect(partialError).toBeNull();
    const janPartial = await readBill(svc, jan);
    expect(janPartial.status).not.toBe('PAID');
    expect(Number(janPartial.amount_settled)).toBeCloseTo(500, 2);
    const partialPayment = await readPayment(svc, partialId as string);
    expect(partialPayment.bill_ids).toEqual([jan]);
    expect(Number(partialPayment.unapplied_amount)).toBeCloseTo(0, 2);
    const directedAllocation = await expectSetup(
      await svc.from('advance_settlements')
        .select('bill_id, settled_amount, notes')
        .eq('advance_id', partialId)
        .eq('is_voided', false)
        .single(),
      'read 075 directed partial allocation',
    ) as unknown as { bill_id: string; settled_amount: number; notes: string };
    expect(directedAllocation.bill_id).toBe(jan);
    expect(Number(directedAllocation.settled_amount)).toBeCloseTo(500, 2);
    expect(directedAllocation.notes).toBe('Treasurer-directed maintenance allocation');

    // 3. Naming a month with no bill records the money as unapplied rather than
    //    silently discharging some other month — it must surface on /advances.
    const { data: strayId, error: strayError } = await svc.rpc('record_manual_payment', {
      p_society_id: society, p_actor_id: treasurer.userId,
      p_payload: {
        unit_id: unit, amount_paid: 3000, payment_mode: 'UPI', payment_date: today,
        months_covered: 1, months_detail: 'Nov', bill_ids: [],
        month_periods: [{ year: currentYear - 1, month: 11 }],
      },
    });
    expect(strayError).toBeNull();
    const strayPayment = await readPayment(svc, strayId as string);
    expect(strayPayment.bill_ids).toEqual([]);
    expect(Number(strayPayment.unapplied_amount)).toBeCloseTo(3000, 2);

    // 4. No months named: flat-wide oldest first (s.61), including a partial
    //    next charge; only money beyond all current charges remains credit.
    const { data: undirectedId, error: undirectedError } = await svc.rpc('record_manual_payment', {
      p_society_id: society, p_actor_id: treasurer.userId,
      p_payload: {
        unit_id: unit, amount_paid: 4000, payment_mode: 'UPI', payment_date: today,
        months_covered: 1, bill_ids: [],
      },
    });
    expect(undirectedError).toBeNull();
    const undirectedPayment = await readPayment(svc, undirectedId as string);
    expect(undirectedPayment.bill_ids).toEqual([jan, mar]);
    // Jan has 1500 left after the override and Mar owes 2000, so 500 remains
    // only after every current charge is cleared.
    expect(Number(undirectedPayment.unapplied_amount)).toBeCloseTo(500, 2);
    expect((await readBill(svc, jan)).status).toBe('PAID');
    expect((await readBill(svc, mar)).status).toBe('PAID');

    const duesCleared = await expectSetup(
      await treasurer.client.from('v_dues_summary').select('total_due, unpaid_months').eq('society_id', society).single(),
      'read 069 dues cleared',
    ) as unknown as { total_due: number; unpaid_months: number };
    expect(Number(duesCleared.total_due)).toBeCloseTo(0, 2);
    expect(Number(duesCleared.unpaid_months)).toBe(0);

    // 5. Voiding gives the settled amount back, not just the status. Leaving
    //    amount_settled behind would keep the bill reading as fully paid in a
    //    dues view that nets it off.
    const { error: voidError } = await svc.rpc('void_payment_transactional', {
      p_payment_id: directedId, p_society_id: society, p_actor_id: treasurer.userId,
      p_reason: 'Recorded against the wrong flat during testing',
    });
    expect(voidError).toBeNull();
    const febVoided = await readBill(svc, feb);
    expect(febVoided.status).toBe('OVERDUE');
    // The undirected receipt's remaining 500 credit immediately continues into
    // the reopened month rather than sitting idle.
    expect(Number(febVoided.amount_settled)).toBeCloseTo(500, 2);

    const duesAfterVoid = await expectSetup(
      await treasurer.client.from('v_dues_summary').select('total_due').eq('society_id', society).single(),
      'read 069 dues after void',
    ) as unknown as { total_due: number };
    expect(Number(duesAfterVoid.total_due)).toBeCloseTo(1500, 2);
  }, 180_000);

  it('shows a resident an immediate ₹16k balance after an undirected ₹14k payment against ₹30k', async () => {
    const svc = serviceClient();
    const society = id();
    const slug = `rls-075-partial-${runId}`;
    const unit = id();
    await expectSetup(await svc.from('societies').insert({
      id: society, name: `RLS 075 Partial ${runId}`, slug,
    }), 'create 075 partial society');
    await expectSetup(await svc.from('units').insert({
      id: unit, society_id: society, flat_number: `${runId}-075-301`, is_test_unit: false,
    }), 'create 075 partial unit');
    await expectSetup(await svc.from('society_config').insert({
      id: id(), society_id: society, name: `075 partial config ${runId}`,
      monthly_maintenance_amount: 30000, penalty_rate_percent: 0,
    }), 'create 075 partial config');
    const treasurer = await createUser(society, slug, 'treasurer');
    const resident = await createUser(society, slug, 'resident', unit);
    const bill = await pastBill(svc, society, unit, 'PARTIAL-30K', 9, 30000);

    const { data: paymentId, error } = await svc.rpc('record_manual_payment', {
      p_society_id: society,
      p_actor_id: treasurer.userId,
      p_payload: {
        unit_id: unit, amount_paid: 14000, payment_mode: 'UPI',
        payment_date: today, months_covered: 1, bill_ids: [],
      },
    });
    expect(error).toBeNull();

    const residentBill = await expectSetup(
      await resident.client.from('bills')
        .select('payable_amount, amount_settled, status')
        .eq('id', bill)
        .single(),
      'resident reads reduced 075 bill',
    ) as unknown as { payable_amount: number; amount_settled: number; status: string };
    expect(Number(residentBill.payable_amount) - Number(residentBill.amount_settled)).toBeCloseTo(16000, 2);
    expect(Number(residentBill.amount_settled)).toBeCloseTo(14000, 2);
    expect(residentBill.status).not.toBe('PAID');

    const residentPayment = await expectSetup(
      await resident.client.from('payments')
        .select('amount_paid, unapplied_amount, auto_apply_credit, bill_ids')
        .eq('id', paymentId)
        .single(),
      'resident reads 075 payment history',
    ) as unknown as {
      amount_paid: number;
      unapplied_amount: number;
      auto_apply_credit: boolean;
      bill_ids: string[];
    };
    expect(Number(residentPayment.amount_paid)).toBeCloseTo(14000, 2);
    expect(Number(residentPayment.unapplied_amount)).toBeCloseTo(0, 2);
    expect(residentPayment.auto_apply_credit).toBe(true);
    expect(residentPayment.bill_ids).toEqual([bill]);
  }, 180_000);

  it('reports one tenant-scoped balance across maintenance and levy obligations', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-076-a-${runId}`;
    const slugB = `rls-076-b-${runId}`;
    const unitA = id();
    const unitB = id();
    const flatA = `${runId}-076-A`;
    const flatB = `${runId}-076-B`;

    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS 076 A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS 076 B ${runId}`, slug: slugB },
    ]), 'create 076 societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: flatA, is_test_unit: false },
      { id: unitB, society_id: societyB, flat_number: flatB, is_test_unit: false },
    ]), 'create 076 units');

    const treasurerA = await createUser(societyA, slugA, 'treasurer');
    const residentA = await createUser(societyA, slugA, 'resident', unitA);
    const treasurerB = await createUser(societyB, slugB, 'treasurer');
    await pastBill(svc, societyA, unitA, 'DUES-A', 10, 2000);
    await pastBill(svc, societyB, unitB, 'DUES-B', 11, 9000);
    await expectSetup(await svc.from('levy_assessments').insert({
      id: id(), society_id: societyA, unit_id: unitA, levy_label: `Lift-${runId}`,
      amount: 5000, amount_settled: 1000, status: 'PENDING',
    }), 'create 076 levy');

    const summary = await expectSetup(
      await treasurerA.client.from('v_dues_summary')
        .select('flat_number, total_due, maintenance_due, levy_due, unpaid_months, unpaid_levies')
        .eq('society_id', societyA)
        .single(),
      'read 076 combined dues',
    ) as unknown as {
      flat_number: string;
      total_due: number;
      maintenance_due: number;
      levy_due: number;
      unpaid_months: number;
      unpaid_levies: number;
    };
    expect(summary.flat_number).toBe(flatA);
    expect(Number(summary.maintenance_due)).toBeCloseTo(2000, 2);
    expect(Number(summary.levy_due)).toBeCloseTo(4000, 2);
    expect(Number(summary.total_due)).toBeCloseTo(6000, 2);
    expect(Number(summary.unpaid_months)).toBe(1);
    expect(Number(summary.unpaid_levies)).toBe(1);

    const community = await expectSetup(
      await residentA.client.rpc('get_community_dues'),
      'read 076 resident community dues',
    ) as unknown as Array<{ flat_number: string; total_due: number }>;
    expect(community).toEqual([{ flat_number: flatA, total_due: 6000 }]);

    const foreign = await expectSetup(
      await treasurerB.client.from('v_dues_summary').select('flat_number').eq('society_id', societyA),
      'read 076 foreign dues boundary',
    );
    expect(foreign).toEqual([]);
  }, 180_000);

  it('recomputes automatic penalties and returns a removed paid penalty as source-backed account credit', async () => {
    const svc = serviceClient();
    const society = id();
    const slug = `rls-069-pen-${runId}`;
    const unit = id();
    const creditUnit = id();
    await expectSetup(await svc.from('societies').insert({ id: society, name: `RLS 069 Pen ${runId}`, slug }), 'create 069 penalty society');
    await expectSetup(await svc.from('units').insert([
      { id: unit, society_id: society, flat_number: `${runId}-069-201`, is_test_unit: false },
      { id: creditUnit, society_id: society, flat_number: `${runId}-077-202`, is_test_unit: false },
    ]), 'create 069 penalty units');
    const configId = id();
    await expectSetup(await svc.from('society_config').insert({
      id: configId, society_id: society, name: `069 penalty config ${runId}`,
      monthly_maintenance_amount: 2000, penalty_rate_percent: 2,
    }), 'create 069 penalty config');
    const treasurer = await createUser(society, slug, 'treasurer');

    // 2% of 2000 = 40, i.e. exactly what the nightly lifecycle would have applied.
    const automatic = await pastBill(svc, society, unit, 'PENAUTO', 4, 2000, 'OVERDUE', 40);
    // A penalty a treasurer typed in at bill generation — a decision about this
    // one bill, not a consequence of the rate.
    const manual = await pastBill(svc, society, unit, 'PENMAN', 5, 2000, 'OVERDUE', 137.5);
    // A synthetic closed record with no over-settlement is still safe to
    // recompute: there is no cash allocation to return.
    const closed = await pastBill(svc, society, unit, 'PENPAID', 6, 2000, 'PAID', 40);
    // Real paid penalty: ₹2,000 principal + ₹40 automatic penalty, journalled
    // to its receipt. Removing the rate must restore exactly ₹40 to that
    // receipt rather than leaving the bill over-settled.
    const creditedBill = await pastBill(svc, society, creditUnit, 'PENCREDIT', 7, 2000, 'OVERDUE', 40);
    const creditedPayment = id();
    await expectSetup(await svc.from('payments').insert({
      id: creditedPayment, society_id: society, unit_id: creditUnit,
      payment_date: '2026-07-20', amount_paid: 2040, payment_mode: 'UPI',
      unapplied_amount: 0, auto_apply_credit: true, bill_ids: [creditedBill],
    }), 'create penalty-paid receipt');
    await expectSetup(await svc.from('advance_settlements').insert({
      id: id(), society_id: society, advance_kind: 'PAYMENT', advance_id: creditedPayment,
      settled_amount: 2040, settled_against: 'Jul 2026 maintenance bill',
      settled_date: '2026-07-20', bill_id: creditedBill,
    }), 'journal penalty-paid receipt');
    await expectSetup(await svc.from('bills').update({ amount_settled: 2040, status: 'PAID' }).eq('id', creditedBill), 'close penalty-paid bill');

    const { error: removeError } = await treasurer.client.rpc('update_financial_setup', {
      p_society_id: society, p_monthly_maintenance_amount: 2000,
      p_maintenance_payment_window_days: 7, p_penalty_rate_percent: 0,
      p_bank_name: null, p_bank_account_no: null, p_bank_ifsc: null, p_upi_id: null,
      p_dues_notice_title: 'Maintenance Dues Reminder', p_dues_notice_payby_days: 7, p_dues_notice_footer: '',
    });
    expect(removeError).toBeNull();

    const automaticCleared = await readBill(svc, automatic);
    expect(Number(automaticCleared.penalty_amount)).toBeCloseTo(0, 2);
    expect(Number(automaticCleared.payable_amount)).toBeCloseTo(2000, 2);
    expect(Number((await readBill(svc, manual)).penalty_amount)).toBeCloseTo(137.5, 2);
    expect(Number((await readBill(svc, closed)).penalty_amount)).toBeCloseTo(0, 2);
    const creditedBillAfter = await readBill(svc, creditedBill);
    expect(Number(creditedBillAfter.penalty_amount)).toBeCloseTo(0, 2);
    expect(Number(creditedBillAfter.amount_settled)).toBeCloseTo(2000, 2);
    const creditedReceipt = await expectSetup(
      await svc.from('payments').select('unapplied_amount, amount_paid').eq('id', creditedPayment).single(),
      'read returned penalty credit',
    ) as unknown as { unapplied_amount: number; amount_paid: number };
    expect(Number(creditedReceipt.amount_paid)).toBeCloseTo(2040, 2);
    expect(Number(creditedReceipt.unapplied_amount)).toBeCloseTo(40, 2);

    // The dues a resident is chased for drop by the penalty that was removed.
    const dues = await expectSetup(
      await treasurer.client.from('v_dues_summary').select('total_due').eq('society_id', society).eq('flat_number', `${runId}-069-201`).single(),
      'read 069 penalty dues',
    ) as unknown as { total_due: number };
    expect(Number(dues.total_due)).toBeCloseTo(2000 + 2137.5, 2);

    // Raising the rate re-applies it to the bill it had been removed from, and
    // still leaves the hand-entered penalty alone.
    const { error: raiseError } = await treasurer.client.rpc('update_financial_setup', {
      p_society_id: society, p_monthly_maintenance_amount: 2000,
      p_maintenance_payment_window_days: 7, p_penalty_rate_percent: 5,
      p_bank_name: null, p_bank_account_no: null, p_bank_ifsc: null, p_upi_id: null,
      p_dues_notice_title: 'Maintenance Dues Reminder', p_dues_notice_payby_days: 7, p_dues_notice_footer: '',
    });
    expect(raiseError).toBeNull();
    expect(Number((await readBill(svc, automatic)).penalty_amount)).toBeCloseTo(100, 2);
    expect(Number((await readBill(svc, manual)).penalty_amount)).toBeCloseTo(137.5, 2);

    // The Admin settings form writes society_config directly rather than through
    // the RPC, so the resync has to hang off the table, not off one caller.
    await expectSetup(await svc.from('society_config').update({ penalty_rate_percent: 1 }).eq('id', configId), 'direct penalty rate update');
    expect(Number((await readBill(svc, automatic)).penalty_amount)).toBeCloseTo(20, 2);

    const auditRows = await expectSetup(await svc.from('audit_log')
      .select('notes, new_data').eq('society_id', society)
      .eq('notes', 'Penalty rate changed — automatic penalties recomputed on unpaid bills'), 'read 069 penalty audit');
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(3);
  }, 180_000);
});

describe('live migration 070 resident claim payable statuses', () => {
  beforeAll(() => {
    if (missing.length > 0) throw new Error(`RLS integration credentials are required: ${missing.join(', ')}.`);
  });

  it('refuses a claim against a draft or cancelled bill instead of accepting one that can never be approved', async () => {
    const svc = serviceClient();
    const society = id();
    const slug = `rls-070-${runId}`;
    const unit = id();
    await expectSetup(await svc.from('societies').insert({ id: society, name: `RLS 070 ${runId}`, slug }), 'create 070 society');
    await expectSetup(await svc.from('units').insert({ id: unit, society_id: society, flat_number: `${runId}-070-101`, is_test_unit: false }), 'create 070 unit');
    await expectSetup(await svc.from('society_config').insert({
      id: id(), society_id: society, name: `070 config ${runId}`, monthly_maintenance_amount: 2000,
    }), 'create 070 config');
    const resident = await createUser(society, slug, 'resident', unit);

    const mkBill = async (suffix: string, month: number, status: string) => {
      const billId = id();
      const year = currentYear - 1;
      await expectSetup(await svc.from('bills').insert({
        id: billId, society_id: society, unit_id: unit,
        bill_period_year: year, bill_period_month: month,
        invoice_number: `RLS070-${runId}-${suffix}`,
        invoice_date: `${year}-${String(month).padStart(2, '0')}-01`,
        due_date: `${year}-${String(month).padStart(2, '0')}-10`,
        base_amount: 2000, status,
      }), `create 070 bill ${suffix}`);
      return billId;
    };

    const overdue = await mkBill('OK', 1, 'OVERDUE');
    const draft = await mkBill('DRAFT', 2, 'DRAFT');
    const cancelled = await mkBill('CANC', 3, 'CANCELLED');


    for (const [label, billId] of [['draft', draft], ['cancelled', cancelled]] as const) {
      const { error } = await svc.rpc('submit_resident_payment_claim', {
        p_unit_id: unit, p_society_id: society, p_bill_ids: [billId], p_amount: 2000,
        p_utr: `UTR070${label}${runId}`.slice(0, 24), p_paid_on: today,
        p_screenshot_key: `claims/${society}/${id()}.jpg`, p_user_id: resident.userId,
      });
      expect(error?.message ?? '').toContain('BILL_NOT_CLAIMABLE');
    }

    // The payable one still works, so the tightening did not break the path.
    const { data: claimId, error: okError } = await svc.rpc('submit_resident_payment_claim', {
      p_unit_id: unit, p_society_id: society, p_bill_ids: [overdue], p_amount: 2000,
      p_utr: `UTR070ok${runId}`.slice(0, 24), p_paid_on: today,
      p_screenshot_key: `claims/${society}/${id()}.jpg`, p_user_id: resident.userId,
    });
    expect(okError).toBeNull();
    expect(claimId).toBeTruthy();
  }, 180_000);
});
