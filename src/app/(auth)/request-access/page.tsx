'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

interface Society { id: string; name: string }
interface Unit { id: string; flat_number: string }

export default function RequestAccessPage() {
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societyId, setSocietyId] = useState('');
  const [units, setUnits]         = useState<Unit[]>([]);
  const [unitId, setUnitId]       = useState('');
  const [email, setEmail]         = useState('');
  const [name, setName]           = useState('');
  const [phone, setPhone]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsRetry, setUnitsRetry] = useState(0);

  function loadSocieties(signal?: AbortSignal) {
    setOptionsLoading(true);
    setError(null);
    return fetch('/api/societies', { signal })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? 'Could not load societies. Please try again.');
        setSocieties(body.societies ?? []);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not load societies. Please try again.');
      })
      .finally(() => { if (!signal?.aborted) setOptionsLoading(false); });
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadSocieties(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setUnitId('');
    setUnits([]);
    if (!societyId) return;
    const controller = new AbortController();
    setUnitsLoading(true);
    setError(null);
    fetch(`/api/societies?society_id=${encodeURIComponent(societyId)}`, { signal: controller.signal })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? 'Could not load flats. Please try again.');
        setUnits(body.units ?? []);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not load flats. Please try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setUnitsLoading(false); });
    return () => controller.abort();
  }, [societyId, unitsRetry]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ society_id: societyId, unit_id: unitId, email, name: name || undefined, phone: phone || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Could not submit your request.');
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your request.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sf-bg px-4 py-12">
      <div className="w-full max-w-[400px]">
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sf-green/[0.12]">
              <CheckCircle2 className="h-6 w-6 text-sf-green" strokeWidth={1.8} />
            </div>
            <h1 className="text-[20px] font-semibold text-sf-label">Request sent</h1>
            <p className="mt-2 text-[14px] text-sf-label2">
              Your treasurer will review it and set up your access. You&rsquo;ll be able to sign in
              with <span className="font-medium text-sf-label">{email}</span> once approved.
            </p>
            <Link href="/login" className="mt-5 inline-block text-[13px] font-medium text-sf-blue hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[24px] font-bold text-sf-label">Request access</h1>
            <p className="mt-1 text-[14px] text-sf-label2">
              Tell your treasurer which flat is yours — they&rsquo;ll approve it and you&rsquo;re in.
            </p>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <Field label="Society">
                <select
                  required value={societyId}
                  onChange={e => setSocietyId(e.target.value)} disabled={optionsLoading}
                  className={inputCls}
                >
                  <option value="" disabled>Select your society</option>
                  {societies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Flat">
                <select
                  required value={unitId} disabled={!societyId || unitsLoading}
                  onChange={e => setUnitId(e.target.value)}
                  className={inputCls}
                >
                  <option value="" disabled>{unitsLoading ? 'Loading flats…' : units.length === 0 && societyId ? 'No flats available' : 'Select your flat'}</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.flat_number}</option>)}
                </select>
              </Field>
              <Field label="Email">
                <input type="email" required autoComplete="email" inputMode="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </Field>
              <Field label="Name (optional)">
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className={inputCls} />
              </Field>
              <Field label="Phone (optional)">
                <input type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile" className={inputCls} />
              </Field>
              {optionsLoading && <p role="status" className="text-[13px] text-sf-label3">Loading societies…</p>}
              {error && <p role="alert" className="text-[13px] text-sf-red">{error} <button type="button" onClick={() => societyId ? setUnitsRetry(value => value + 1) : void loadSocieties()} className="underline">Retry</button></p>}
              <button type="submit" disabled={loading || !societyId || !unitId || !email}
                className="mt-1 w-full rounded-[10px] bg-sf-blue py-3 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
                {loading ? 'Sending…' : 'Send request'}
              </button>
            </form>
            <Link href="/login" className="mt-5 block text-center text-[13px] text-sf-label3 hover:text-sf-label2 hover:underline">
              Already have access? Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls =
  'block w-full rounded-[10px] border border-black/[0.15] bg-sf-bg px-3.5 py-2.5 text-[15px] text-sf-label placeholder:text-sf-label3 transition-all focus:border-sf-blue focus:outline-none focus:ring-2 focus:ring-sf-blue/20 disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-sf-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
