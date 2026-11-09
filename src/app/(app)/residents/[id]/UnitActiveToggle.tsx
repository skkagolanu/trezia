'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export function UnitActiveToggle({ unitId, isActive }: { unitId: string; isActive: boolean }) {
  const router = useRouter();
  const [active, setActive]   = useState(isActive);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (loading) return;
    const next = !active;
    setActive(next);
    setLoading(true);
    try {
      const res = await societyFetch('/api/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unitId, is_active: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed');
      toast.success(next ? 'Unit activated' : 'Unit deactivated — excluded from bills and dues');
      startTransition(() => router.refresh());
    } catch (err) {
      setActive(!next);
      toast.error(err instanceof Error ? err.message : 'Could not update unit status');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      data-society-write
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={active}
      aria-label={active ? 'Deactivate this unit' : 'Activate this unit'}
      title={active ? 'Unit is active — click to deactivate' : 'Unit is inactive — click to activate'}
      className="flex items-center gap-2 rounded-full border border-[var(--sf-border)]
                 bg-[var(--sf-surface)] px-3 py-1.5 text-xs font-medium
                 transition-all hover:bg-[var(--sf-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* iOS-style track */}
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200 ${
          active ? 'bg-[var(--sf-green)]' : 'bg-[var(--sf-label3)]/40'
        }`}
      >
        {/* thumb */}
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#FBE9D0] shadow-sm transition-transform duration-200 ${
            active ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className={active ? 'text-[var(--sf-green)]' : 'text-[var(--sf-label3)]'}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </button>
  );
}
