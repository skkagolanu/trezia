import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/attachments/route';
import { createClient } from '@/lib/supabase/server';
import { requirePublishedDocumentsReader } from '@/lib/supabase/require-auth';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/require-auth', () => ({ requirePublishedDocumentsReader: jest.fn(), requireOperationsOperator: jest.fn() }));
jest.mock('@/lib/storage/r2', () => ({ deletePrivateAttachment: jest.fn(), uploadPrivateAttachment: jest.fn() }));
jest.mock('@/lib/utils/rate-limit', () => ({ check: jest.fn() }));

const parentId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  (requirePublishedDocumentsReader as jest.Mock).mockResolvedValue({ societyId: 'society-1', role: 'admin', unauthorized: null });
});

it('rejects invalid attachment pagination before querying storage metadata', async () => {
  const request = new Request(`http://localhost/api/attachments?parent_type=document&parent_id=${parentId}&page=0`) as NextRequest;
  const response = await GET(request);
  expect(response.status).toBe(422);
  expect(createClient).not.toHaveBeenCalled();
});

it('uses stable ranges and returns pagination metadata', async () => {
  const query = {
    select: jest.fn(), eq: jest.fn(), is: jest.fn(), order: jest.fn(), range: jest.fn(),
  };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: [], error: null, count: 41 });
  (createClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue(query) });
  const request = new Request(`http://localhost/api/attachments?parent_type=document&parent_id=${parentId}&page=2&limit=20`) as NextRequest;
  const response = await GET(request);
  expect(query.range).toHaveBeenCalledWith(20, 39);
  expect(await response.json()).toEqual({ items: [], page: 2, limit: 20, total: 41, has_more: true });
});
