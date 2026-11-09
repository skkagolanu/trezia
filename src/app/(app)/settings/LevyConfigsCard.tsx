'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import type { LevyConfig } from '@/types/database';
import { labelDisplay } from '@/lib/utils/levy-label';

interface Props {
  configs: LevyConfig[];
}

type RaisePreview = { totalUnits: number; alreadyAssessed: number; toCreate: number };

// Shows what raise_levy_assessment (migration 067) will actually do — how many
// flats get a new obligation row, at what amount — before the treasurer
// commits to it. GET /api/levy-assessments does the counting; nothing here writes.
function RaiseLevyModal({ config, onClose, onRaised }: { config: LevyConfig; onClose: () => void; onRaised: () => void }) {
  const [amount, setAmount] = useState(String(config.default_amount));
  const [preview, setPreview] = useState<RaisePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    setError('');
    societyFetch(`/api/levy-assessments?levy_label=${encodeURIComponent(config.levy_label)}`)
      .then(async res => {
        if (!res.ok) throw new Error('Could not load a preview');
        return res.json() as Promise<RaisePreview>;
      })
      .then(data => { if (!cancelled) setPreview(data); })
      .catch(() => { if (!cancelled) setError('Could not load a preview. You can still raise the AMC.'); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [config.levy_label]);

  async function raise() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid amount'); return; }
    setRaising(true);
    setError('');
    try {
      const res = await societyFetch('/api/levy-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levy_label: config.levy_label, amount: parsed }),
      });
      const json = await res.json() as { created_count?: number; skipped_count?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to raise the AMC');
      toast.success(
        `Raised ${labelDisplay(config.levy_label)} for ${json.created_count ?? 0} flat${json.created_count === 1 ? '' : 's'}`
        + ((json.skipped_count ?? 0) > 0 ? ` · ${json.skipped_count} already had it` : ''),
      );
      onRaised();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise the AMC');
    } finally {
      setRaising(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Raise ${labelDisplay(config.levy_label)}`} size="sm">
      <div className="space-y-3">
        <p className="text-[13px] text-sf-label3">
          This charges every active flat in your society this amount as a new due for {labelDisplay(config.levy_label)}. Flats that
          already have this AMC due are left untouched.
        </p>
        <div>
          <label htmlFor="raise-levy-amount" className="block text-[12px] font-medium text-sf-label3 mb-1">Amount per flat</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-sf-label3">₹</span>
            <input
              id="raise-levy-amount"
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full h-9 rounded-[10px] border border-black/[0.18] bg-sf-surface pl-7 pr-3 text-[14px] text-sf-label focus:outline-none focus:ring-2 focus:ring-sf-blue"
            />
          </div>
        </div>
        {loadingPreview ? (
          <p className="text-[13px] text-sf-label3">Loading preview…</p>
        ) : preview ? (
          <p className="text-[13px] text-sf-label2">
            Will raise for <span className="font-semibold text-sf-label">{preview.toCreate}</span> of {preview.totalUnits} active flat{preview.totalUnits === 1 ? '' : 's'}
            {preview.alreadyAssessed > 0 ? ` — ${preview.alreadyAssessed} already have this AMC and will be skipped.` : '.'}
          </p>
        ) : null}
        {error && <p role="alert" className="text-[13px] text-sf-red">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="secondary" onClick={onClose} disabled={raising}>Cancel</Button>
          <Button onClick={() => void raise()} loading={raising} disabled={loadingPreview || (preview !== null && preview.toCreate === 0)}>
            Raise{preview ? ` for ${preview.toCreate} flat${preview.toCreate === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LevyRow({ config, onSaved, onRaised }: { config: LevyConfig; onSaved: () => void; onRaised: () => void }) {
  const [amount, setAmount]   = useState(String(config.default_amount));
  const [saving, setSaving]   = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);

  async function save() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const res = await societyFetch(`/api/levy-configs/${config.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_amount: parsed }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? 'Save failed');
      }
      toast.success(`${labelDisplay(config.levy_label)} default updated`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const isDirty = parseFloat(amount) !== Number(config.default_amount);

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[var(--sf-divider)] last:border-0">
      <span className="w-32 text-[14px] font-medium text-sf-label shrink-0">{labelDisplay(config.levy_label)}</span>
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-sf-label3">₹</span>
        <input
          type="number"
          min="0"
          step="1"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full rounded-[10px] border border-black/[0.18] bg-sf-surface pl-7 pr-3 py-2 text-[14px] text-sf-label transition-all hover:border-black/[0.28] focus:outline-none focus:ring-2 focus:ring-sf-blue"
        />
      </div>
      <button
        onClick={save}
        disabled={saving || !isDirty}
        className="h-9 px-3 rounded-[10px] bg-sf-blue text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setRaiseOpen(true)}
        className="h-9 px-3 rounded-[10px] border border-black/[0.12] text-[13px] font-medium text-sf-label2 hover:bg-black/[0.04] transition-colors shrink-0"
        title={`Charge every flat for ${labelDisplay(config.levy_label)}`}
      >
        Raise
      </button>
      {raiseOpen && (
        <RaiseLevyModal
          config={config}
          onClose={() => setRaiseOpen(false)}
          onRaised={onRaised}
        />
      )}
    </div>
  );
}

function AddLevyForm({ onAdded }: { onAdded: () => void }) {
  const [year, setYear]       = useState('');
  const [amount, setAmount]   = useState('');
  const [saving, setSaving]   = useState(false);

  const trimmedLabel = /^20[0-9]{2}$/.test(year) ? `AMC-${year}` : '';

  async function add() {
    if (!trimmedLabel || !amount) { toast.error('Enter a four-digit year and amount'); return; }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) { toast.error('Enter a valid amount'); return; }

    setSaving(true);
    try {
      const res = await societyFetch('/api/levy-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levy_label: trimmedLabel, default_amount: parsed }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? 'Failed to add AMC');
      }
      toast.success(`${trimmedLabel} added`);
      setYear(''); setAmount('');
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-3 mt-1 border-t border-[var(--sf-divider)]">
      <p className="text-[13px] font-medium text-sf-label mb-3">Add an AMC year</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={year}
            onChange={e => setYear(e.target.value.replace(/\D/g, ''))}
            placeholder="Year"
            aria-label="AMC year"
            className="w-full h-9 rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 text-[14px] text-sf-label placeholder:text-sf-label3 focus:outline-none focus:ring-2 focus:ring-sf-blue"
          />
        </div>
        {/* Amount */}
        <div className="relative w-32">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-sf-label3">₹</span>
          <input
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0"
            className="w-full h-9 rounded-[10px] border border-black/[0.18] bg-sf-surface pl-7 pr-3 text-[14px] text-sf-label placeholder:text-sf-label3 focus:outline-none focus:ring-2 focus:ring-sf-blue"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={saving || !trimmedLabel || !amount}
          className="h-9 px-4 rounded-[10px] bg-sf-blue text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
        >
          {saving ? 'Adding…' : `Add ${trimmedLabel || 'AMC'}`}
        </button>
      </div>
    </div>
  );
}

export default function LevyConfigsCard({ configs }: Props) {
  const router = useRouter();

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-[15px] font-semibold text-sf-label">Annual Maintenance Contract (AMC)</h2>
        <Tooltip text="Set the AMC amount for each year, then raise it once to add the due to every active flat." />
      </div>
      {configs.length > 0 ? (
        <div>
          {configs.map(c => (
            <LevyRow key={c.id} config={c} onSaved={refresh} onRaised={refresh} />
          ))}
        </div>
      ) : (
        <p className="text-[14px] text-sf-label3 py-4 text-center">No AMC year configured yet.</p>
      )}
      <AddLevyForm onAdded={refresh} />
    </Card>
  );
}
