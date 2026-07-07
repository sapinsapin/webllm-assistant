-- The community dashboard paginates benchmark_runs ordered by created_at DESC
-- on every page view. Index it so concurrent users don't trigger sequential
-- scans as the table grows.
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created_at_desc
  ON public.benchmark_runs (created_at DESC);
