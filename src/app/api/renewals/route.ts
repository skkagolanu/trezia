import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireOperationsReader } from '@/lib/supabase/require-auth';
import { classifyRenewals } from '@/lib/operations/renewals';

export async function GET(request: NextRequest) {
  const auth = await requireOperationsReader();
  if (auth.unauthorized) return auth.unauthorized;
  const url = new URL(request.url);
  const requestedDays = Number.parseInt(url.searchParams.get('days') ?? '60', 10);
  const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(0, requestedDays)) : 60;
  const from = new Date().toISOString().slice(0, 10);
  const deadlineDate = new Date();
  deadlineDate.setUTCDate(deadlineDate.getUTCDate() + days);
  const to = deadlineDate.toISOString().slice(0, 10);
  const supabase = await createClient();
  const [contracts, warranties, services] = await Promise.all([
    supabase.from('vendor_contracts').select('id,vendor_id,title,end_date,renewal_notice_days,status').eq('society_id', auth.societyId).eq('status', 'ACTIVE').is('archived_at', null).lte('end_date', to).order('end_date').order('id').limit(100),
    supabase.from('assets').select('id,vendor_id,name,warranty_expires_on,status').eq('society_id', auth.societyId).eq('status', 'ACTIVE').is('archived_at', null).lte('warranty_expires_on', to).order('warranty_expires_on').order('id').limit(100),
    supabase.from('assets').select('id,vendor_id,name,next_service_date,status').eq('society_id', auth.societyId).eq('status', 'ACTIVE').is('archived_at', null).lte('next_service_date', to).order('next_service_date').order('id').limit(100),
  ]);
  if (contracts.error || warranties.error || services.error) return Response.json({ error: 'Failed to load renewals' }, { status: 500 });
  return Response.json({
    as_of: from,
    through: to,
    buckets: {
      contract_end_dates: classifyRenewals((contracts.data ?? []).filter(row => {
        if (!row.end_date) return false;
        const notice = Math.max(0, row.renewal_notice_days);
        const noticeDate = new Date(`${row.end_date}T00:00:00Z`);
        noticeDate.setUTCDate(noticeDate.getUTCDate() - notice);
        return row.end_date <= from || noticeDate.toISOString().slice(0, 10) <= to;
      }), row => row.end_date, from),
      asset_warranty_expiries: classifyRenewals(warranties.data ?? [], row => row.warranty_expires_on, from),
      asset_service_due_dates: classifyRenewals(services.data ?? [], row => row.next_service_date, from),
    },
  });
}
