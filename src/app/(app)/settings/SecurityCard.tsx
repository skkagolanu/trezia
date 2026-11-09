'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheck } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type Stage = 'loading' | 'off' | 'enrolling' | 'on';

// project, no new external account. Enrollment (this card) plus the
// login-time challenge (proxy.ts + /mfa-challenge) together implement it.
// Optional and per-user — the treasurer's father can leave this off.
export default function SecurityCard() {
  const [stage, setStage] = useState<Stage>('loading');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function refreshStatus() {
    const supabase = createClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) { setStage('off'); return; }
    const verified = data?.totp?.find(f => f.status === 'verified');
    setStage(verified ? 'on' : 'off');
  }

  useEffect(() => { void refreshStatus(); }, []);

  async function startEnroll() {
    setBusy(true);
    setError('');
    try {
      const supabase = createClient();

      // Clean up any stale unverified attempt — Supabase rejects a second
      // enroll() while one is pending.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.totp ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrollError) throw enrollError;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStage('enrolling');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start enrollment');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw verifyError;
      setCode('');
      setStage('on');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code — try again');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError('');
    setConfirmOpen(false);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.find(f => f.status === 'verified');
      if (verified) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
        if (unenrollError) throw unenrollError;
      }
      setStage('off');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
      <div className="border-b border-black/[0.06] px-6 py-4 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-sf-blue" strokeWidth={1.8} />
        <h3 className="text-[15px] font-semibold text-sf-label">Security</h3>
      </div>

      <div className="p-6">
        {error && <p className="mb-3 text-[13px] text-sf-red">{error}</p>}

        {stage === 'loading' && <p className="text-[13px] text-sf-label3">Loading…</p>}

        {stage === 'off' && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-sf-label">Two-factor sign-in</p>
              <p className="text-[12px] text-sf-label3 mt-0.5">Off — add an authenticator app for extra protection on this account</p>
            </div>
            <button
              onClick={startEnroll}
              disabled={busy}
              className="rounded-[10px] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              Enable
            </button>
          </div>
        )}

        {stage === 'on' && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-sf-label">Two-factor sign-in</p>
              <p className="text-[12px] text-sf-green mt-0.5">Enabled</p>
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              className="rounded-[10px] border border-black/[0.10] px-4 py-2 text-[13px] font-medium text-sf-label2 hover:bg-black/[0.04] disabled:opacity-60 transition-colors"
            >
              Disable
            </button>
          </div>
        )}

        {stage === 'enrolling' && (
          <div className="space-y-3">
            <p className="text-[13px] text-sf-label2">Scan this with your authenticator app (Google Authenticator, Authy, etc.):</p>
            {qrCode && (
              // Supabase returns a data:image/svg+xml URI it generates itself — safe as an <img> src, no markup ever passed to dangerouslySetInnerHTML.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCode} alt="Scan with your authenticator app" className="h-40 w-40 rounded-xl border border-black/[0.08]" />
            )}
            <p className="text-[11px] text-sf-label3 break-all">Can&rsquo;t scan? Enter manually: {secret}</p>
            <form onSubmit={confirmEnroll} className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                className="flex-1 rounded-[10px] border border-black/[0.15] bg-sf-bg px-3.5 py-2 text-[14px] tracking-widest text-sf-label placeholder:tracking-normal placeholder:text-sf-label3 focus:border-sf-blue focus:outline-none focus:ring-2 focus:ring-sf-blue/20"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="rounded-[10px] bg-sf-blue px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                Confirm
              </button>
            </form>
          </div>
        )}
      </div>

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="Turn off two-factor sign-in?" size="sm">
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--sf-label2)]">
            Signing in will no longer require a code from your authenticator app — only the magic link.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={disable} loading={busy}>Turn Off</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
