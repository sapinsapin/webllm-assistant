-- Reproducibility audit (methodology roadmap 5.5).
-- Within a round, a certified run scoring more than 2x its device's median
-- (device having >= 5 certified runs) is treated as `valid` — listed, never
-- ranked. Computed at read time so it self-heals as runs accumulate.
-- Thresholds mirror src/lib/benchmark/audit.ts (parity-tested).

-- Shared device grouping rule (was inlined in the leaderboard view).
CREATE OR REPLACE FUNCTION public.benchmark_device_key(device_model text, os text, gpu text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(device_model, ''), NULLIF(CONCAT_WS(' · ', os, gpu), ''), 'Unknown device');
$$;

CREATE OR REPLACE VIEW public.benchmark_audit
WITH (security_invoker = true) AS
WITH certified AS (
  SELECT
    id, spec_version, division, model_id, engine,
    public.benchmark_device_key(device_model, os, gpu) AS device_key,
    overall_score
  FROM public.benchmark_runs
  WHERE result_tier = 'certified'
    AND overall_score IS NOT NULL
    AND spec_version IS NOT NULL
),
groups AS (
  SELECT
    spec_version, division, model_id, engine, device_key,
    COUNT(*)::int AS runs,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY overall_score) AS score_p50
  FROM certified
  GROUP BY spec_version, division, model_id, engine, device_key
)
SELECT
  c.id,
  c.overall_score,
  g.score_p50 AS device_median,
  g.runs      AS device_runs,
  (g.runs >= 5 AND c.overall_score > 2 * g.score_p50) AS flagged,
  CASE WHEN g.runs >= 5 AND c.overall_score > 2 * g.score_p50 THEN 'valid' ELSE 'certified' END AS effective_tier
FROM certified c
JOIN groups g USING (spec_version, division, model_id, engine, device_key);

GRANT SELECT ON public.benchmark_audit TO anon, authenticated;

-- Leaderboard now excludes audit-flagged rows. Recreated (not replaced) so
-- the grouping uses the shared function.
DROP VIEW IF EXISTS public.benchmark_leaderboard;
CREATE VIEW public.benchmark_leaderboard
WITH (security_invoker = true) AS
SELECT
  r.spec_version,
  r.division,
  r.model_id,
  r.engine,
  public.benchmark_device_key(r.device_model, r.os, r.gpu) AS device_key,
  MAX(r.device_type) AS device_type,
  MAX(r.model_name)  AS model_name,
  MAX(r.gpu)         AS gpu,
  COUNT(*)::int      AS runs,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY r.overall_score) AS score_p50,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY r.overall_score) AS score_p25,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY r.overall_score) AS score_p75,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY r.ttft_p90_ms)   AS ttft_p90_p50_ms,
  MAX(r.created_at)  AS last_run_at
FROM public.benchmark_runs r
WHERE r.result_tier = 'certified'
  AND r.overall_score IS NOT NULL
  AND r.spec_version IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.benchmark_audit a WHERE a.id = r.id AND a.flagged)
GROUP BY r.spec_version, r.division, r.model_id, r.engine, public.benchmark_device_key(r.device_model, r.os, r.gpu);

GRANT SELECT ON public.benchmark_leaderboard TO anon, authenticated;
