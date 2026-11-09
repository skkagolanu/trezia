import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { pushEnabled, sendPush, type PushMessage, type WebPushSubscription } from '@/lib/notifications/push';
import { mapWithConcurrency } from '@/lib/concurrency';

// Best-effort push fan-out for a single user. Never throws — a notification
// failure must never break the caller's write path (payment recorded, bill
// generated, etc.). Only errors codes/messages are logged, never subscription
// endpoints or message content (PII/secret rule).
// Best-effort fan-out to every active Admin/Treasurer of one society. Same
// never-throws contract as notifyUser: a resident's claim must still be
// recorded when push is disabled, unconfigured, or failing.
//
// society_memberships is the operational source of role (legacy profiles.role
// grants nothing here), and revoked members must not be alerted, hence the
// explicit status filter.
export async function notifySocietyOperators(societyId: string, message: PushMessage): Promise<void> {
  if (!pushEnabled()) return;

  try {
    const supabase = await createServiceClient();
    const { data: rows, error } = await supabase
      .from('society_memberships')
      .select('user_id')
      .eq('society_id', societyId)
      .eq('status', 'active')
      .in('role', ['admin', 'treasurer']);

    if (error) {
      console.error('[notify] operator lookup failed:', error.code ?? 'unknown');
      return;
    }
    if (!rows || rows.length === 0) return;

    const userIds = [...new Set(rows.map(row => row.user_id))];
    for (const userId of userIds) {
      await notifyUser(userId, message);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[notify] operator fan-out failed:', detail);
  }
}

// Best-effort fan-out to every active Resident of one society (e.g. a newly
// published notice). Same never-throws contract as notifyUser/
// notifySocietyOperators — a write that already committed must not be turned
// into an error by a push failure, and the resident's role must come from
// society_memberships (not the legacy profiles.role column), with revoked
// members excluded via the status filter.
export async function notifySocietyResidents(societyId: string, message: PushMessage): Promise<void> {
  if (!pushEnabled()) return;

  try {
    const supabase = await createServiceClient();
    const { data: rows, error } = await supabase
      .from('society_memberships')
      .select('user_id')
      .eq('society_id', societyId)
      .eq('status', 'active')
      .eq('role', 'resident');

    if (error) {
      console.error('[notify] resident lookup failed:', error.code ?? 'unknown');
      return;
    }
    if (!rows || rows.length === 0) return;

    const userIds = [...new Set(rows.map(row => row.user_id))];
    for (const userId of userIds) {
      await notifyUser(userId, message);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[notify] resident fan-out failed:', detail);
  }
}

// Best-effort fan-out to every active Resident of one or more specific units
// (e.g. a bill just went overdue for a flat, or a treasurer just recorded a
// payment for a flat). Unlike notifySocietyResidents this targets only the
// residents tied to the given units — role and status still come from
// society_memberships, never the legacy profiles.role column, and revoked
// members are excluded the same way. Deduplicated by user id, so a resident
// linked to several of the passed-in units (or holding more than one
// membership on the same unit) still receives exactly one notification.
// The membership lookup itself is a single bounded query; mapWithConcurrency
// only bounds the per-user push fan-out, which is what can actually grow
// large when a run's overdue set spans many units.
export async function notifyUnitResidents(societyId: string, unitIds: string[], message: PushMessage): Promise<void> {
  if (!pushEnabled() || unitIds.length === 0) return;

  try {
    const supabase = await createServiceClient();
    const { data: rows, error } = await supabase
      .from('society_memberships')
      .select('user_id')
      .eq('society_id', societyId)
      .in('unit_id', unitIds)
      .eq('status', 'active')
      .eq('role', 'resident');

    if (error) {
      console.error('[notify] unit-resident lookup failed:', error.code ?? 'unknown');
      return;
    }
    if (!rows || rows.length === 0) return;

    const userIds = [...new Set(rows.map(row => row.user_id))];
    await mapWithConcurrency(userIds, userId => notifyUser(userId, message));
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[notify] unit-resident fan-out failed:', detail);
  }
}

export async function notifyUser(userId: string, message: PushMessage): Promise<void> {
  if (!pushEnabled()) return;

  try {
    const supabase = await createServiceClient();
    const { data: rows, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);

    if (error) {
      console.error('[notify] load failed:', error.code ?? 'unknown');
      return;
    }
    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      const sub: WebPushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      const result = await sendPush(sub, { ...message, body: 'Open Trezia to review your latest update.' });
      if (result.gone) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', row.id);
        if (deleteError) {
          console.error('[notify] cleanup failed:', deleteError.code ?? 'unknown');
        }
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[notify] failed:', detail);
  }
}
