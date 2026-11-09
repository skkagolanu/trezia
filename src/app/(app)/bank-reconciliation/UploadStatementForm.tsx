'use client';
import { societyFetch } from '@/lib/society-path';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';

export default function UploadStatementForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a CSV file first');
      return;
    }
    setLoading(true);
    try {
      const csv_text = await file.text();
      const res = await societyFetch('/api/bank-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, csv_text }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; parsed?: number; skippedLines?: number[] };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      toast.success(
        `Imported ${data.parsed} rows` +
        (data.skippedLines?.length ? ` — ${data.skippedLines.length} rows skipped (unparseable)` : ''),
      );
      if (fileRef.current) fileRef.current.value = '';
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form data-society-write onSubmit={handleUpload} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium text-sf-label">Bank Statement CSV</label>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="text-[13px] text-sf-label2 file:mr-3 file:rounded-[8px] file:border-0 file:bg-sf-blue file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-white hover:file:opacity-90 file:cursor-pointer"
        />
        <p className="text-[12px] text-sf-label3">
          Header row with <code>Date, Description, Amount</code> (or <code>Debit</code>/<code>Credit</code>) columns.
        </p>
      </div>
      <Button type="submit" loading={loading}>Import Statement</Button>
    </form>
  );
}
