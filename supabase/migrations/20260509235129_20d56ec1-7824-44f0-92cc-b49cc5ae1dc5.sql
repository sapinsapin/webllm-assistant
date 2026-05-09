
ALTER TABLE public.benchmark_runs
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Backfill known cities (best-effort centroids)
UPDATE public.benchmark_runs SET latitude = 51.5290, longitude = -0.1255 WHERE city = 'Camden' AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 14.6760, longitude = 121.0437 WHERE city = 'Quezon City' AND country = 'Philippines' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 52.3676, longitude = 4.9041 WHERE city = 'Amsterdam' AND country = 'The Netherlands' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 51.5099, longitude = -0.0059 WHERE city = 'Tower Hamlets' AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 51.4545, longitude = -2.5879 WHERE city = 'Bristol' AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 14.5995, longitude = 120.9842 WHERE city = 'Manila' AND country = 'Philippines' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 53.7176, longitude = -1.6300 WHERE city = 'Batley' AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = -34.6037, longitude = -58.3816 WHERE city = 'Buenos Aires' AND country = 'Argentina' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 51.5074, longitude = -0.1278 WHERE city IN ('London','City of London','Islington','Brentford','Croydon') AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 6.2476, longitude = -75.5658 WHERE city = 'Medellín' AND country = 'Colombia' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = -33.9249, longitude = 18.4241 WHERE city = 'Cape Town' AND country = 'South Africa' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 34.2073, longitude = -84.1402 WHERE city = 'Cumming' AND country = 'United States' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 60.1699, longitude = 24.9384 WHERE city = 'Helsinki' AND country = 'Finland' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 51.3877, longitude = -2.8246 WHERE city = 'Yatton' AND country = 'United Kingdom' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 37.3688, longitude = -122.0363 WHERE city = 'Sunnyvale' AND country = 'United States' AND latitude IS NULL;
UPDATE public.benchmark_runs SET latitude = 41.3851, longitude = 2.1734 WHERE city = 'Barcelona' AND country = 'Spain' AND latitude IS NULL;
