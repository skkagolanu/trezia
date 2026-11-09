'use client';

export async function detachBrowserPushSubscription(
  removeStoredEndpoint?: (endpoint: string) => Promise<void>,
): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    try {
      await removeStoredEndpoint?.(subscription.endpoint);
    } finally {
      await subscription.unsubscribe();
    }
  } catch {
    // Sign-out and tenant switching must continue even when browser push cleanup fails.
  }
}
