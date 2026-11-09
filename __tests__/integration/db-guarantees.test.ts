/**
 * DB integration tests — require NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * These run only when the disposable/local test database credentials are present.
 * They verify guarantees that Zod tests cannot: DB triggers and sequential auto-increment.
 */

import { createClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/supabase/fetch-all';

const HAS_DB_CREDENTIALS = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const getClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

const describeWithDatabase = HAS_DB_CREDENTIALS ? describe : describe.skip;

describeWithDatabase('DB guarantees (live disposable database)', () => {
  it('hard DELETE on payments is blocked by trigger', async () => {
    const supabase = getClient();
    const { data, error: lookupError } = await supabase
      .from('payments')
      .select('id')
      .limit(1)
      .maybeSingle();

    expect(lookupError).toBeNull();
    if (!data) {
      console.warn('No payment fixture — hard-delete trigger was not exercised');
      return;
    }

    const { error } = await supabase.from('payments').delete().eq('id', data.id);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/not permitted|hard delete/i);
  });

  it('hard DELETE on amc_collections is blocked by trigger', async () => {
    const supabase = getClient();
    const { data, error: lookupError } = await supabase
      .from('amc_collections')
      .select('id')
      .limit(1)
      .maybeSingle();

    expect(lookupError).toBeNull();
    if (!data) {
      console.warn('No levy fixture — AMC hard-delete trigger was not exercised');
      return;
    }

    const { error } = await supabase.from('amc_collections').delete().eq('id', data.id);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/not permitted|hard delete/i);
  });

  it('receipt numbers are assigned sequentially', async () => {
    const supabase = getClient();
    // Receipt numbers are assigned PER SOCIETY (migration 030), so each society has
    // its own REC-0001.. sequence — a global sort would interleave duplicates across
    // societies. Group by society and assert each society's receipts are contiguous.
    const data = await fetchAll<{ id: string; receipt_number: string | null; society_id: string }>(
      (from, to) => supabase
        .from('payments')
        .select('id, receipt_number, society_id')
        .like('receipt_number', 'REC-%')
        .order('society_id')
        .order('id')
        .range(from, to),
    );

    if (data.length < 2) {
      console.warn('Fewer than two generated receipts — sequence was not exercised');
      return;
    }

    const bySociety = new Map<string, number[]>();
    for (const p of data) {
      const n = parseInt(p.receipt_number!.replace('REC-', ''), 10);
      if (Number.isNaN(n)) continue;
      const arr = bySociety.get(p.society_id) ?? [];
      arr.push(n);
      bySociety.set(p.society_id, arr);
    }

    let checkedASociety = false;
    for (const nums of bySociety.values()) {
      if (nums.length < 2) continue;
      nums.sort((a, b) => a - b);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBe(nums[i - 1] + 1);
      }
      checkedASociety = true;
    }
    if (!checkedASociety) {
      console.warn('No society has two generated receipts — sequence was not exercised');
    }
  });
});
