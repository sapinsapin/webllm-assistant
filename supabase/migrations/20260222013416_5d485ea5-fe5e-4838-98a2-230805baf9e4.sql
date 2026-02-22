
CREATE TABLE public.benchmark_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Model info
  model_name TEXT NOT NULL,
  engine TEXT NOT NULL,
  
  -- Aggregate metrics
  avg_tps DOUBLE PRECISION NOT NULL,
  avg_ttft_ms DOUBLE PRECISION NOT NULL,
  verdict TEXT NOT NULL,
  
  -- Per-prompt results (JSONB array)
  results JSONB NOT NULL DEFAULT '[]',
  
  -- Device metadata
  browser TEXT,
  os TEXT,
  cores INTEGER,
  ram_gb DOUBLE PRECISION,
  gpu TEXT,
  gpu_vendor TEXT,
  screen_res TEXT,
  pixel_ratio DOUBLE PRECISION,
  user_agent TEXT
);

-- Public read/write (no auth in this app)
ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read benchmark runs"
ON public.benchmark_runs FOR SELECT USING (true);

CREATE POLICY "Anyone can insert benchmark runs"
ON public.benchmark_runs FOR INSERT WITH CHECK (true);
