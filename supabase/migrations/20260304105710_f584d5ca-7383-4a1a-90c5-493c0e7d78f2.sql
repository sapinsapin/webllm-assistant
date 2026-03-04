CREATE POLICY "Allow deleting own load attempts"
ON public.benchmark_runs
FOR DELETE
USING (true);