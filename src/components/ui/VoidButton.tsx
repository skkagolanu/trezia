'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Modal from './Modal';
import Button from './Button';

interface Props {
  id: string;
  endpoint: string;
  method?: 'PATCH' | 'DELETE';
  label?: string;
  onOptimisticVoid?: () => void;
  onVoidFail?: () => void;
}

export default function VoidButton({ id, endpoint, method = 'PATCH', label = 'Void', onOptimisticVoid, onVoidFail }: Props) {
  const [open, setOpen]       = useState(false);
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleVoid() {
    if (reason.trim().length < 10) {
      toast.error('Please give a reason of at least 10 characters');
      return;
    }
    setLoading(true);
    // Close modal and update UI immediately — don't wait for server
    setOpen(false);
    onOptimisticVoid?.();

    try {
      const body = method === 'DELETE'
        ? JSON.stringify({ void_reason: reason.trim() })
        : JSON.stringify({ id, void_reason: reason.trim() });
      const res = await societyFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        toast.success('Record voided');
        startTransition(() => router.refresh());
      } else {
        toast.error(data.error ?? 'Failed to void');
        onVoidFail?.();
      }
    } catch {
      toast.error('Network error');
      onVoidFail?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        data-society-write
        onClick={() => { setReason(''); setOpen(true); }}
        className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-[var(--sf-red)] hover:bg-[var(--sf-red)]/10 transition-colors"
      >
        {label}
      </button>

      <Modal open={open} onClose={() => !loading && setOpen(false)} title="Void Record" size="sm">
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--sf-label2)]">
            This record will be marked as{' '}
            <span className="font-semibold text-[var(--sf-label)]">voided</span> and excluded from all totals.
            The original row is permanently preserved for audit.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[var(--sf-label)]">
              Reason <span className="text-[var(--sf-red)]">*</span>
              <span className="text-[var(--sf-label3)] font-normal ml-1">(min 10 chars)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Duplicate entry — resident paid twice by mistake"
              className="w-full rounded-[10px] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-3 py-2 text-[14px] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-red)]"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleVoid} loading={loading} disabled={reason.trim().length < 10}>
              Confirm Void
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
