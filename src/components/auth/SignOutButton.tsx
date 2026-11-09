'use client';

import { createClient } from '@/lib/supabase/client';
import { detachBrowserPushSubscription } from '@/lib/notifications/browser';

// InvalidRefreshToken. Clearing those cookies turns it back into a clean
// logged-out state even if auth.signOut() itself fails or leaves a cookie
// behind — mirrors the login page's clearAuthCookies (src/app/(auth)/login/page.tsx).
function clearAuthCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name.startsWith('sb-')) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

interface SignOutButtonProps {
  label?: string;
  className?: string;
}

// Escape hatch for (auth)-group pages (access-denied, mfa-challenge) that
// never mount TopNav, so its sign-out is the only one in the app. Uses a full
// scratch on /login instead of carrying over stale client-side state.
export default function SignOutButton({ label = 'Sign out', className }: SignOutButtonProps) {
  async function handleSignOut() {
    try {
      await detachBrowserPushSubscription();
      await createClient().auth.signOut();
    } finally {
      clearAuthCookies();
      window.location.href = '/login';
    }
  }

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      {label}
    </button>
  );
}
