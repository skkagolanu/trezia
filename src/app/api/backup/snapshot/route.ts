import { NextResponse } from 'next/server';
import { requireBackupManager } from '@/lib/supabase/require-auth';
import { listSnapshotObjects } from '@/lib/storage/r2';
import { createSnapshot } from '@/lib/snapshots/create';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireBackupManager();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const objects = await listSnapshotObjects(auth.societyId);
    return NextResponse.json(objects);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to list backup snapshots' }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireBackupManager();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const result = await createSnapshot(auth.societyId);
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to create backup snapshot' }, { status: 500 });
  }
}
