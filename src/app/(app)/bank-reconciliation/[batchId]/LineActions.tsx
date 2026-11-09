'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { formatINR } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import type { MatchCandidate } from '@/lib/utils/bank-reconciliation';

interface Props {
  batchId: string;
  lineId: string;
  candidates: MatchCandidate[];
}

export default function LineActions({ batchId, lineId, candidates }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function act(body: object) {
    setLoading(true);
    try {
      const res = await societyFetch(`/api/bank-statement/${batchId}/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Request failed');
      }
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <button data-society-write
        disabled={loading}
        onClick={() => act({ action: 'ignore' })}
        className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-sf-label3 hover:bg-black/[0.05] transition-colors disabled:opacity-50"
      >
        No match — Ignore
      </button>
    );
  }

  return (
    <div data-society-write className="flex flex-col gap-1 items-end">
      {candidates.slice(0, 3).map(c => (
        <button
          key={`${c.table}:${c.id}`}
          disabled={loading}
          onClick={() => act({ action: 'match', matched_table: c.table, matched_id: c.id })}
          className="rounded-[6px] border border-sf-blue/30 bg-sf-blue/[0.06] px-2 py-1 text-[12px] font-medium text-sf-blue hover:bg-sf-blue/[0.12] transition-colors disabled:opacity-50 whitespace-nowrap"
          title={`${c.label} — ${formatDate(c.date)} — ${formatINR(c.amount)}`}
        >
          Match: {c.label} ({formatDate(c.date)})
        </button>
      ))}
      <button
        disabled={loading}
        onClick={() => act({ action: 'ignore' })}
        className="text-[11px] text-sf-label3 hover:underline disabled:opacity-50"
      >
        None of these — Ignore
      </button>
    </div>
  );
}
