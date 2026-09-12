-- Per-device leaderboard (methodology roadmap 5.1): median-of-N certified
-- runs grouped by round, division, model, and device. MLPerf publishes one
-- number per vendor system; we publish the distribution across real units.
--
-- security_invoker so the base table's RLS (public SELECT) applies; only
-- certified rows with methodology columns are aggregated, so legacy and
-- unranked results can never enter the leaderboard.
CREATE OR REPLACE VIEW public.benchmark_leaderboard
WITH (security_invoker = true) AS
SELECT
  spec_version,
  division,
  model_id,
  engine,
  COALESCE(NULLIF(device_model, ''), NULLIF(CONCAT_WS(' · ', os, gpu), ''), 'Unknown device') AS device_key,
  MAX(device_type) AS device_type,
  MAX(model_name)  AS model_name,
  MAX(gpu)         AS gpu,
  COUNT(*)::int    AS runs,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY overall_score) AS score_p50,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY overall_score) AS score_p25,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY overall_score) AS score_p75,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY ttft_p90_ms)   AS ttft_p90_p50_ms,
  MAX(created_at)  AS last_run_at
FROM public.benchmark_runs
WHERE result_tier = 'certified'
  AND overall_score IS NOT NULL
  AND spec_version IS NOT NULL
GROUP BY spec_version, division, model_id, engine, device_key;

GRANT SELECT ON public.benchmark_leaderboard TO anon, authenticated;
