'use client';

import { useEffect } from 'react';

// Silently no-ops in browsers without SW support — this is a progressive
// enhancement, never a requirement for the app to function online.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failure (unsupported browser, blocked storage) is not
        // user-visible — the app works identically without offline support.
      });
    }
  }, []);
  return null;
}
