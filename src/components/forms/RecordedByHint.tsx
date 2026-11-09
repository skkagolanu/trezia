'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fyLabel } from '@/lib/utils/period';
import { fyStartYearForIsoDate } from '@/lib/treasurer/for-date';

export default function RecordedByHint({ date }: { date: string }) {
  const [name, setName] = useState<string | null | undefined>(undefined); // undefined = loading
  const fy = /^\d{4}-\d{2}-\d{2}$/.test(date) ? fyStartYearForIsoDate(date) : null;

  useEffect(() => {
    let active = true;
    // Guarded: this is a non-essential hint and must never break the form. The
    // demo mock client, for one, doesn't implement the full query builder.
    (async () => {
      if (fy === null) {
        setName(null);
        return;
      }
      try {
        const { data } = await createClient()
          .from('fy_treasurers')
          .select('residents(full_name)')
          .eq('fy_start_year', fy)
          .maybeSingle();
        if (!active) return;
        const residents = (data as { residents?: { full_name?: string } | null } | null)?.residents;
        setName(residents?.full_name ?? null);
      } catch {
        if (active) setName(null);
      }
    })();
    return () => { active = false; };
  }, [fy]);

  if (name === undefined || fy === null) return null;

  return (
    <p className="text-[var(--text-xs)] text-[var(--sf-label3)]">
      {name ? (
        <>FY Treasurer <span className="font-medium text-[var(--sf-label2)]">{name}</span> · {fyLabel(fy)}</>
      ) : (
        <>No treasurer set for {fyLabel(fy)} — add one in Settings → Treasurer by Year</>
      )}
    </p>
  );
}
