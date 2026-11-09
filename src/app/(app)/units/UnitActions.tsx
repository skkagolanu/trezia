'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type { Unit } from '@/types/database';
import { parseUnitDrafts } from '@/lib/societies/wizard';

type BatchResult = { created: number; skipped: string[] };

interface AddProps {
  mode: 'add';
  defaultAmount: number;
  unit?: never;
}

interface EditProps {
  mode: 'edit';
  unit: Unit;
  defaultAmount: number;
}

type Props = AddProps | EditProps;

export default function UnitActions({ mode, unit, defaultAmount }: Props) {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [addSubMode, setAddSubMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText]     = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult]   = useState<BatchResult | null>(null);
  const bulkUnits = useMemo(() => parseUnitDrafts(bulkText), [bulkText]);
  const bulkRawCount = useMemo(() => {
    const rawLines = bulkText.split('\n').map(line => line.trim()).filter(Boolean);
    const lines = rawLines.length === 1 && !rawLines[0].includes('|')
      ? rawLines[0].split(',').map(line => line.trim()).filter(Boolean)
      : rawLines;
    return lines.filter(line => line.split('|')[0]?.trim()).length;
  }, [bulkText]);
  const bulkDuplicateCount = Math.max(0, bulkRawCount - bulkUnits.length);

  const [form, setForm] = useState({
    flat_number:    mode === 'edit' ? unit.flat_number : '',
    flat_area_sqft: mode === 'edit' && unit.flat_area_sqft != null ? String(unit.flat_area_sqft) : '',
    monthly_amount: mode === 'edit' && unit.monthly_amount != null ? String(unit.monthly_amount) : '',
    notes:          mode === 'edit' ? (unit.notes ?? '') : '',
    is_active:      mode === 'edit' ? unit.is_active : true,
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm(prev => ({
        ...prev,
        [field]: e.target.type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : e.target.value,
      }));
    };
  }

  function closeModal() {
    setOpen(false);
    setAddSubMode('single');
    setBulkText('');
    setBulkResult(null);
  }

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (bulkUnits.length === 0) {
      toast.error('Paste at least one flat number');
      return;
    }

    setBulkLoading(true);
    try {
      const payload = {
        units: bulkUnits.map(unit => ({
          flat_number:    unit.flat_number.toUpperCase(),
          ...(unit.flat_area_sqft != null ? { flat_area_sqft: unit.flat_area_sqft } : {}),
          ...(unit.monthly_amount != null ? { monthly_amount: unit.monthly_amount } : {}),
        })),
      };

      const res = await societyFetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const body = await res.json() as BatchResult;
      setBulkResult(body);
      toast.success(`${body.created} flat${body.created === 1 ? '' : 's'} added`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add flats');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.flat_number.trim()) {
      toast.error('Flat number is required');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        flat_number:    form.flat_number.trim().toUpperCase(),
        flat_area_sqft: form.flat_area_sqft !== '' ? Number(form.flat_area_sqft) : null,
        monthly_amount: form.monthly_amount !== '' ? Number(form.monthly_amount) : null,
        notes:          form.notes || null,
      };

      if (mode === 'edit') {
        payload.id        = unit.id;
        payload.is_active = form.is_active;
      }

      const res = await societyFetch('/api/units', {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      toast.success(mode === 'add' ? 'Unit added' : 'Unit updated');
      closeModal();
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {mode === 'add' ? (
        <button
          data-society-write
          onClick={() => setOpen(true)}
          className="rounded-[10px] bg-sf-blue px-4 py-2.5 text-[14px] font-semibold text-white hover:opacity-90 transition-opacity"
        >
          + Add Unit
        </button>
      ) : (
        <button
          data-society-write
          onClick={() => setOpen(true)}
          className="rounded px-2 py-1 text-[var(--text-xs)] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors"
        >
          Edit
        </button>
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={mode === 'add' ? 'Add New Unit' : `Edit ${unit?.flat_number}`}
        size="sm"
      >
        {mode === 'add' && (
          <div className="mb-4 flex gap-2 rounded-[10px] bg-sf-bg p-1">
            <button
              type="button"
              onClick={() => setAddSubMode('single')}
              className={`flex-1 rounded-[8px] py-1.5 text-[13px] font-medium transition-colors ${addSubMode === 'single' ? 'bg-sf-surface text-sf-label shadow-sm' : 'text-sf-label3'}`}
            >
              One flat
            </button>
            <button
              type="button"
              onClick={() => setAddSubMode('bulk')}
              className={`flex-1 rounded-[8px] py-1.5 text-[13px] font-medium transition-colors ${addSubMode === 'bulk' ? 'bg-sf-surface text-sf-label shadow-sm' : 'text-sf-label3'}`}
            >
              Several flats
            </button>
          </div>
        )}

        {mode === 'add' && addSubMode === 'bulk' ? (
          bulkResult ? (
            <div className="space-y-4">
              <p className="text-[14px] text-sf-label">
                {bulkResult.created} flat{bulkResult.created === 1 ? '' : 's'} added.
              </p>
              {bulkResult.skipped.length > 0 && (
                <div>
                  <p className="text-[13px] font-medium text-sf-label2">
                    Skipped (already exist): {bulkResult.skipped.length}
                  </p>
                  <ul className="mt-1 max-h-32 overflow-y-auto text-[13px] text-sf-label3">
                    {bulkResult.skipped.map(flat => <li key={flat}>{flat}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <Button variant="secondary" type="button" onClick={() => { setBulkResult(null); setBulkText(''); }}>
                  Add more
                </Button>
                <Button type="button" onClick={closeModal}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-sf-label">Flat Numbers</label>
                <textarea
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  placeholder={'A101, A102, A103\nor one per line\nA101 | 1200 | 2500'}
                  rows={6}
                  className="w-full rounded-[10px] border border-sf-border bg-sf-bg p-3 font-mono text-[13px]"
                />
                <p className="mt-1 text-[12px] text-sf-label3">
                  One per line or comma-separated. Optional: flat | area sqft | monthly amount.
                </p>
              </div>
              <p className="text-[13px] text-sf-label2">
                {bulkUnits.length} valid flat{bulkUnits.length === 1 ? '' : 's'} parsed
                {bulkDuplicateCount > 0 ? ` · ${bulkDuplicateCount} duplicate${bulkDuplicateCount === 1 ? '' : 's'} ignored` : ''}
              </p>
              <div className="flex justify-end gap-3 pt-1">
                <Button variant="secondary" type="button" onClick={closeModal} disabled={bulkLoading}>
                  Cancel
                </Button>
                <Button type="submit" loading={bulkLoading} disabled={bulkUnits.length === 0}>
                  Add {bulkUnits.length || ''} Flat{bulkUnits.length === 1 ? '' : 's'}
                </Button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Flat Number"
              type="text"
              value={form.flat_number}
              onChange={handleChange('flat_number')}
              placeholder="e.g. A101"
              required
              disabled={mode === 'edit'}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Area (sqft)"
                type="number"
                value={form.flat_area_sqft}
                onChange={handleChange('flat_area_sqft')}
                placeholder="e.g. 1200"
                min="0"
                hint="Optional"
              />
              <Input
                label="Monthly Amount (₹)"
                type="number"
                value={form.monthly_amount}
                onChange={handleChange('monthly_amount')}
                placeholder={`default: ${defaultAmount}`}
                min="0"
                step="0.01"
                hint="Leave blank to use default"
              />
            </div>

            <Input
              label="Notes"
              type="text"
              value={form.notes}
              onChange={handleChange('notes')}
              placeholder="Optional"
              hint="Optional"
            />

            {mode === 'edit' && (
              <label className="flex items-center gap-2 text-[13px] text-sf-label cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={handleChange('is_active')}
                  className="rounded border-black/[0.25] accent-[var(--sf-blue)]"
                />
                Active unit
              </label>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="secondary" type="button" onClick={closeModal} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                {mode === 'add' ? 'Add Unit' : 'Save Changes'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
