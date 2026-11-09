'use client';
import { useState, useEffect, useRef } from 'react';
import { Mail, ArrowRight } from 'lucide-react';

// @supabase/ssr hardcodes flowType:'pkce' in createBrowserClient and cannot be overridden.
// that opens links in its own WebView. Using raw supabase-js with implicit flow here means
// signInWithOtp sends no code_challenge, so Supabase issues a plain token_hash (not pkce_xxx).
async function createOtpClient() {
  // Authentication is the only action on this page that needs Supabase. Keep
  // the SDK out of the initial login bundle and load it after form submission.
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false } },
  );
}

const RESEND_COOLDOWN_S = 60;

// InvalidRefreshToken. Clearing those cookies turns it back into a clean logged-out
// state — the one thing a non-technical user would otherwise need devtools for.
function clearAuthCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name.startsWith('sb-')) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setError('That link expired or was already used. Send a fresh one below.');
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [cooldown]);

  async function sendLink() {
    setLoading(true);
    setError(null);
    try {
      const supabase = await createOtpClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (otpError) throw otpError;
      setSent(true);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendLink();
  }

  function handleReset() {
    clearAuthCookies();
    window.location.href = '/login';
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-sf-bg md:grid-cols-2">
      {/* Left brand panel — desktop only */}
      <aside className="hidden flex-col justify-between bg-sf-label px-10 py-12 md:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/15">
            <span className="text-[16px] font-bold text-white">T</span>
          </div>
          <span className="text-[16px] font-bold tracking-tight text-white">Trezia</span>
        </div>
        <div>
          <p className="text-[26px] font-bold leading-snug text-white">
            Your society&rsquo;s books,<br />safe and shareable.
          </p>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/70">
            Maintenance, dues, receipts, and a printable balance sheet — signed in with a
            one-tap email link, nothing to remember.
          </p>
        </div>
        <p className="text-[13px] text-white/70">No ads · No data resale · Your data stays yours</p>
      </aside>

      {/* Right form panel */}
      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        {/* Mobile brand */}
        <div className="mb-8 flex items-center gap-2.5 md:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sf-blue">
            <span className="text-[16px] font-bold text-white">T</span>
          </div>
          <span className="text-[16px] font-bold tracking-tight text-sf-label">Trezia</span>
        </div>

        <div className="w-full max-w-[380px]">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sf-blue/[0.10]">
                <Mail className="h-5 w-5 text-sf-blue" strokeWidth={1.8} />
              </div>
              <p className="text-[19px] font-semibold text-sf-label">Check your email</p>
              <p className="mt-2 text-[14px] text-sf-label2">
                Sign-in link sent to <span className="font-medium text-sf-label">{email}</span>.
                Tap it to sign in — you can close this tab.
              </p>
              <button
                onClick={sendLink}
                disabled={loading || cooldown > 0}
                className="mt-5 text-[13px] font-medium text-sf-blue hover:underline disabled:text-sf-label3 disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
              </button>
              <div className="mt-1.5">
                <button
                  onClick={() => { setSent(false); setError(null); }}
                  className="text-[13px] text-sf-label3 hover:text-sf-label2 hover:underline"
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-[24px] font-bold text-sf-label">Sign in</h1>
              <p className="mt-1 text-[14px] text-sf-label2">
                We&rsquo;ll email you a link — no password to remember.
              </p>
              <form onSubmit={handleSubmit} className="mt-6">
                <label htmlFor="email" className="text-[13px] font-medium text-sf-label">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (error) setError(null); }}
                  placeholder="you@example.com"
                  className="mt-1.5 block w-full rounded-[10px] border border-black/[0.15] bg-sf-bg px-3.5 py-2.5 text-[15px] text-sf-label placeholder:text-sf-label3 transition-all focus:border-sf-blue focus:outline-none focus:ring-2 focus:ring-sf-blue/20 hover:border-black/[0.25]"
                />
                {error && (
                  <p id="login-error" role="alert" className="mt-2 text-[13px] text-sf-red">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] bg-sf-blue py-3 text-[15px] font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-sf-blue/30 focus:ring-offset-2 disabled:opacity-40 transition-opacity"
                >
                  {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <>
                      Send magic link
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 flex flex-col gap-2 border-t border-black/[0.07] pt-5 text-center text-[13px]">
                <a href="/api/demo/start" className="font-medium text-sf-blue hover:underline">
                  Try the demo instead
                </a>
                <a href="/request-access" className="font-medium text-sf-blue hover:underline">
                  New resident? Request access
                </a>
                <button onClick={handleReset} className="text-sf-label3 hover:text-sf-label2 hover:underline">
                  Trouble signing in? Reset and try again
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
