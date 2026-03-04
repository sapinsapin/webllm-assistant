DROP POLICY "Allow deleting own load attempts" ON public.benchmark_runs;

CREATE POLICY "Allow deleting unfinished load attempts"
ON public.benchmark_runs
FOR DELETE
USING (verdict = 'Did not finish');