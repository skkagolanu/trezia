import type { NextRequest } from 'next/server';
import { itemHandlers } from '@/lib/operations/api';
import { vendorsResource } from '@/lib/operations/resources';
import { createClient } from '@/lib/supabase/server';
import { requireOperationsOperator } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({
  requireOperationsOperator: jest.fn(),
  requireOperationsReader: jest.fn(),
  requirePublishedDocumentsReader: jest.fn(),
}));

it('rejects malformed item ids before touching the database', async () => {
  (requireOperationsOperator as jest.Mock).mockResolvedValue({ userId: 'operator', role: 'treasurer', societyId: 'society-1', unauthorized: null });
  const response = await itemHandlers(vendorsResource).PATCH(
    new Request('http://localhost/api/vendors/not-a-uuid', { method: 'PATCH' }) as NextRequest,
    { params: Promise.resolve({ id: 'not-a-uuid' }) },
  );
  expect(response.status).toBe(404);
  expect(createClient).not.toHaveBeenCalled();
});
