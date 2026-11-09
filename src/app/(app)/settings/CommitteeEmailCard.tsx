'use client';
import { societyFetch } from '@/lib/society-path';
import { useState } from 'react';

function parseEmails(raw: string): string[] {
  return raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

// Treasurer-triggered committee summary email. Recipients are typed
// each time rather than saved — no distribution-list table exists yet, and
// Always summarises the previous calendar month.
export default function CommitteeEmailCard() {
  const [recipients, setRecipients] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const emails = parseEmails(recipients);

  async function handleSend() {
    setSending(true);
    setMessage('');
    setError('');
    try {
      const res = await societyFetch('/api/settings/committee-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send');
      setMessage(`Sent — ${data.periodLabel} summary to ${data.sentTo} recipient${data.sentTo !== 1 ? 's' : ''}.`);
      setRecipients('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending email');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h3 className="text-[15px] font-semibold text-sf-label">Committee Summary Email</h3>
        <p className="text-[12px] text-sf-label3 mt-0.5">Send last month&apos;s receipts &amp; payments summary to the committee</p>
      </div>
      <div className="p-6 space-y-3">
        <textarea
          value={recipients}
          onChange={e => setRecipients(e.target.value)}
          placeholder="committee@example.com, president@example.com"
          rows={2}
          className="w-full rounded-[10px] border border-black/[0.12] px-3 py-2 text-[14px] text-sf-label placeholder:text-sf-label3 focus:outline-none focus:ring-2 focus:ring-sf-blue"
        />
        <p className="text-[12px] text-sf-label3">Comma or newline separated. Not saved — type them each time.</p>
        {message && <p className="text-[13px] text-sf-green">{message}</p>}
        {error && <p className="text-[13px] text-sf-red">{error}</p>}
        <button
          onClick={handleSend}
          disabled={sending || emails.length === 0}
          className="inline-flex items-center gap-2 rounded-[10px] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {sending ? 'Sending…' : `Send to ${emails.length || ''} recipient${emails.length === 1 ? '' : 's'}`.trim()}
        </button>
      </div>
    </div>
  );
}
