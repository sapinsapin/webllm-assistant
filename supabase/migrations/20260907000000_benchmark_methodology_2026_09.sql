-- Benchmark methodology round 2026.09 (MLPerf-style rigor for community runs).
-- Additive only: existing rows keep NULLs and the dashboard falls back to
-- avg_tps / verdict for them.
ALTER TABLE public.benchmark_runs
  ADD COLUMN IF NOT EXISTS spec_version text,            -- methodology round, e.g. '2026.09'
  ADD COLUMN IF NOT EXISTS division text,                -- 'closed' (reference model) | 'open'
  ADD COLUMN IF NOT EXISTS model_id text,                -- preset id (stable, unlike model_name)
  ADD COLUMN IF NOT EXISTS overall_score double precision, -- geomean of base-category median tok/s
  ADD COLUMN IF NOT EXISTS ttft_p90_ms double precision,
  ADD COLUMN IF NOT EXISTS tpot_p50_ms double precision,
  ADD COLUMN IF NOT EXISTS latency_class text,           -- interactive | conversational | batch
  ADD COLUMN IF NOT EXISTS quality_score double precision, -- 0..1 keyword-eval smoke test
  ADD COLUMN IF NOT EXISTS result_tier text,             -- certified | valid | invalid | reported
  ADD COLUMN IF NOT EXISTS validity jsonb,               -- { valid, reasons[] }
  ADD COLUMN IF NOT EXISTS stats jsonb,                  -- per-category percentiles
  ADD COLUMN IF NOT EXISTS conditions jsonb,             -- battery / visibility / network / duration
  ADD COLUMN IF NOT EXISTS engine_version text;

-- Leaderboard queries: rankable rows within a round, per division and model.
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_leaderboard
  ON public.benchmark_runs (spec_version, division, model_id, overall_score DESC)
  WHERE result_tier = 'certified';
