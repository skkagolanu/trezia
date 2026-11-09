'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { societyFetch } from '@/lib/society-path';

type SubscribeInfo = { vapidPublicKey: string | null; enabled: boolean; subscribed: boolean };

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

// web-push's applicationServerKey must be a Uint8Array, but the VAPID public
// key travels over the wire as URL-safe base64 — this is the standard decode.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  // Back the view with an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer>
  // (assignable to applicationServerKey's BufferSource), not the ambiguous ArrayBufferLike.
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function applicationServerKeyMatches(subscription: PushSubscription, expected: Uint8Array<ArrayBuffer>): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

async function persistSubscription(subscription: PushSubscription): Promise<Response> {
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('The browser returned an incomplete notification subscription.');

  return societyFetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: navigator.userAgent,
    }),
  });
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof body?.error === 'string' && body.error.length > 0
    ? body.error
    : 'Could not save the browser subscription.';
  return new Error(message);
}

async function forgetStoredSubscription(subscription: PushSubscription): Promise<void> {
  await societyFetch('/api/notifications/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
}

export default function NotificationOptIn() {
  const [info, setInfo] = useState<SubscribeInfo | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!pushSupported()) {
        setChecked(true);
        return;
      }
      try {
        let existing: PushSubscription | null = null;
        if (Notification.permission === 'granted') {
          const reg = await navigator.serviceWorker.ready;
          existing = await reg.pushManager.getSubscription();
        }
        const endpoint = existing ? `?endpoint=${encodeURIComponent(existing.endpoint)}` : '';
        const response = await societyFetch(`/api/notifications/subscribe${endpoint}`);
        if (!response.ok) throw new Error('failed');
        const data = (await response.json()) as SubscribeInfo;
        if (cancelled) return;
        setInfo(data);

        const expectedKey = data.vapidPublicKey ? urlBase64ToUint8Array(data.vapidPublicKey) : null;
        setSubscribed(Boolean(existing && expectedKey && data.subscribed && applicationServerKeyMatches(existing, expectedKey)));
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setChecked(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!info?.vapidPublicKey) {
      toast.error('Notifications are not available right now.');
      return;
    }
    setLoading(true);
    let createdSubscription: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast.error('Notification permission was not granted.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const expectedKey = urlBase64ToUint8Array(info.vapidPublicKey);
      let subscription = await registration.pushManager.getSubscription();

      if (subscription && !applicationServerKeyMatches(subscription, expectedKey)) {
        await forgetStoredSubscription(subscription);
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey,
        });
        createdSubscription = subscription;
      }

      let response = await persistSubscription(subscription);
      if (response.status === 409) {
        // A shared browser may still hold another account's endpoint. Never
        // service for a fresh endpoint owned by the current account instead.
        await subscription.unsubscribe();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey,
        });
        createdSubscription = subscription;
        response = await persistSubscription(subscription);
      }
      if (!response.ok) {
        throw await responseError(response);
      }

      createdSubscription = null;
      setSubscribed(true);
      toast.success('Notifications enabled');
    } catch (error) {
      if (createdSubscription) await createdSubscription.unsubscribe().catch(() => false);
      const message = error instanceof Error && error.message
        ? error.message
        : 'Could not enable notifications. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (!checked) return null;
  if (!pushSupported() || !info?.enabled || !info.vapidPublicKey) return null;

  if (subscribed) {
    return (
      <div className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] bg-black/[0.06] px-3 text-[var(--text-sm)] text-[var(--sf-label)]">
        <BellRing size={14} aria-hidden="true" className="text-[var(--sf-green)]" />
        Notifications on
      </div>
    );
  }

  return (
    <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={enable} isLoading={loading}>
      <Bell size={14} aria-hidden="true" />
      Enable notifications
    </Button>
  );
}
