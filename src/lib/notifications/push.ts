import 'server-only';

// Web Push delivery for resident/admin notifications. Mirrors the env-gated,
// no-throw-on-missing-config style of src/lib/payments/razorpay.ts: the feature
// stays dark until all three VAPID env vars are set, so the app runs identically
// with or without push configured. Credentials live in env vars only — never in
// the DB, never in NEXT_PUBLIC_*.
//
// NOTE: this file is intentionally never imported from client components — it
// pulls in `web-push`, which itself depends on Node's `https` module and cannot
// be bundled for the browser. The `server-only` guard above enforces that boundary.

import webpush, { WebPushError } from 'web-push';

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function readConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;

  // Presence alone is not configuration. web-push applies the canonical
  // subject/base64url/key-length validation here; keeping invalid values dark
  // prevents the browser from being offered a key that subscribe() must reject.
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

// True only when every VAPID credential is present. Callers gate the
// "enable notifications" UI and the send path on this.
export function pushEnabled(): boolean {
  return readConfig() !== null;
}

// The client needs the public key to call pushManager.subscribe(). Returns
// null (not throws) so a caller can render a "not available" state instead
// of a hard failure when the feature is dark.
export function getVapidPublicKey(): string | null {
  return readConfig()?.publicKey ?? null;
}

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
};

export type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

const PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_HOSTS.has(host) || host.endsWith('.notify.windows.com');
  } catch {
    return false;
  }
}

function decodedBase64UrlBytes(value: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length;
  } catch {
    return null;
  }
}

export function hasValidPushKeys(keys: WebPushSubscription['keys']): boolean {
  return decodedBase64UrlBytes(keys.p256dh) === 65 && decodedBase64UrlBytes(keys.auth) === 16;
}

export type SendPushResult = {
  ok: boolean;
  // True when the push service reports the subscription no longer exists
  // (404/410) — the caller should delete the stored subscription row.
  gone: boolean;
};

export async function sendPush(
  sub: WebPushSubscription,
  message: PushMessage
): Promise<SendPushResult> {
  const config = readConfig();
  if (!config) return { ok: false, gone: false };
  if (!isAllowedPushEndpoint(sub.endpoint) || !hasValidPushKeys(sub.keys)) return { ok: false, gone: true };

  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    await webpush.sendNotification(sub, JSON.stringify(message));
    return { ok: true, gone: false };
  } catch (error) {
    if (error instanceof WebPushError) {
      const gone = error.statusCode === 404 || error.statusCode === 410;
      if (!gone) {
        console.error('[push] send failed:', error.statusCode);
      }
      return { ok: false, gone };
    }
    // Never log the subscription or message body — PII/secret rule.
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('[push] send failed:', detail);
    return { ok: false, gone: false };
  }
}
