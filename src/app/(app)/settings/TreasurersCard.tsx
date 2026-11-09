'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';
import { fyOptions, fyLabel } from '@/lib/utils/period';

export interface FyTreasurer {
  fy_start_year: number;
  resident_id: string;
}

export interface ResidentOption {
  id: string;
  label: string; // "101 — K K Rama Murthy"
}

interface Props {
  treasurers: FyTreasurer[];
  residents: ResidentOption[];
}

function TreasurerRow({
  fyStartYear,
  initial,
  residents,
  onSaved,
}: {
  fyStartYear: number;
  initial: string;
  residents: ResidentOption[];
  onSaved: () => void;
}) {
  const [residentId, setResidentId] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save(nextId: string) {
    setResidentId(nextId);
    if (!nextId || nextId === initial) return;
    setSaving(true);
    try {
      const res = await societyFetch('/api/fy-treasurers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy_start_year: fyStartYear, resident_id: nextId }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? 'Save failed');
      }
      toast.success(`${fyLabel(fyStartYear)} treasurer saved`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[var(--sf-divider)] last:border-0">
      <span className="w-28 text-[14px] font-medium text-sf-label shrink-0">{fyLabel(fyStartYear)}</span>
      <select
        value={residentId}
        disabled={saving}
        onChange={e => save(e.target.value)}
        className="flex-1 rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2 text-[14px] text-sf-label transition-all hover:border-black/[0.28] focus:outline-none focus:ring-2 focus:ring-sf-blue disabled:opacity-50"
      >
        <option value="">Not set</option>
        {residents.map(r => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function TreasurersCard({ treasurers, residents }: Props) {
  const router = useRouter();
  const byFy = new Map(treasurers.map(t => [t.fy_start_year, t.resident_id]));

  // Newest FY first.
  const years = fyOptions(new Date()).map(o => Number(o.value)).reverse();

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <Card title="Treasurer by Year">
      <p className="text-[13px] text-sf-label3 mb-4 -mt-1">
        The accountable treasurer for each financial year. Saving a year updates new and
        historical maintenance, AMC, other-income, and expense records according to
        each record&rsquo;s own date.
      </p>
      <div>
        {years.map(y => (
          <TreasurerRow
            key={y}
            fyStartYear={y}
            initial={byFy.get(y) ?? ''}
            residents={residents}
            onSaved={refresh}
          />
        ))}
      </div>
    </Card>
  );
}
