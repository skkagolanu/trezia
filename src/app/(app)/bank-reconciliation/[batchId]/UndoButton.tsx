'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export default function UndoButton({ batchId, lineId }: { batchId: string; lineId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUndo() {
    setLoading(true);
    try {
      const res = await societyFetch(`/api/bank-statement/${batchId}/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmatch' }),
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

  return (
    <button
      data-society-write
      onClick={handleUndo}
      disabled={loading}
      className="text-[12px] text-sf-label3 hover:underline disabled:opacity-50"
    >
      Undo
    </button>
  );
}
