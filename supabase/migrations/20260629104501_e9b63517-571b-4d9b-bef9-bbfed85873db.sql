
-- Backfill device_model and gpu labels for existing Apple Silicon benchmark rows
-- using the same heuristics as src/lib/deviceInfo.ts:
--   * tier from cores: 20+ Ultra, 14-16 Max, 11-12 Pro, 10 base(M4/M5)/Max(M1), 8 base
--   * generation from Safari "Version/NN" in UA (Chrome freezes UA so no gen there)
--   * gpu relabel from "metal-3" -> "Apple Silicon GPU{tier} (Metal 3, N-core CPU)"

WITH classified AS (
  SELECT
    id,
    cores,
    gpu,
    user_agent,
    -- macOS major version: prefer Safari "Version/NN.x" (real), fallback to Mac OS X
    COALESCE(
      NULLIF((regexp_match(user_agent, 'Version/(\d+)'))[1], '')::int,
      NULLIF((regexp_match(user_agent, 'Mac OS X (\d+)[._]'))[1], '')::int
    ) AS mac_major,
    CASE
      WHEN cores >= 20 THEN ' Ultra'
      WHEN cores >= 14 THEN ' Max'
      WHEN cores >= 11 THEN ' Pro'
      ELSE ''
    END AS tier
  FROM benchmark_runs
  WHERE gpu_vendor = 'apple'
    AND user_agent ILIKE '%Macintosh%'
    AND user_agent NOT ILIKE '%iPad%'
),
resolved AS (
  SELECT
    id,
    cores,
    gpu,
    tier,
    CASE
      WHEN mac_major >= 26 THEN 'M5'
      WHEN mac_major = 15  THEN 'M4'
      WHEN mac_major = 14  THEN 'M3'
      WHEN mac_major = 13  THEN 'M2'
      WHEN mac_major = 12  THEN 'M1'
      ELSE NULL
    END AS gen,
    -- Re-resolve tier when 10 cores: M1 Max vs base M4/M5
    CASE
      WHEN cores = 10 AND mac_major >= 13 THEN ''        -- base M4/M5
      WHEN cores = 10 AND mac_major = 12  THEN ' Max'   -- M1 Max
      WHEN cores = 10 THEN ''
      ELSE tier
    END AS tier_final,
    (regexp_match(gpu, '(\d+)'))[1] AS metal_ver
  FROM classified
)
UPDATE benchmark_runs br
SET
  device_model = CASE
    WHEN r.gen IS NOT NULL
      THEN format('MacBook / Mac (Apple %s%s, ~%s cores)', r.gen, r.tier_final, r.cores)
    ELSE format('Mac (Apple Silicon%s, ~%s cores)', r.tier_final, r.cores)
  END,
  gpu = CASE
    WHEN br.gpu ~* '^metal[-\s]?\d*'
      THEN format('Apple Silicon GPU%s (Metal %s, %s-core CPU)',
                  r.tier_final,
                  COALESCE(r.metal_ver, '3'),
                  r.cores)
    ELSE br.gpu
  END
FROM resolved r
WHERE br.id = r.id;
