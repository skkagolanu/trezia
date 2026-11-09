'use client';
import { societyFetch } from '@/lib/society-path';
import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Resident } from '@/types/database';
import { todayISO } from '@/lib/utils/date';

interface Props {
  resident: Resident;
}

export default function MoveOutButton({ resident }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openModal() {
    setDate(todayISO());
    setError('');
    setOpen(true);
  }

  async function handleConfirm() {
    if (!date) { setError('Move-out date is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await societyFetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:                   resident.id,
          unit_id:              resident.unit_id,
          full_name:            resident.full_name,
          occupancy_type:       resident.occupancy_type,
          phone:                resident.phone ?? undefined,
          email:                resident.email ?? undefined,
          notification_channel: resident.notification_channel,
          is_primary:           resident.is_primary,
          move_in_date:         resident.move_in_date ?? undefined,
          notes:                resident.notes ?? undefined,
          consent_given:        resident.consent_given ?? false,
          is_active:            false,
          move_out_date:        date,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to record move-out');
      }
      toast.success(`${resident.full_name} marked as moved out`);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        data-society-write
        onClick={openModal}
        className="rounded-[var(--radius-sm)] bg-[var(--sf-orange)]/[0.08] px-2 py-0.5 text-[var(--text-xs)] font-medium text-[var(--sf-orange)] hover:bg-[var(--sf-orange)]/[0.15]"
        title="Record move-out date and mark this resident as inactive"
      >
        Move Out
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-[var(--radius-xl)] bg-[var(--sf-surface)] p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[var(--text-md)] font-semibold text-[var(--sf-label)] mb-1">
              Record Move-Out
            </p>
            <p className="text-[var(--text-sm)] text-[var(--sf-label2)] mb-4">
              <span className="font-medium text-[var(--sf-label)]">{resident.full_name}</span> will be
              marked as inactive. Their phone and email will be automatically erased 30 days after
              this date (DPDP compliance).
            </p>
            <label className="block text-[var(--text-xs)] font-semibold text-[var(--sf-label3)] uppercase tracking-[0.06em] mb-1">
              Move-out date
            </label>
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={e => { setDate(e.target.value); setError(''); }}
              className="w-full h-9 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 text-[max(16px,var(--text-base))] text-[var(--sf-label)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]"
            />
            {error && (
              <p role="alert" className="mt-2 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 h-9 rounded-[var(--radius-md)] bg-[var(--sf-orange)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? 'Saving…' : 'Confirm Move-Out'}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="h-9 px-4 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
