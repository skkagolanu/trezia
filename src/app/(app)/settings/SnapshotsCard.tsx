'use client';
import { societyApiPath, societyFetch } from '@/lib/society-path';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Snapshot = {
  key: string;
  size: number;
  lastModified: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SnapshotsCard() {
  const pathname = usePathname();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [message, setMessage]     = useState('');
  const [error, setError]         = useState('');

  async function fetchList() {
    setLoading(true);
    try {
      const res = await societyFetch('/api/backup/snapshot');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to list');
      setSnapshots(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load snapshots');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchList(); }, []);

  async function handleCreate() {
    setCreating(true);
    setMessage('');
    setError('');
    try {
      const res = await societyFetch('/api/backup/snapshot', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create');
      setMessage(`Snapshot created at ${formatTs(data.exported_at)}`);
      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating snapshot');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
      <div className="border-b border-black/[0.06] px-6 py-4 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-sf-label">Data Snapshots</h3>
          <p className="text-[12px] text-sf-label3 mt-0.5">Full backup of payments, expenses, bills, and AMC records</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-[10px] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {creating ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#FBE9D0]/30 border-t-[#FBE9D0]" />
              Creating…
            </>
          ) : '+ Create Snapshot'}
        </button>
      </div>

      {message && <p className="px-6 pt-3 text-[13px] text-sf-green font-medium">{message}</p>}
      {error   && <p className="px-6 pt-3 text-[13px] text-sf-red">{error}</p>}

      <div className="p-6">
        {loading ? (
          <p className="text-[13px] text-sf-label3">Loading snapshots…</p>
        ) : snapshots.length === 0 ? (
          <p className="text-[13px] text-sf-label3">No snapshots yet. Create your first one above.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {snapshots.map(s => (
              <div key={s.key} className="flex items-center justify-between rounded-xl border border-black/[0.06] bg-sf-bg px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-sf-label">{formatTs(s.lastModified)}</p>
                  <p className="text-[11px] text-sf-label3">{formatBytes(s.size)}</p>
                </div>
                <a
                  href={societyApiPath(pathname, `/api/export?type=artifact&storage=PRIVATE_ARTIFACTS&key=${encodeURIComponent(s.key)}`)}
                  download
                  className="rounded-lg border border-black/[0.10] px-3 py-1.5 text-[12px] font-medium text-sf-label2 hover:bg-black/[0.04] transition-colors"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
