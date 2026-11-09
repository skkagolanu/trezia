import { requirePlatformOwner } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { copyLegacySnapshotsToSociety } from '@/lib/storage/r2';

async function markedLegacySociety() {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from('societies')
    .select('id')
    .eq('legacy_storage_layout', 'unscoped-v1')
    .limit(2);
  if (error) throw error;
  if (data.length !== 1) {
    throw new Error(`Expected exactly one society with the legacy storage marker; found ${data.length}`);
  }
  return data[0];
}

async function migrate(dryRun: boolean) {
  const auth = await requirePlatformOwner();
  if (auth.unauthorized) return auth.unauthorized;
  try {
    const society = await markedLegacySociety();
    const objects = await copyLegacySnapshotsToSociety(society.id, { dryRun });
    return Response.json({ dryRun, objects, legacySourcesRetained: true });
  } catch (copyError) {
    console.error('[platform/snapshots/migrate-legacy]', copyError);
    return Response.json({
      error: copyError instanceof Error ? copyError.message : 'Snapshot migration failed; legacy sources were retained',
    }, { status: 500 });
  }
}

export async function GET() {
  return migrate(true);
}

export async function POST() {
  return migrate(false);
}
