'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { societyFetch } from '@/lib/society-path';
import { IMPORT_STAGES, STAGE_DEFS, type ImportStage } from '@/lib/imports/stages';

interface ValidateSummary {
  stage: ImportStage;
  total_rows: number;
  valid: number;
  duplicates: number;
  errors: number;
  header_errors: string[];
  can_commit: boolean;
}

type Phase = 'select' | 'validated' | 'committed';

async function downloadCsv(apiPath: string, filename: string) {
  const res = await societyFetch(apiPath);
  if (!res.ok) { toast.error('Download failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export default function ImportWizard() {
  const [stage, setStage] = useState<ImportStage>('flats');
  const [phase, setPhase] = useState<Phase>('select');
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ValidateSummary | null>(null);
  const [result, setResult] = useState<{ committed: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const def = STAGE_DEFS[stage];

  function reset(nextStage: ImportStage = stage) {
    setStage(nextStage);
    setPhase('select');
    setFile(null);
    setBatchId(null);
    setSummary(null);
    setResult(null);
  }

  async function uploadAndValidate() {
    if (!file) { toast.error('Choose a CSV file first'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('stage', stage);
      const uploadRes = await societyFetch('/api/imports', { method: 'POST', body: fd });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) { toast.error(uploadJson.error ?? 'Upload failed'); return; }
      const id = uploadJson.batch_id as string;
      setBatchId(id);

      const valRes = await societyFetch(`/api/imports/${id}/validate`, { method: 'POST' });
      const valJson = await valRes.json().catch(() => ({}));
      if (!valRes.ok) { toast.error(valJson.error ?? 'Validation failed'); return; }
      setSummary(valJson as ValidateSummary);
      setPhase('validated');
    } catch {
      toast.error('Something went wrong — try again');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!batchId) return;
    setBusy(true);
    try {
      const res = await societyFetch(`/api/imports/${batchId}/commit`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? 'Commit failed'); return; }
      setResult({ committed: json.committed ?? 0, skipped: json.skipped ?? 0 });
      setPhase('committed');
      toast.success(`Imported ${json.committed ?? 0} ${def.label.toLowerCase()}`);
    } catch {
      toast.error('Something went wrong — try again');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!batchId) { reset(); return; }
    setBusy(true);
    try {
      const res = await societyFetch(`/api/imports/${batchId}/cancel`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? 'Could not cancel the import'); return; }
      reset();
    } catch {
      toast.error('Could not cancel the import — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Stage selector */}
      <div className="rounded-2xl border border-black/[0.07] bg-sf-surface p-5">
        <h3 className="text-[15px] font-semibold text-sf-label">1 · Choose what to import</h3>
        <p className="mt-1 text-[13px] text-sf-label2">This is the recommended order because later stages can reference earlier ones (residents and payments need existing flats).</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {IMPORT_STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => reset(s)}
              className={[
                'h-9 px-3 flex items-center gap-1.5 rounded-[var(--radius-md)] text-[13px] font-medium transition-all',
                s === stage ? 'bg-sf-label text-white' : 'border border-sf-border text-sf-label2 hover:bg-[rgba(144,174,173,0.12)]',
              ].join(' ')}
            >
              <span className="opacity-60">{i + 1}</span>
              {STAGE_DEFS[s].label}
              {STAGE_DEFS[s].financial && <span className="text-[10px] uppercase tracking-wide opacity-70">₹</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Template + upload */}
      <div className="rounded-2xl border border-black/[0.07] bg-sf-surface p-5">
        <h3 className="text-[15px] font-semibold text-sf-label">2 · Prepare and upload the {def.label} CSV</h3>
        <p className="mt-1 text-[13px] text-sf-label2">
          Download the template, fill one row per record keeping the header row exactly as-is, then upload it. Columns marked required must be present.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-sf-label2">
          {def.columns.map(c => (
            <span key={c.key} className="rounded-full border border-sf-border px-2 py-0.5">
              {c.key}{c.required ? <span className="text-sf-red"> *</span> : ''}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => downloadCsv(`/api/imports/templates/${stage}`, `template-${stage}.csv`)}
            className="rounded-[var(--radius-md)] border border-sf-border px-3 py-2 text-[13px] font-medium text-sf-label hover:bg-[rgba(144,174,173,0.12)]"
          >
            Download template
          </button>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy || phase !== 'select'}
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="text-[13px] text-sf-label2 file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-sf-label file:px-3 file:py-2 file:text-white"
          />
          <button
            type="button"
            disabled={busy || !file || phase !== 'select'}
            onClick={uploadAndValidate}
            className="rounded-[var(--radius-md)] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {busy && phase === 'select' ? 'Checking…' : 'Upload & check'}
          </button>
        </div>
      </div>

      {/* Dry-run result */}
      {phase === 'validated' && summary && (
        <div className="rounded-2xl border border-black/[0.07] bg-sf-surface p-5">
          <h3 className="text-[15px] font-semibold text-sf-label">3 · Review before saving</h3>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[10px] border border-sf-border p-3">
              <div className="text-[20px] font-semibold text-sf-green">{summary.valid}</div>
              <div className="text-[12px] text-sf-label2">will import</div>
            </div>
            <div className="rounded-[10px] border border-sf-border p-3">
              <div className="text-[20px] font-semibold text-sf-label2">{summary.duplicates}</div>
              <div className="text-[12px] text-sf-label2">already exist (skipped)</div>
            </div>
            <div className="rounded-[10px] border border-sf-border p-3">
              <div className="text-[20px] font-semibold text-sf-red">{summary.errors}</div>
              <div className="text-[12px] text-sf-label2">have errors</div>
            </div>
          </div>

          {summary.header_errors.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-[10px] border border-sf-red/20 bg-sf-red/[0.06] p-3 text-[13px] text-sf-red">
              {summary.header_errors.map(err => <li key={err}>{err}</li>)}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {summary.errors > 0 && batchId && (
              <button
                type="button"
                onClick={() => downloadCsv(`/api/imports/${batchId}/errors`, `import-${stage}-errors.csv`)}
                className="rounded-[var(--radius-md)] border border-sf-border px-3 py-2 text-[13px] font-medium text-sf-label hover:bg-[rgba(144,174,173,0.12)]"
              >
                Download error rows
              </button>
            )}
            <button
              type="button"
              disabled={busy || !summary.can_commit}
              onClick={commit}
              className="rounded-[var(--radius-md)] bg-sf-green px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Importing…' : `Import ${summary.valid} row${summary.valid === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="rounded-[var(--radius-md)] border border-sf-border px-3 py-2 text-[13px] font-medium text-sf-label2 hover:bg-[rgba(144,174,173,0.12)]"
            >
              Cancel
            </button>
          </div>
          {def.financial && (
            <p className="mt-3 text-[12px] text-sf-label2">A one-time safety backup is taken automatically before the first financial import. Imported records can be voided later but not bulk-deleted.</p>
          )}
        </div>
      )}

      {/* Done */}
      {phase === 'committed' && result && (
        <div className="rounded-2xl border border-sf-green/30 bg-sf-green/[0.06] p-5">
          <h3 className="text-[15px] font-semibold text-sf-label">Imported</h3>
          <p className="mt-1 text-[13px] text-sf-label2">
            {result.committed} {def.label.toLowerCase()} imported{result.skipped > 0 ? `, ${result.skipped} already existed and were skipped` : ''}.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-3 rounded-[var(--radius-md)] bg-sf-label px-4 py-2 text-[13px] font-semibold text-white"
          >
            Import another stage
          </button>
        </div>
      )}
    </div>
  );
}
