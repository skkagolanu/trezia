import { createDemoClient } from '@/lib/supabase/mock-client';

describe('demo Supabase client', () => {
  it('keeps date-range modifiers chainable', async () => {
    const client = createDemoClient<{
      from: (table: string) => {
        select: (columns: string) => {
          gte: (column: string, value: string) => {
            lt: (column: string, value: string) => Promise<{ data: unknown[]; error: null }>;
          };
        };
      };
    }>();

    await expect(
      client.from('payments').select('id').gte('payment_date', '2026-07-01').lt('payment_date', '2026-08-01'),
    ).resolves.toEqual(expect.objectContaining({ error: null }));
  });

  it('resolves the bill-preview Promise.all without any network client', async () => {
    const client = createDemoClient<{
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: unknown) => unknown;
          order: (column: string) => PromiseLike<{ data: unknown[]; error: null }>;
          limit: (count: number) => { single: () => Promise<{ data: unknown; error: null }> };
        };
      };
    }>();
    const units = client.from('units').select('id').order('flat_number');
    const config = client.from('society_config').select('monthly_maintenance_amount').limit(1).single();
    await expect(Promise.all([units, config])).resolves.toEqual([
      expect.objectContaining({ error: null }),
      expect.objectContaining({ error: null }),
    ]);
  });
});
