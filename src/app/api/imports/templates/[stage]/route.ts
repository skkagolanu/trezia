import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/supabase/require-auth';
import { toCsv } from '@/lib/imports/csv';
import { isImportStage, STAGE_DEFS, templateHeader } from '@/lib/imports/stages';

export const runtime = 'nodejs';

// GET /api/imports/templates/[stage] — the downloadable CSV template for a
// stage: the canonical header row plus one example row a treasurer overwrites.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ stage: string }> }) {
  const auth = await requireAdmin();
  if (auth.unauthorized) return auth.unauthorized;
  const { stage } = await params;
  if (!isImportStage(stage)) return Response.json({ error: 'Unknown import stage' }, { status: 404 });

  const def = STAGE_DEFS[stage];
  const header = templateHeader(stage);
  const example = def.columns.map(c => c.example);
  const csv = toCsv(header, [example]);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="template-${stage}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
