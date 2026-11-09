import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import { loadBatchWithCandidates } from '@/lib/reports/bank-reconciliation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { batchId } = await params;
  const supabase = await createClient();

  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const result = await loadBatchWithCandidates(supabase, batchId, { page, limit });
  if (!result) return Response.json({ error: 'Batch not found' }, { status: 404 });

  return Response.json(result);
}
