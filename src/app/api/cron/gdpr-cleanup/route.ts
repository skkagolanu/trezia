import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { timingSafeEqualString } from '@/lib/utils/timing-safe';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';

const BATCH_SIZE = 500;

// Called monthly by Vercel Cron on the 1st at 02:00 UTC.
// Nulls phone + email on residents who are inactive and whose move_out_date
// was 30+ days ago. The existing DB audit trigger records the UPDATE automatically.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqualString(provided, `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const supabase = await createServiceClient();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    let erased = 0;
    let cursor: string | null = null;

    while (true) {
      let query = supabase
        .from('residents')
        .select('id')
        .eq('is_active', false)
        .lte('move_out_date', cutoffISO)
        .or('phone.not.is.null,email.not.is.null')
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      if (cursor) query = query.gt('id', cursor);

      const { data: targets, error: fetchErr } = await query;
      if (fetchErr) throw new Error('Resident cleanup select failed');
      if (!targets || targets.length === 0) break;

      const ids = targets.map(target => target.id);
      const { error: updateErr } = await supabase
        .from('residents')
        .update({ phone: null, email: null })
        .in('id', ids);

      if (updateErr) throw new Error('Resident cleanup update failed');

      erased += ids.length;
      cursor = ids[ids.length - 1];
      if (ids.length < BATCH_SIZE) break;
    }

    return NextResponse.json({ ok: true, erased });
  } catch (error) {
    console.error('[cron/gdpr-cleanup] failed');
    Sentry.captureException(error, { tags: { cron: 'gdpr_cleanup', operation: 'resident_contact_cleanup' } });
    return NextResponse.json({ ok: false, error: 'Cleanup failed' }, { status: 500 });
  }
}
