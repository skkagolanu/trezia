/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import NotificationOptIn from '@/components/notifications/NotificationOptIn';
import { societyFetch } from '@/lib/society-path';

jest.mock('@/lib/society-path', () => ({ societyFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

function key(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(new ArrayBuffer(65));
  value.fill(fill);
  return value;
}

function publicKey(value: Uint8Array<ArrayBuffer>): string {
  return Buffer.from(value).toString('base64url');
}

function subscription(endpoint: string, applicationServerKey: Uint8Array<ArrayBuffer>) {
  return {
    endpoint,
    options: { applicationServerKey: applicationServerKey.buffer, userVisibleOnly: true },
    toJSON: () => ({ endpoint, keys: { p256dh: 'browser-p256dh', auth: 'browser-auth' } }),
    unsubscribe: jest.fn(async () => true),
  } as unknown as PushSubscription;
}

function response(ok: boolean, status: number, body: object = {}) {
  return { ok, status, json: async () => body } as Response;
}

function installBrowserPush(existing: PushSubscription | null, created?: PushSubscription) {
  const getSubscription = jest.fn(async () => existing);
  const subscribe = jest.fn(async () => {
    if (!created) throw new Error('No created subscription configured');
    return created;
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: jest.fn(async () => 'granted') },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  });
  return { getSubscription, subscribe };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('does not claim notifications are on when only the browser has the endpoint', async () => {
  const vapid = key(1);
  const existing = subscription('https://fcm.googleapis.com/fcm/send/existing', vapid);
  installBrowserPush(existing);
  (societyFetch as jest.Mock).mockResolvedValue(response(true, 200, {
    enabled: true,
    vapidPublicKey: publicKey(vapid),
    subscribed: false,
  }));

  render(<NotificationOptIn />);

  expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
  expect(screen.queryByText('Notifications on')).not.toBeInTheDocument();
  expect(societyFetch).toHaveBeenCalledWith(
    '/api/notifications/subscribe?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2Fexisting',
  );
});

it('replaces a subscription created with a rotated VAPID key and persists the fresh endpoint', async () => {
  const oldKey = key(1);
  const newKey = key(2);
  const existing = subscription('https://fcm.googleapis.com/fcm/send/old', oldKey);
  const fresh = subscription('https://fcm.googleapis.com/fcm/send/fresh', newKey);
  const { subscribe } = installBrowserPush(existing, fresh);
  (societyFetch as jest.Mock).mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return response(true, 200);
    if (init?.method === 'POST') return response(true, 201, { ok: true });
    return response(true, 200, { enabled: true, vapidPublicKey: publicKey(newKey), subscribed: true });
  });

  render(<NotificationOptIn />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));

  await waitFor(() => expect(screen.getByText('Notifications on')).toBeInTheDocument());
  expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: newKey });
  expect(societyFetch).toHaveBeenCalledWith(
    '/api/notifications/subscribe',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining(fresh.endpoint) }),
  );
  expect(toast.success).toHaveBeenCalledWith('Notifications enabled');
});
