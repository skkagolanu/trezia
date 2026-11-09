-- Capacity guardrails.
ALTER TABLE public.society_config
  ADD COLUMN IF NOT EXISTS agent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_daily_user_limit integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS agent_daily_society_limit integer NOT NULL DEFAULT 100;

ALTER TABLE public.society_config
  ADD CONSTRAINT society_config_agent_user_limit_nonneg CHECK (agent_daily_user_limit >= 0),
  ADD CONSTRAINT society_config_agent_society_limit_nonneg CHECK (agent_daily_society_limit >= 0);

-- 2. Atomic period counters. One row per (counter_type, scope, day). The
--    in-memory limiter in the /api/agent route stays as burst defence; this is
--    the durable per-day budget that survives instance recycling.
CREATE TABLE IF NOT EXISTS public.usage_counters (
  counter_type text NOT NULL CHECK (counter_type IN ('agent_user', 'agent_society', 'agent_deployment')),
  scope_id     text NOT NULL,
  period_date  date NOT NULL,
  count        integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  society_id   uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_type, scope_id, period_date)
);

-- 3. Latest capacity/backup measurement per society. Written by the daily cron
--    and explicit refresh; never polled. Read on /societies cards.
CREATE TABLE IF NOT EXISTS public.society_usage_current (
  society_id           uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  measured_at          timestamptz NOT NULL DEFAULT now(),
  db_row_count         bigint NOT NULL DEFAULT 0,
  artifact_bytes       bigint NOT NULL DEFAULT 0,
  snapshot_bytes       bigint NOT NULL DEFAULT 0,
  snapshot_count       integer NOT NULL DEFAULT 0,
  last_snapshot_at     timestamptz,
  last_snapshot_result text CHECK (last_snapshot_result IN ('UPLOADED', 'SKIPPED_UNCHANGED', 'FAILED')),
  last_snapshot_ratio  numeric,
  last_snapshot_hash   text
);

-- 4. Atomic quota consumption. Every non-demo /api/agent attempt calls this
--    before Groq. It locks all three counter rows in a fixed order
--    (user → society → deployment) so concurrent calls cannot deadlock, checks
--    each ceiling, and only increments when every ceiling has headroom.
--    Returns '' when allowed, otherwise the name of the exhausted scope so the
--    route can tell the operator which limit was hit. A denied request never
--    increments, so a throttled client cannot inflate the count past its cap.
CREATE OR REPLACE FUNCTION public.consume_agent_quota(
  p_user_id uuid, p_society_id uuid,
  p_user_limit integer, p_society_limit integer, p_deployment_limit integer
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'UTC')::date;
  v_user    integer;
  v_society integer;
  v_deploy  integer;
BEGIN
  INSERT INTO public.usage_counters (counter_type, scope_id, period_date, society_id)
  VALUES ('agent_user', p_user_id::text, v_today, p_society_id),
         ('agent_society', p_society_id::text, v_today, p_society_id),
         ('agent_deployment', 'global', v_today, NULL)
  ON CONFLICT (counter_type, scope_id, period_date) DO NOTHING;

  SELECT count INTO v_user FROM public.usage_counters
    WHERE counter_type = 'agent_user' AND scope_id = p_user_id::text AND period_date = v_today FOR UPDATE;
  SELECT count INTO v_society FROM public.usage_counters
    WHERE counter_type = 'agent_society' AND scope_id = p_society_id::text AND period_date = v_today FOR UPDATE;
  SELECT count INTO v_deploy FROM public.usage_counters
    WHERE counter_type = 'agent_deployment' AND scope_id = 'global' AND period_date = v_today FOR UPDATE;

  IF v_deploy >= p_deployment_limit THEN RETURN 'deployment'; END IF;
  IF v_society >= p_society_limit THEN RETURN 'society'; END IF;
  IF v_user >= p_user_limit THEN RETURN 'user'; END IF;

  UPDATE public.usage_counters SET count = count + 1, updated_at = now()
    WHERE (counter_type = 'agent_user' AND scope_id = p_user_id::text AND period_date = v_today)
       OR (counter_type = 'agent_society' AND scope_id = p_society_id::text AND period_date = v_today)
       OR (counter_type = 'agent_deployment' AND scope_id = 'global' AND period_date = v_today);
  RETURN '';
END;
$$;

-- 5. Upsert the latest measurement. Callers that skip an unchanged snapshot
--    pass the previous snapshot facts back so history is preserved while
--    measured_at advances.
CREATE OR REPLACE FUNCTION public.record_society_usage(
  p_society_id uuid, p_db_row_count bigint, p_artifact_bytes bigint,
  p_snapshot_bytes bigint, p_snapshot_count integer, p_last_snapshot_at timestamptz,
  p_last_snapshot_result text, p_last_snapshot_ratio numeric, p_last_snapshot_hash text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  INSERT INTO public.society_usage_current (
    society_id, measured_at, db_row_count, artifact_bytes, snapshot_bytes, snapshot_count,
    last_snapshot_at, last_snapshot_result, last_snapshot_ratio, last_snapshot_hash)
  VALUES (p_society_id, now(), p_db_row_count, p_artifact_bytes, p_snapshot_bytes, p_snapshot_count,
    p_last_snapshot_at, p_last_snapshot_result, p_last_snapshot_ratio, p_last_snapshot_hash)
  ON CONFLICT (society_id) DO UPDATE SET
    measured_at = now(),
    db_row_count = EXCLUDED.db_row_count,
    artifact_bytes = EXCLUDED.artifact_bytes,
    snapshot_bytes = EXCLUDED.snapshot_bytes,
    snapshot_count = EXCLUDED.snapshot_count,
    last_snapshot_at = EXCLUDED.last_snapshot_at,
    last_snapshot_result = EXCLUDED.last_snapshot_result,
    last_snapshot_ratio = EXCLUDED.last_snapshot_ratio,
    last_snapshot_hash = EXCLUDED.last_snapshot_hash;
END;
$$;

-- 6. RLS. Both tables are written only by the service role (no INSERT/UPDATE
--    queries: an Admin sees only their own society's rows; the Platform Owner
--    sees every society's capacity measurement.
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_usage_current ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_counters_admin_read ON public.usage_counters
  FOR SELECT TO authenticated
  USING (society_id IS NOT NULL AND private.auth_society_admin(society_id));

CREATE POLICY society_usage_current_read ON public.society_usage_current
  FOR SELECT TO authenticated
  USING (private.auth_is_platform_owner() OR private.auth_society_admin(society_id));

REVOKE ALL ON FUNCTION public.consume_agent_quota(uuid, uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_society_usage(uuid, bigint, bigint, bigint, integer, timestamptz, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_agent_quota(uuid, uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_society_usage(uuid, bigint, bigint, bigint, integer, timestamptz, text, numeric, text) TO service_role;

NOTIFY pgrst, 'reload schema';
