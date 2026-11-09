import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { check, clientIp } from '@/lib/utils/rate-limit';

const SocietyIdSchema = z.string().uuid();
const SOCIETY_LIMIT = 100;
const UNIT_LIMIT = 500;

function limited(request: NextRequest): Response | null {
  const rate = check(`public-onboarding:${clientIp(request.headers)}`, 60, 60_000);
  if (rate.allowed) return null;
  return Response.json({ error: 'Too many requests. Please wait and try again.' }, {
    status: 429,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) },
  });
}

// PUBLIC — exposes only the minimum identifiers needed to submit an access request.
// Units are fetched for one explicitly selected, active society and never in bulk.
export async function GET(request: NextRequest) {
  const rateResponse = limited(request);
  if (rateResponse) return rateResponse;

  const societyId = new URL(request.url).searchParams.get('society_id');
  const service = await createServiceClient();

  try {
    if (!societyId) {
      const { data, error } = await service
        .from('societies')
        .select('id, name')
        .eq('status', 'active')
        .eq('is_active', true)
        .order('name')
        .order('id')
        .range(0, SOCIETY_LIMIT - 1);
      if (error) throw error;
      const societies = (data ?? []).map(row => ({ id: row.id, name: row.name }));
      return Response.json({ societies }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
    }

    const parsedId = SocietyIdSchema.safeParse(societyId);
    if (!parsedId.success) return Response.json({ error: 'Invalid society selection' }, { status: 422 });

    const { data: society, error: societyError } = await service
      .from('societies')
      .select('id')
      .eq('id', parsedId.data)
      .eq('status', 'active')
      .eq('is_active', true)
      .maybeSingle();
    if (societyError) throw societyError;
    if (!society) return Response.json({ error: 'Society not available' }, { status: 404 });

    const { data: units, error: unitsError } = await service
      .from('units')
      .select('id, flat_number')
      .eq('society_id', parsedId.data)
      .eq('is_active', true)
      .eq('is_test_unit', false)
      .order('flat_number')
      .order('id')
      .range(0, UNIT_LIMIT - 1);
    if (unitsError) throw unitsError;
    const publicUnits = (units ?? []).map(row => ({ id: row.id, flat_number: row.flat_number }));
    return Response.json({ units: publicUnits }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
  } catch {
    return Response.json({ error: 'Could not load access options. Please try again.' }, { status: 500 });
  }
}
