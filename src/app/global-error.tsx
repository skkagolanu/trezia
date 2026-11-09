'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Root-level fallback — only fires if the root layout itself (or a route
// outside every other error.tsx boundary, e.g. auth pages) throws. Must
// render its own <html>/<body> since it replaces the entire root layout.
// Plain inline styles: globals.css / CSS variables come from the layout this
// file is replacing, so they can't be relied on here.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#244855', margin: 0 }}>Something went wrong</p>
          <p style={{ fontSize: 14, color: '#874F41', marginTop: 8 }}>
            Please refresh the page. {error.digest ? `(error ${error.digest})` : ''}
          </p>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <button
              onClick={reset}
              style={{ height: 36, padding: '0 16px', borderRadius: 8, background: '#E64833', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Try again
            </button>
            <a
              href="/login"
              style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid #d0d0d0', color: '#874F41', fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Go to sign-in
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
