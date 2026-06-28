CREATE POLICY "Allow updating device info on recent runs"
ON public.benchmark_runs
FOR UPDATE
TO public
USING (created_at > now() - interval '2 hours')
WITH CHECK (created_at > now() - interval '2 hours');