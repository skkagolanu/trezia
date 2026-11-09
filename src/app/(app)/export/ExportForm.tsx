'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { societyFetch } from '@/lib/society-path';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function ExportForm({ canManageBackups }: { canManageBackups: boolean }) {
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo]     = useState(todayISO());
  const [busy, setBusy] = useState<string | null>(null);

  const [error, setError] = useState('');

  async function download(type: string, useRange = false) {
    setBusy(type);
    setError('');
    const params = new URLSearchParams({ type });
    if (useRange) {
      params.set('from', from);
      params.set('to', to);
    }
    try {
      const response = await societyFetch(`/api/export?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Unable to prepare this export');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? `trezia-${type}.${type === 'backup' ? 'json' : 'csv'}`;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      toast.success(type === 'backup' ? 'Complete export ready' : 'Download ready');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to prepare export'); }
    finally { setBusy(null); }
  }

  const inputCls = 'rounded-[10px] border border-black/[0.18] bg-sf-surface px-3 py-2 text-[14px] text-sf-label focus:outline-none focus:ring-2 focus:ring-sf-blue transition-all hover:border-black/[0.28]';

  return (
    <div className="max-w-3xl space-y-6">

      <div className="rounded-xl border border-sf-red/[0.30] bg-sf-red/[0.06] px-4 py-3">
        <p className="text-[13px] font-semibold text-sf-red mb-0.5">Contains personal data</p>
        <p className="text-[13px] text-sf-label2 leading-relaxed">
          These exports include resident names, phone numbers, and email addresses.
          Do not share them outside the society committee. Store downloaded files securely and delete them when no longer needed.
        </p>
      </div>

      <Card title="Date Range (applies to Payments &amp; Expenses exports)">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-sf-label2">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-sf-label2">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </div>
        </div>
      </Card>

      <Card title="Downloads">
        <div className="space-y-3">
          {canManageBackups && <ExportRow
            label="Data + artifact manifest"
            description="Versioned JSON containing every society table and a verified inventory of private attachments and stored artifacts. Artifact bytes remain private and are retrieved separately through authenticated downloads."
            onDownload={() => download('backup')}
            loading={busy === 'backup'}
            highlight
          />}
          <ExportRow
            label="Payments CSV"
            description="All transactions with receipt numbers, modes, UTR references, and hash values."
            onDownload={() => download('payments', true)}
            loading={busy === 'payments'}
          />
          <ExportRow
            label="Expenses CSV"
            description="All expenditures with category, payee, and reference numbers."
            onDownload={() => download('expenses', true)}
            loading={busy === 'expenses'}
          />
          <ExportRow
            label="Current Dues CSV"
            description="All flats with outstanding amounts as of today."
            onDownload={() => download('dues')}
            loading={busy === 'dues'}
          />
        </div>
      </Card>

      {error && <div role="alert" className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sf-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-red)_6%,var(--sf-surface))] p-3 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</div>}

      <div className="rounded-xl border border-sf-orange/[0.25] bg-sf-orange/[0.07] p-4 text-[14px] text-sf-label">
        <p className="font-semibold mb-1">Legal retention reminder</p>
        <p className="text-sf-label2">Indian accounting law requires financial records to be retained for 8 years. Download a full backup at the end of each financial year (March 31) and store it offline.</p>
      </div>
    </div>
  );
}

function ExportRow({
  label,
  description,
  onDownload,
  loading,
  highlight = false,
}: {
  label: string;
  description: string;
  onDownload: () => void;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`flex flex-col items-stretch justify-between gap-3 rounded-[10px] p-3 sm:flex-row sm:items-center ${highlight ? 'bg-sf-blue/[0.05] border border-sf-blue/[0.15]' : 'bg-sf-bg border border-black/[0.06]'}`}>
      <div>
        <p className={`text-[14px] font-semibold ${highlight ? 'text-sf-blue' : 'text-sf-label'}`}>{label}</p>
        <p className="text-[13px] text-sf-label2 mt-0.5">{description}</p>
      </div>
      <Button
        onClick={onDownload}
        disabled={loading}
        variant={highlight ? 'primary' : 'secondary'}
        size="sm"
        className="min-h-11 w-full shrink-0 sm:w-auto"
      >
        {loading ? 'Downloading…' : 'Download'}
      </Button>
    </div>
  );
}
