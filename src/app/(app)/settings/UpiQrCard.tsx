'use client';
import { societyFetch, societyApiPath } from '@/lib/society-path';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Card from '@/components/ui/Card';

const MAX_BYTES = 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

interface Props {
  hasQr: boolean;
}

export default function UpiQrCard({ hasQr }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Computed lazily so this only ever runs client-side, after mount, where
  // window.location is available — a server-rendered src would break the
  // society-scoped rewrite on first paint.
  const [imgSrc] = useState(() =>
    typeof window === 'undefined' ? '/api/society/upi-qr' : societyApiPath(window.location.pathname, '/api/society/upi-qr')
  );

  function handleFileChange(selected: File | null) {
    if (!selected) { setFile(null); return; }
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast.error('Upload a JPEG or PNG image.');
      return;
    }
    if (selected.size > MAX_BYTES) {
      toast.error('Image must be 1 MB or smaller.');
      return;
    }
    setFile(selected);
  }

  async function handleSave() {
    if (!file) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('qr', file);
      const res = await societyFetch('/api/society/upi-qr', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to save QR');
      toast.success('UPI QR saved');
      setFile(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save QR');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove the UPI QR? Residents will no longer see it on My Flat.')) return;
    setRemoving(true);
    try {
      const res = await societyFetch('/api/society/upi-qr', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to remove QR');
      toast.success('UPI QR removed');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove QR');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card title="UPI payment QR">
      <p className="text-[13px] text-sf-label3 mb-4 -mt-1">
        A bank-issued static QR does not carry an amount — residents will need to type the amount
        themselves when they scan it.
      </p>

      {hasQr && (
        <img
          src={imgSrc}
          alt="Current UPI payment QR"
          className="max-w-[220px] rounded-[10px] border border-black/[0.12] mb-4"
        />
      )}

      <div className="space-y-3">
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px] text-sf-label file:mr-3 file:rounded-[10px] file:border-0 file:bg-black/[0.06] file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-sf-label"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !file}
            className="inline-flex items-center gap-2 rounded-[10px] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {hasQr && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="inline-flex items-center gap-2 rounded-[10px] bg-black/[0.06] px-4 py-2 text-[13px] font-semibold text-sf-label hover:bg-black/[0.10] disabled:opacity-40 transition-colors"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
