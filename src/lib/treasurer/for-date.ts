import type { SupabaseClient } from '@supabase/supabase-js';

export function fyStartYearForIsoDate(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error('Transaction date must be YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('Transaction date has an invalid month');
  return month >= 4 ? year : year - 1;
}

/** Resolve the accountable FY treasurer from the record's own accounting date. */
export async function treasurerNameForDate(
  supabase: SupabaseClient,
  societyId: string,
  isoDate: string,
): Promise<string | null> {
  const fy = fyStartYearForIsoDate(isoDate);
  const { data } = await supabase
    .from('fy_treasurers')
    .select('residents(full_name)')
    .eq('society_id', societyId)
    .eq('fy_start_year', fy)
    .maybeSingle();
  const residents = (data as { residents?: { full_name?: string } | null } | null)?.residents;
  return residents?.full_name ?? null;
}
