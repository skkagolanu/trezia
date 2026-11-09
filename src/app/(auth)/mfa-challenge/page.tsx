'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheck } from 'lucide-react';
import SignOutButton from '@/components/auth/SignOutButton';

// Step two of sign-in for the (small, opt-in) set of accounts with TOTP MFA
// at aal1 but a verified factor requires aal2 (see proxy.ts's mfaPending
// check), and redirects straight past this page — server-side, on every
// request — once nothing is pending, so there's no client-side dead-end
// case to guard against here.
export default function MfaChallengePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors?.totp?.find(f => f.status === 'verified');
      if (!factor) throw new Error('No verified authenticator found for this account.');

      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verifyError) throw verifyError;

      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sf-bg px-4">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sf-blue/[0.10]">
          <ShieldCheck className="h-5 w-5 text-sf-blue" strokeWidth={1.8} />
        </div>
        <h1 className="text-[20px] font-semibold text-sf-label">Enter your code</h1>
        <p className="max-w-[280px] text-center text-[13px] text-sf-label3">
          Open your authenticator app and enter the 6-digit code for this account.
        </p>
      </div>

      <div className="w-full max-w-[320px] rounded-[20px] border border-black/[0.07] bg-sf-surface px-8 py-8">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="block w-full rounded-[10px] border border-black/[0.15] bg-sf-bg px-3.5 py-2.5 text-center text-[20px] tracking-[0.3em] text-sf-label placeholder:text-sf-label3 focus:border-sf-blue focus:outline-none focus:ring-2 focus:ring-sf-blue/20"
          />
          {error && <p className="mt-2 text-[13px] text-sf-red">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="mt-4 flex w-full items-center justify-center rounded-[10px] bg-sf-blue py-3 text-[15px] font-semibold text-white hover:opacity-90 active:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>

      <div className="mt-6 text-center">
        <p className="text-[13px] text-sf-label3">Lost your authenticator?</p>
        <SignOutButton
          label="Sign out and start over"
          className="text-[13px] font-medium text-sf-blue hover:underline"
        />
      </div>
    </div>
  );
}
