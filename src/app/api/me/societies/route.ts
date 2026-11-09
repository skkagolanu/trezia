import { listUserSocieties } from '@/lib/supabase/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { listSnapshotObjects } from '@/lib/storage/r2';
import { hasCapability } from '@/lib/auth/roles';

export async function GET() {
  const context = await listUserSocieties();
  if (!context) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const needsPrivilegedMetrics = context.isPlatformOwner || context.societies.some(society =>
    hasCapability(society.role, 'manage_access')
    || hasCapability(society.role, 'manage_backups')
    || hasCapability(society.role, 'manage_config'));
  const supabase = needsPrivilegedMetrics ? await createServiceClient() : null;
  const today = new Date().toISOString().slice(0, 10); // UTC — matches consume_agent_quota's period_date
  try {
    const societies = await Promise.all(context.societies.map(async society => {
      if (!supabase) return { ...society, metrics: null };

      const canViewAccess = context.isPlatformOwner || hasCapability(society.role, 'manage_access');
      const canViewBackups = context.isPlatformOwner || hasCapability(society.role, 'manage_backups');
      const canViewAgent = context.isPlatformOwner || hasCapability(society.role, 'manage_config');
      const [access, backups, agent] = await Promise.all([
        canViewAccess
          ? Promise.all([
              supabase.from('units').select('id', { count: 'exact', head: true }).eq('society_id', society.id).eq('is_active', true),
              supabase.from('society_memberships').select('id', { count: 'exact', head: true }).eq('society_id', society.id).eq('status', 'active'),
            ])
          : Promise.resolve(null),
        canViewBackups
          ? Promise.all([
              listSnapshotObjects(society.id),
              supabase.from('society_usage_current').select('*').eq('society_id', society.id).maybeSingle(),
            ])
          : Promise.resolve(null),
        canViewAgent
          ? Promise.all([
              supabase.from('society_config').select('agent_enabled, agent_daily_society_limit').eq('society_id', society.id).maybeSingle(),
              supabase.from('usage_counters').select('count').eq('counter_type', 'agent_society').eq('scope_id', society.id).eq('period_date', today).maybeSingle(),
            ])
          : Promise.resolve(null),
      ]);

      const serviceError = access?.find(result => result.error)?.error
        ?? backups?.[1].error
        ?? agent?.find(result => result.error)?.error;
      if (serviceError) throw new Error('Privileged society metrics query failed');

      const usage = backups?.[1].data;
      const config = agent?.[0].data;
      const agentCounter = agent?.[1].data;
      return {
        ...society,
        metrics: {
          access: access ? { unitCount: access[0].count ?? 0, accountCount: access[1].count ?? 0 } : null,
          backups: backups
            ? {
                lastSnapshotAt: backups[0][0]?.lastModified.toISOString() ?? null,
                usage: usage
                  ? {
                      measuredAt: usage.measured_at,
                      dbRowCount: usage.db_row_count,
                      artifactBytes: usage.artifact_bytes,
                      snapshotBytes: usage.snapshot_bytes,
                      snapshotCount: usage.snapshot_count,
                      lastSnapshotResult: usage.last_snapshot_result,
                      lastSnapshotRatio: usage.last_snapshot_ratio,
                    }
                  : null,
              }
            : null,
          agent: agent
            ? {
                enabled: config?.agent_enabled ?? false,
                used: agentCounter?.count ?? 0,
                limit: config?.agent_daily_society_limit ?? 0,
              }
            : null,
        },
      };
    }));
    return Response.json({ isPlatformOwner: context.isPlatformOwner, societies });
  } catch {
    console.error('[me/societies] privileged metrics could not be loaded');
    return Response.json({ error: 'Could not load society metrics' }, { status: 500 });
  }
}
