/**
 * Live membership/RLS regression gate (migrations 044+).
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

function unscopedClient() {
  return createClient(URL!, ANON!, { auth: { persistSession: false } });
}

async function signInClient(email: string, password: string, slug?: string) {
  const client = slug === undefined ? unscopedClient() : scopedClient(slug);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in test client: ${error.message}`);
  if (!data.session) throw new Error('sign in test client returned no session');
  return client;
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
  const email = `rls-${role}-${runId}-${id()}@example.test`;
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

async function expectVisibleIds(client: SupabaseClient, table: string, visible: string[], hidden: string[]) {
  const result = await client.from(table).select('id').in('id', [...visible, ...hidden]);
  expect(result.error).toBeNull();
  expect((result.data ?? []).map(row => row.id).sort()).toEqual([...visible].sort());
}

describe('live membership RLS and tenant isolation', () => {
  beforeAll(() => {
    if (missing.length > 0) {
      throw new Error(
        `RLS integration credentials are required: ${missing.join(', ')}. `
        + 'Use an isolated disposable test database, never production.',
      );
    }
  });

  it('enforces the complete role, tenant, suspension, invite, and resident-summary contract', async () => {
    const svc = serviceClient();
    const societyA = id();
    const societyB = id();
    const slugA = `rls-a-${runId}`;
    const slugB = `rls-b-${runId}`;
    const unitA = id();
    const otherUnitA = id();
    const testUnitA = id();
    const unitB = id();
    const residentA = id();
    const otherResidentA = id();
    const residentB = id();
    const paymentA = id();
    const testPaymentA = id();
    const paymentB = id();
    const billA = id();
    const billB = id();
    const expenseA = id();
    const expenseB = id();
    const configA = id();
    const configB = id();
    const noticeCurrentAllA = id();
    const noticeCurrentResidentsA = id();
    const noticeOperatorsA = id();
    const noticeFutureA = id();
    const noticeExpiredA = id();
    const noticeArchivedA = id();
    const noticeB = id();
    const handoverA = id();
    const handoverB = id();
    const documentPublishedA = id();
    const documentPrivateA = id();
    const documentB = id();
    const vendorA = id();
    const vendorB = id();
    const contractA = id();
    const assetA = id();
    const serviceA = id();
    const expenseLinkA = id();
    const documentAttachmentA = id();
    const privateAttachmentA = id();
    const noticeAttachmentA = id();

    await expectSetup(await svc.from('societies').insert([
      { id: societyA, name: `RLS A ${runId}`, slug: slugA },
      { id: societyB, name: `RLS B ${runId}`, slug: slugB },
    ]), 'create societies');
    await expectSetup(await svc.from('units').insert([
      { id: unitA, society_id: societyA, flat_number: `${runId}-A-101`, is_test_unit: false },
      { id: otherUnitA, society_id: societyA, flat_number: `${runId}-A-102`, is_test_unit: false },
      { id: testUnitA, society_id: societyA, flat_number: `${runId}-A-TEST`, is_test_unit: true },
      { id: unitB, society_id: societyB, flat_number: `${runId}-B-101`, is_test_unit: false },
    ]), 'create units');
    await expectSetup(await svc.from('residents').insert([
      { id: residentA, society_id: societyA, unit_id: unitA, full_name: `Resident A ${runId}`, email: `resident-a-${runId}@example.test` },
      { id: otherResidentA, society_id: societyA, unit_id: otherUnitA, full_name: `Private A ${runId}`, email: `private-a-${runId}@example.test` },
      { id: residentB, society_id: societyB, unit_id: unitB, full_name: `Resident B ${runId}`, email: `resident-b-${runId}@example.test` },
    ]), 'create residents');
    await expectSetup(await svc.from('payments').insert([
      { id: paymentA, society_id: societyA, unit_id: unitA, resident_id: residentA, amount_paid: 1200, payment_mode: 'UPI', payment_date: today, receipt_number: `RLS-${runId}-A` },
      { id: testPaymentA, society_id: societyA, unit_id: testUnitA, amount_paid: 9999, payment_mode: 'UPI', payment_date: today, receipt_number: `RLS-${runId}-TEST` },
      { id: paymentB, society_id: societyB, unit_id: unitB, resident_id: residentB, amount_paid: 2200, payment_mode: 'UPI', payment_date: today, receipt_number: `RLS-${runId}-B` },
    ]), 'create payments');
    await expectSetup(await svc.from('bills').insert([
      { id: billA, society_id: societyA, unit_id: unitA, bill_period_year: currentYear, bill_period_month: currentMonth, invoice_number: `RLS-${runId}-INV-A`, invoice_date: today, due_date: today, base_amount: 1200, status: 'ISSUED' },
      { id: billB, society_id: societyB, unit_id: unitB, bill_period_year: currentYear, bill_period_month: currentMonth, invoice_number: `RLS-${runId}-INV-B`, invoice_date: today, due_date: today, base_amount: 2200, status: 'ISSUED' },
    ]), 'create bills');
    await expectSetup(await svc.from('expenditures').insert([
      { id: expenseA, society_id: societyA, expense_date: today, category: 'MISC', description: `RLS A ${runId}`, amount: 400 },
      { id: expenseB, society_id: societyB, expense_date: today, category: 'MISC', description: `RLS B ${runId}`, amount: 500 },
    ]), 'create expenditures');
    await expectSetup(await svc.from('society_config').insert([
      { id: configA, society_id: societyA, name: `RLS config A ${runId}` },
      { id: configB, society_id: societyB, name: `RLS config B ${runId}` },
    ]), 'create society config');

    const adminA = await createUser(societyA, slugA, 'admin');
    const treasurerA = await createUser(societyA, slugA, 'treasurer');
    const residentUserA = await createUser(societyA, slugA, 'resident', unitA);
    const committeeA = await createUser(societyA, slugA, 'committee');
    const auditorA = await createUser(societyA, slugA, 'auditor');

    const now = Date.now();
    const hoursFromNow = (hours: number) => new Date(now + hours * 60 * 60 * 1000).toISOString();
    await expectSetup(await svc.from('society_notices').insert([
      { id: noticeB, society_id: societyB, title: 'Foreign notice', body: 'Hidden', created_by: adminA.userId },
    ]), 'create foreign notice');
    await expectSetup(await svc.from('treasurer_handovers').insert({
      id: handoverB, society_id: societyB, handover_date: today,
      outgoing_treasurer: 'Foreign outgoing', incoming_treasurer: 'Foreign incoming',
    }), 'create foreign handover');
    await expectSetup(await svc.from('vendors').insert({
      id: vendorB, society_id: societyB, name: 'Foreign Vendor', service_category: 'Security',
      contact_name: 'Private Contact', phone: '+91 9000000000', created_by: adminA.userId,
    }), 'create foreign vendor');
    await expectSetup(await svc.from('society_documents').insert({
      id: documentB, society_id: societyB, title: 'Foreign document', category: 'OTHER',
      published_to_residents: true, created_by: adminA.userId,
    }), 'create foreign document');

    // Every row carries published_at explicitly. PostgREST sends a bulk insert as one
    // statement over the union of the rows' keys, so a row that omits a key the batch
    // uses elsewhere is sent as an explicit NULL — which suppresses the column default
    // and trips society_notices.published_at NOT NULL. The app never hits this: it
    // inserts notices one at a time and always sets published_at (api/notices POST).
    await expectSetup(await adminA.client.from('society_notices').insert([
      { id: noticeCurrentAllA, society_id: societyA, title: 'Current all', body: 'Visible', audience: 'ALL_MEMBERS', published_at: hoursFromNow(-1), created_by: adminA.userId },
      { id: noticeCurrentResidentsA, society_id: societyA, title: 'Current residents', body: 'Visible', audience: 'RESIDENTS', published_at: hoursFromNow(-1), created_by: adminA.userId },
      { id: noticeOperatorsA, society_id: societyA, title: 'Operators', body: 'Private', audience: 'OPERATORS', published_at: hoursFromNow(-1), created_by: adminA.userId },
      { id: noticeFutureA, society_id: societyA, title: 'Future', body: 'Private', audience: 'ALL_MEMBERS', published_at: hoursFromNow(24), created_by: adminA.userId },
      { id: noticeExpiredA, society_id: societyA, title: 'Expired', body: 'Private', audience: 'ALL_MEMBERS', published_at: hoursFromNow(-48), expires_at: hoursFromNow(-24), created_by: adminA.userId },
      { id: noticeArchivedA, society_id: societyA, title: 'Archived', body: 'Private', audience: 'ALL_MEMBERS', published_at: hoursFromNow(-2), archived_at: hoursFromNow(-1), created_by: adminA.userId },
    ]), 'admin creates scoped notices');
    await expectSetup(await adminA.client.from('treasurer_handovers').insert({
      id: handoverA, society_id: societyA, handover_date: today,
      outgoing_treasurer: 'Outgoing A', incoming_treasurer: 'Incoming A',
    }), 'admin creates handover');
    await expectSetup(await adminA.client.from('society_documents').insert([
      { id: documentPublishedA, society_id: societyA, title: 'Published bylaws', category: 'BYLAWS', published_to_residents: true, created_by: adminA.userId },
      { id: documentPrivateA, society_id: societyA, title: 'Private contract', category: 'CONTRACT', published_to_residents: false, created_by: adminA.userId },
    ]), 'admin creates documents');
    await expectSetup(await adminA.client.from('vendors').insert({
      id: vendorA, society_id: societyA, name: 'Lift Vendor', service_category: 'Lift AMC',
      contact_name: 'Private Operator Contact', phone: '+91 9111111111', email: `vendor-${runId}@example.test`, created_by: adminA.userId,
    }), 'admin creates vendor');
    await expectSetup(await adminA.client.from('vendor_contracts').insert({
      id: contractA, society_id: societyA, vendor_id: vendorA, title: 'Lift AMC', status: 'ACTIVE', created_by: adminA.userId,
    }), 'admin creates vendor contract');
    await expectSetup(await adminA.client.from('assets').insert({
      id: assetA, society_id: societyA, vendor_id: vendorA, name: 'Lift A', category: 'Lift', status: 'ACTIVE', created_by: adminA.userId,
    }), 'admin creates asset');
    await expectSetup(await adminA.client.from('asset_service_records').insert({
      id: serviceA, society_id: societyA, asset_id: assetA, vendor_id: vendorA,
      service_date: today, description: 'Routine service', created_by: adminA.userId,
    }), 'admin creates asset service');
    await expectSetup(await adminA.client.from('operational_expense_links').insert({
      id: expenseLinkA, society_id: societyA, expenditure_id: expenseA,
      vendor_contract_id: contractA, created_by: adminA.userId,
    }), 'admin creates expense link');
    await expectSetup(await adminA.client.from('society_attachments').insert([
      { id: documentAttachmentA, society_id: societyA, document_id: documentPublishedA, filename: 'bylaws.pdf', content_type: 'application/pdf', byte_size: 1200, sha256: 'a'.repeat(64), object_key: `attachments/${societyA}/${documentAttachmentA}`, created_by: adminA.userId },
      { id: privateAttachmentA, society_id: societyA, vendor_contract_id: contractA, filename: 'private-contract.pdf', content_type: 'application/pdf', byte_size: 1300, sha256: 'b'.repeat(64), object_key: `attachments/${societyA}/${privateAttachmentA}`, created_by: adminA.userId },
      { id: noticeAttachmentA, society_id: societyA, notice_id: noticeCurrentResidentsA, filename: 'notice.png', content_type: 'image/png', byte_size: 1400, sha256: 'c'.repeat(64), object_key: `attachments/${societyA}/${noticeAttachmentA}`, created_by: adminA.userId },
    ]), 'admin creates attachments');

    for (const table of ['units', 'residents', 'payments', 'bills', 'expenditures']) {
      const own = table === 'units' ? [unitA, otherUnitA, testUnitA]
        : table === 'residents' ? [residentA, otherResidentA]
          : table === 'payments' ? [paymentA, testPaymentA]
            : table === 'bills' ? [billA]
              : [expenseA];
      const foreign = table === 'units' ? [unitB]
        : table === 'residents' ? [residentB]
          : table === 'payments' ? [paymentB]
            : table === 'bills' ? [billB]
              : [expenseB];
      await expectVisibleIds(treasurerA.client, table, own, foreign);
    }

    const allNoticeIdsA = [noticeCurrentAllA, noticeCurrentResidentsA, noticeOperatorsA, noticeFutureA, noticeExpiredA, noticeArchivedA];
    await expectVisibleIds(adminA.client, 'society_notices', allNoticeIdsA, [noticeB]);
    await expectVisibleIds(treasurerA.client, 'society_notices', allNoticeIdsA, [noticeB]);
    await expectVisibleIds(
      residentUserA.client,
      'society_notices',
      [noticeCurrentAllA, noticeCurrentResidentsA],
      [noticeOperatorsA, noticeFutureA, noticeExpiredA, noticeArchivedA, noticeB],
    );
    const { error: treasurerNoticeWrite } = await treasurerA.client.from('society_notices')
      .update({ is_pinned: true }).eq('id', noticeCurrentAllA).select().single();
    expect(treasurerNoticeWrite).toBeNull();
    const { error: residentNoticeWrite } = await residentUserA.client.from('society_notices')
      .update({ title: 'denied' }).eq('id', noticeCurrentAllA).select().single();
    expect(residentNoticeWrite).toBeTruthy();

    await expectVisibleIds(adminA.client, 'treasurer_handovers', [handoverA], [handoverB]);
    await expectVisibleIds(treasurerA.client, 'treasurer_handovers', [handoverA], [handoverB]);
    await expectVisibleIds(residentUserA.client, 'treasurer_handovers', [], [handoverA, handoverB]);
    const { error: treasurerHandoverWrite } = await treasurerA.client.from('treasurer_handovers')
      .update({ notes: 'Accepted by incoming treasurer' }).eq('id', handoverA).select().single();
    expect(treasurerHandoverWrite).toBeNull();
    const { error: residentHandoverWrite } = await residentUserA.client.from('treasurer_handovers').insert({
      id: id(), society_id: societyA, handover_date: today,
      outgoing_treasurer: 'Denied', incoming_treasurer: 'Denied',
    });
    expect(residentHandoverWrite).toBeTruthy();
    const { error: foreignHandoverWrite } = await treasurerA.client.from('treasurer_handovers').insert({
      id: id(), society_id: societyB, handover_date: today,
      outgoing_treasurer: 'Denied', incoming_treasurer: 'Denied',
    });
    expect(foreignHandoverWrite).toBeTruthy();

    const operationalRows: Array<[string, string[], string[]]> = [
      ['society_documents', [documentPublishedA, documentPrivateA], [documentB]],
      ['vendors', [vendorA], [vendorB]],
      ['vendor_contracts', [contractA], []],
      ['assets', [assetA], []],
      ['asset_service_records', [serviceA], []],
      ['operational_expense_links', [expenseLinkA], []],
      ['society_attachments', [documentAttachmentA, privateAttachmentA, noticeAttachmentA], []],
    ];
    for (const [table, own, foreign] of operationalRows) {
      await expectVisibleIds(adminA.client, table, own, foreign);
      await expectVisibleIds(treasurerA.client, table, own, foreign);
      await expectVisibleIds(residentUserA.client, table, [], [...own, ...foreign]);
    }
    const treasurerOperationalWrites = await Promise.all([
      treasurerA.client.from('society_documents').update({ description: 'Reviewed' }).eq('id', documentPublishedA).select().single(),
      treasurerA.client.from('vendors').update({ notes: 'Reviewed' }).eq('id', vendorA).select().single(),
      treasurerA.client.from('vendor_contracts').update({ notes: 'Reviewed' }).eq('id', contractA).select().single(),
      treasurerA.client.from('assets').update({ notes: 'Reviewed' }).eq('id', assetA).select().single(),
      treasurerA.client.from('asset_service_records').update({ notes: 'Reviewed' }).eq('id', serviceA).select().single(),
      treasurerA.client.from('operational_expense_links').update({ archived_at: hoursFromNow(-1) }).eq('id', expenseLinkA).select().single(),
      treasurerA.client.from('society_attachments').update({ filename: 'bylaws-reviewed.pdf' }).eq('id', documentAttachmentA).select().single(),
    ]);
    expect(treasurerOperationalWrites.every(result => result.error === null)).toBe(true);

    const { error: crossSocietyContract } = await adminA.client.from('vendor_contracts').insert({
      id: id(), society_id: societyA, vendor_id: vendorB, title: 'Cross society denied', created_by: adminA.userId,
    });
    expect(crossSocietyContract?.code).toBe('23503');
    const { error: handoverHardDelete } = await svc.from('treasurer_handovers')
      .delete().eq('id', handoverA);
    expect(handoverHardDelete).toBeTruthy();
    const { error: operationalHardDelete } = await svc.from('vendors')
      .delete().eq('id', vendorA);
    expect(operationalHardDelete?.message).toContain('OPERATIONAL_RECORDS_ARCHIVE_ONLY');
    const auditedIds = [
      handoverA, noticeCurrentAllA, documentPublishedA, vendorA, contractA,
      assetA, serviceA, expenseLinkA, documentAttachmentA,
    ];
    const { data: phaseAuditRows, error: phaseAuditError } = await svc.from('audit_log')
      .select('table_name, record_id').in('record_id', auditedIds);
    expect(phaseAuditError).toBeNull();
    expect(new Set((phaseAuditRows ?? []).map(row => row.table_name))).toEqual(new Set([
      'treasurer_handovers', 'society_notices', 'society_documents', 'vendors',
      'vendor_contracts', 'assets', 'asset_service_records', 'operational_expense_links',
      'society_attachments',
    ]));

    await expectVisibleIds(residentUserA.client, 'units', [unitA], [otherUnitA, testUnitA, unitB]);
    await expectVisibleIds(residentUserA.client, 'residents', [residentA], [otherResidentA, residentB]);
    await expectVisibleIds(residentUserA.client, 'payments', [paymentA], [testPaymentA, paymentB]);
    await expectVisibleIds(residentUserA.client, 'bills', [billA], [billB]);
    await expectVisibleIds(residentUserA.client, 'expenditures', [], [expenseA, expenseB]);

    const residentWrites = await Promise.all([
      residentUserA.client.from('units').update({ notes: 'denied' }).eq('id', unitA).select().single(),
      residentUserA.client.from('residents').update({ notes: 'denied' }).eq('id', residentA).select().single(),
      residentUserA.client.from('payments').update({ notes: 'denied' }).eq('id', paymentA).select().single(),
      residentUserA.client.from('bills').update({ notes: 'denied' }).eq('id', billA).select().single(),
      residentUserA.client.from('expenditures').insert({ id: id(), society_id: societyA, expense_date: today, category: 'MISC', description: 'denied', amount: 1 }),
    ]);
    expect(residentWrites.every(result => result.error !== null)).toBe(true);

    const { data: residentDocuments, error: residentDocumentsError } = await residentUserA.client
      .rpc('list_resident_documents', { p_limit: 25, p_offset: 0 });
    expect(residentDocumentsError).toBeNull();
    expect((residentDocuments ?? []).map((row: { id: string }) => row.id)).toEqual([documentPublishedA]);
    expect(residentDocuments?.[0]).not.toHaveProperty('object_key');
    expect(residentDocuments?.[0]).not.toHaveProperty('created_by');

    const { data: documentAttachments, error: documentAttachmentsError } = await residentUserA.client
      .rpc('list_resident_attachments', { p_parent_type: 'document', p_parent_id: documentPublishedA });
    expect(documentAttachmentsError).toBeNull();
    expect((documentAttachments ?? []).map((row: { id: string }) => row.id)).toEqual([documentAttachmentA]);
    expect(documentAttachments?.[0]).not.toHaveProperty('object_key');
    expect(documentAttachments?.[0]).not.toHaveProperty('sha256');
    const { data: noticeAttachments, error: noticeAttachmentsError } = await residentUserA.client
      .rpc('list_resident_attachments', { p_parent_type: 'notice', p_parent_id: noticeCurrentResidentsA });
    expect(noticeAttachmentsError).toBeNull();
    expect((noticeAttachments ?? []).map((row: { id: string }) => row.id)).toEqual([noticeAttachmentA]);
    const { data: privateAttachments, error: privateAttachmentsError } = await residentUserA.client
      .rpc('list_resident_attachments', { p_parent_type: 'vendor_contract', p_parent_id: contractA });
    expect(privateAttachmentsError).toBeNull();
    expect(privateAttachments ?? []).toHaveLength(0);
    const { data: privateAttachment, error: privateAttachmentError } = await residentUserA.client
      .rpc('get_resident_attachment', { p_attachment_id: privateAttachmentA });
    expect(privateAttachmentError).toBeNull();
    expect(privateAttachment ?? []).toHaveLength(0);

    const { data: treasurerConfig } = await treasurerA.client.from('society_config').select('id').eq('id', configA);
    expect(treasurerConfig).toEqual([{ id: configA }]);
    const { error: treasurerConfigWrite } = await treasurerA.client.from('society_config').update({ name: 'denied' }).eq('id', configA).select().single();
    expect(treasurerConfigWrite).toBeTruthy();
    const { data: treasurerInvites } = await treasurerA.client.from('resident_invites').select('id');
    expect(treasurerInvites ?? []).toHaveLength(0);
    const { data: treasurerRequests } = await treasurerA.client.from('access_requests').select('id');
    expect(treasurerRequests ?? []).toHaveLength(0);
    const { error: treasurerAccessWrite } = await treasurerA.client.from('resident_invites').insert({
      id: id(), society_id: societyA, email: `denied-${runId}@example.test`, role: 'resident',
      unit_id: unitA, invited_by: treasurerA.userId,
    });
    expect(treasurerAccessWrite).toBeTruthy();
    const { data: residentConfig } = await residentUserA.client.from('society_config').select('id');
    expect(residentConfig ?? []).toHaveLength(0);
    const { data: residentInvites } = await residentUserA.client.from('resident_invites').select('id');
    expect(residentInvites ?? []).toHaveLength(0);
    const { data: residentRequests } = await residentUserA.client.from('access_requests').select('id');
    expect(residentRequests ?? []).toHaveLength(0);
    const { error: residentConfigWrite } = await residentUserA.client.from('society_config')
      .update({ name: 'denied' }).eq('id', configA).select().single();
    expect(residentConfigWrite).toBeTruthy();

    const { data: treasurerPayments } = await treasurerA.client.from('payments').select('id').eq('id', paymentA);
    expect(treasurerPayments).toEqual([{ id: paymentA }]);
    const { error: treasurerFinancialWrite } = await treasurerA.client.from('expenditures')
      .update({ description: `Treasurer updated ${runId}` }).eq('id', expenseA).select().single();
    expect(treasurerFinancialWrite).toBeNull();
    const { error: treasurerUnitWrite } = await treasurerA.client.from('units').update({ notes: 'denied' }).eq('id', unitA).select().single();
    expect(treasurerUnitWrite).toBeTruthy();

    for (const denied of [committeeA.client, auditorA.client]) {
      for (const table of [
        'units', 'residents', 'payments', 'bills', 'expenditures', 'society_config',
        'resident_invites', 'access_requests', 'society_notices', 'treasurer_handovers',
        'society_documents', 'vendors', 'vendor_contracts', 'assets', 'asset_service_records',
        'operational_expense_links', 'society_attachments',
      ]) {
        const { data } = await denied.from(table).select('id');
        expect(data ?? []).toHaveLength(0);
      }
      const { data: deniedDocuments } = await denied.rpc('list_resident_documents', { p_limit: 25, p_offset: 0 });
      expect(deniedDocuments ?? []).toHaveLength(0);
      const { data: deniedAttachment } = await denied.rpc('get_resident_attachment', { p_attachment_id: documentAttachmentA });
      expect(deniedAttachment ?? []).toHaveLength(0);
      const { error: deniedOperationalWrite } = await denied.from('society_documents').insert({
        id: id(), society_id: societyA, title: 'Denied document', category: 'OTHER', created_by: denied === committeeA.client ? committeeA.userId : auditorA.userId,
      });
      expect(deniedOperationalWrite).toBeTruthy();
    }

    const inviteEmail = `invite-${runId}@example.test`;
    const invite = await expectSetup(
      await svc.rpc('create_access_invite', {
        p_society_id: societyA,
        p_email: inviteEmail,
        p_role: 'resident',
        p_unit_id: otherUnitA,
        p_actor_id: adminA.userId,
      }),
      'create access invite through migration 049 RPC',
    );
    const { data: inviteRow, error: inviteReadError } = await svc.from('resident_invites')
      .select('id, invited_by, society_id, unit_id').eq('id', invite).single();
    expect(inviteReadError).toBeNull();
    expect(inviteRow).toMatchObject({ id: invite, invited_by: adminA.userId, society_id: societyA, unit_id: otherUnitA });

    const unscopedAdminA = await signInClient(adminA.email, adminA.password);
    const forgedSocietyAdminA = await signInClient(adminA.email, adminA.password, slugB);
    const tenantContextChecks: Array<[string, string[]]> = [
      ['units', [unitA, unitB]],
      ['payments', [paymentA, paymentB]],
      ['society_config', [configA, configB]],
      ['resident_invites', [invite]],
      ['society_notices', [noticeCurrentAllA, noticeB]],
      ['treasurer_handovers', [handoverA, handoverB]],
      ['society_documents', [documentPublishedA, documentB]],
      ['vendors', [vendorA, vendorB]],
      ['vendor_contracts', [contractA]],
      ['assets', [assetA]],
      ['asset_service_records', [serviceA]],
      ['operational_expense_links', [expenseLinkA]],
      ['society_attachments', [documentAttachmentA]],
    ];
    for (const [table, ids] of tenantContextChecks) {
      await expectVisibleIds(unscopedAdminA, table, [], ids);
      await expectVisibleIds(forgedSocietyAdminA, table, [], ids);
    }
    const unscopedResidentA = await signInClient(residentUserA.email, residentUserA.password);
    const forgedSocietyResidentA = await signInClient(residentUserA.email, residentUserA.password, slugB);
    for (const deniedResident of [unscopedResidentA, forgedSocietyResidentA]) {
      const deniedResidentRpcReads = await Promise.all([
        deniedResident.rpc('list_resident_documents', { p_limit: 25, p_offset: 0 }),
        deniedResident.rpc('list_resident_attachments', {
          p_parent_type: 'document',
          p_parent_id: documentPublishedA,
        }),
        deniedResident.rpc('get_resident_attachment', { p_attachment_id: documentAttachmentA }),
      ]);
      for (const result of deniedResidentRpcReads) {
        expect(result.error !== null || (result.data ?? []).length === 0).toBe(true);
      }
    }

    const { data: summary, error: summaryError } = await residentUserA.client.rpc('get_resident_monthly_summary');
    expect(summaryError).toBeNull();
    expect(summary).toHaveLength(1);
    expect(Number(summary?.[0]?.total_collected)).toBe(1200);
    expect(Number(summary?.[0]?.total_spent)).toBe(400);

    const owner = await createUser(societyA, slugA, 'admin');
    await expectSetup(await svc.from('platform_owners').insert({ user_id: owner.userId }), 'create platform owner');
    await expectSetup(
      await svc.from('societies').update({ status: 'suspended', is_active: false }).eq('id', societyA),
      'suspend society',
    );

    for (const table of ['units', 'residents', 'payments', 'bills', 'expenditures', 'society_config']) {
      const target = table === 'units' ? unitA : table === 'residents' ? residentA
        : table === 'payments' ? paymentA : table === 'bills' ? billA
          : table === 'expenditures' ? expenseA : configA;
      const { data: ordinaryRead } = await treasurerA.client.from(table).select('id').eq('id', target);
      expect(ordinaryRead ?? []).toHaveLength(0);
      const { data: ownerRead, error: ownerReadError } = await owner.client.from(table).select('id').eq('id', target);
      expect(ownerReadError).toBeNull();
      expect(ownerRead).toEqual([{ id: target }]);
    }
    const suspendedOperationalTargets: Array<[string, string]> = [
      ['society_notices', noticeCurrentAllA],
      ['treasurer_handovers', handoverA],
      ['society_documents', documentPublishedA],
      ['vendors', vendorA],
      ['vendor_contracts', contractA],
      ['assets', assetA],
      ['asset_service_records', serviceA],
      ['operational_expense_links', expenseLinkA],
      ['society_attachments', documentAttachmentA],
    ];
    for (const [table, target] of suspendedOperationalTargets) {
      const { data: ordinaryRead } = await treasurerA.client.from(table).select('id').eq('id', target);
      expect(ordinaryRead ?? []).toHaveLength(0);
      const { data: ownerRead, error: ownerReadError } = await owner.client.from(table).select('id').eq('id', target);
      expect(ownerReadError).toBeNull();
      expect(ownerRead).toEqual([{ id: target }]);
    }
    const suspendedOwnerOperationalWrites = await Promise.all([
      owner.client.from('society_notices').update({ title: 'denied while suspended' }).eq('id', noticeCurrentAllA).select().single(),
      owner.client.from('treasurer_handovers').update({ notes: 'denied while suspended' }).eq('id', handoverA).select().single(),
      owner.client.from('society_documents').update({ description: 'denied while suspended' }).eq('id', documentPublishedA).select().single(),
      owner.client.from('vendors').update({ notes: 'denied while suspended' }).eq('id', vendorA).select().single(),
      owner.client.from('vendor_contracts').update({ notes: 'denied while suspended' }).eq('id', contractA).select().single(),
      owner.client.from('assets').update({ notes: 'denied while suspended' }).eq('id', assetA).select().single(),
      owner.client.from('asset_service_records').update({ notes: 'denied while suspended' }).eq('id', serviceA).select().single(),
      owner.client.from('operational_expense_links').update({ archived_at: null }).eq('id', expenseLinkA).select().single(),
      owner.client.from('society_attachments').update({ filename: 'denied.pdf' }).eq('id', documentAttachmentA).select().single(),
    ]);
    expect(suspendedOwnerOperationalWrites.every(result => result.error !== null)).toBe(true);
    const { error: ownerFinancialWrite } = await owner.client.from('expenditures')
      .update({ description: 'denied while suspended' }).eq('id', expenseA).select().single();
    expect(ownerFinancialWrite).toBeTruthy();
    const { error: ownerConfigWrite } = await owner.client.from('society_config')
      .update({ name: 'denied while suspended' }).eq('id', configA).select().single();
    expect(ownerConfigWrite).toBeTruthy();
    const { error: ownerUnitWrite } = await owner.client.from('units')
      .update({ notes: 'denied while suspended' }).eq('id', unitA).select().single();
    expect(ownerUnitWrite).toBeTruthy();
  }, 180_000);

  it('serializes concurrent final-Admin revocations', async () => {
    const svc = serviceClient();
    const societyId = id();
    await expectSetup(await svc.from('societies').insert({
      id: societyId,
      name: `RLS concurrency ${runId}`,
      slug: `rls-concurrency-${runId}`,
    }), 'create concurrency society');

    const createAdminMembership = async () => {
      const email = `rls-admin-${runId}-${id()}@example.test`;
      const { data: created, error: createError } = await svc.auth.admin.createUser({
        email,
        password: id(),
        email_confirm: true,
      });
      if (createError) throw new Error(`create concurrency admin: ${createError.message}`);
      if (!created.user) throw new Error('create concurrency admin returned no user');
      const membershipId = id();
      await expectSetup(await svc.from('society_memberships').insert({
        id: membershipId,
        user_id: created.user.id,
        society_id: societyId,
        role: 'admin',
        status: 'active',
      }), 'create concurrency membership');
      return membershipId;
    };

    const [first, second] = await Promise.all([createAdminMembership(), createAdminMembership()]);
    const results = await Promise.all([
      svc.from('society_memberships').update({ status: 'revoked' }).eq('id', first),
      svc.from('society_memberships').update({ status: 'revoked' }).eq('id', second),
    ]);
    expect(results.filter(result => result.error === null)).toHaveLength(1);
    expect(results.filter(result => result.error?.message.includes('FINAL_ADMIN_REQUIRED'))).toHaveLength(1);
  }, 30_000);
});
