CREATE POLICY "Allow updating unfinished to crashed"
ON public.benchmark_runs
FOR UPDATE
USING (verdict = 'Did not finish')
WITH CHECK (verdict = 'Crashed');