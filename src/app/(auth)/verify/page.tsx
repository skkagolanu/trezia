'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle } from 'lucide-react';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const supabase = createClient();
    const timer = setTimeout(() => {
      setStatus('error');
      setMessage('Link expired or already used.');
    }, 10000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        clearTimeout(timer);
        setStatus('success');
        setTimeout(() => router.push('/'), 1200);
      }
    });

    const error = searchParams.get('error_description');
    if (error) {
      clearTimeout(timer);
      setStatus('error');
      setMessage(error);
    }

    return () => { clearTimeout(timer); subscription.unsubscribe(); };
  }, [router, searchParams]);

  return (
    <div className="flex flex-col items-center gap-4">
      {status === 'verifying' && (
        <>
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-sf-blue/20 border-t-sf-blue" />
          <p className="text-[14px] text-sf-label2">Verifying your link…</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sf-green/[0.12]">
            <CheckCircle className="h-6 w-6 text-sf-green" strokeWidth={1.8} />
          </div>
          <div className="text-center">
            <p className="text-[17px] font-semibold text-sf-label">Signed in!</p>
            <p className="mt-1 text-[14px] text-sf-label2">Redirecting…</p>
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sf-red/[0.10]">
            <XCircle className="h-6 w-6 text-sf-red" strokeWidth={1.8} />
          </div>
          <div className="text-center">
            <p className="text-[17px] font-semibold text-sf-label">Verification failed</p>
            <p className="mt-1.5 max-w-[230px] text-[14px] leading-relaxed text-sf-label2">
              {message || 'The link may have expired or already been used.'}
            </p>
            <a
              href="/login"
              className="mt-5 inline-block rounded-[10px] bg-sf-blue px-5 py-2.5 text-[14px] font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Try again
            </a>
          </div>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sf-bg px-4">
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="flex h-[64px] w-[64px] items-center justify-center rounded-[18px] bg-sf-blue shadow-md">
          <span className="text-[28px] font-bold text-white">T</span>
        </div>
        <p className="text-[14px] text-sf-label2">Trezia</p>
      </div>

      <div className="w-full max-w-sm rounded-[20px] border border-black/[0.07] bg-sf-surface px-8 py-10 text-center">
        <Suspense
          fallback={
            <div className="flex flex-col items-center gap-4">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-sf-blue/20 border-t-sf-blue" />
              <p className="text-[14px] text-sf-label2">Loading…</p>
            </div>
          }
        >
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
