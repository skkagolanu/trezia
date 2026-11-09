import { pushEnabled, getVapidPublicKey } from '@/lib/notifications/push';

// Web push must stay dark until all three VAPID env vars are set — the same
// env-gating contract as the Razorpay feature. These read env at call time.
describe('web-push gating', () => {
  const saved = {
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
    subj: process.env.VAPID_SUBJECT,
  };
  afterEach(() => {
    process.env.VAPID_PUBLIC_KEY = saved.pub;
    process.env.VAPID_PRIVATE_KEY = saved.priv;
    process.env.VAPID_SUBJECT = saved.subj;
  });

  function setAll() {
    process.env.VAPID_PUBLIC_KEY = Buffer.alloc(65, 1).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 2).toString('base64url');
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
  }

  it('is disabled when any VAPID var is missing', () => {
    setAll(); delete process.env.VAPID_PRIVATE_KEY;
    expect(pushEnabled()).toBe(false);
    setAll(); delete process.env.VAPID_PUBLIC_KEY;
    expect(pushEnabled()).toBe(false);
    setAll(); delete process.env.VAPID_SUBJECT;
    expect(pushEnabled()).toBe(false);
  });

  it('is enabled and exposes the public key when all three are set', () => {
    setAll();
    expect(pushEnabled()).toBe(true);
    expect(getVapidPublicKey()).toBe(process.env.VAPID_PUBLIC_KEY);
  });

  it('stays disabled when present VAPID values fail canonical validation', () => {
    setAll();
    process.env.VAPID_PUBLIC_KEY = 'not-a-valid-public-key';

    expect(pushEnabled()).toBe(false);
    expect(getVapidPublicKey()).toBeNull();
  });

  it('returns null public key when unconfigured', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    expect(getVapidPublicKey()).toBeNull();
    expect(pushEnabled()).toBe(false);
  });
});
