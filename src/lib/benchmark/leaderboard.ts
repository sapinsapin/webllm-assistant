/**
 * Per-device leaderboard (methodology roadmap 5.1).
 *
 * Aggregation happens in Postgres (view `benchmark_leaderboard`, see the
 * 20260912 migration): certified runs grouped by (spec_version, division,
 * model_id, engine, device_key) with median-of-N scores. This module holds the
 * pure client-side logic — ranking, confidence labelling, and the device-key
 * rule mirrored from SQL — so it can be unit-tested.
 */

export interface LeaderboardRow {
  spec_version: string;
  division: string;
  model_id: string | null;
  engine: string;
  device_key: string;
  device_type: string | null;
  model_name: string | null;
  gpu: string | null;
  runs: number;
  score_p50: number;
  score_p25: number | null;
  score_p75: number | null;
  ttft_p90_p50_ms: number | null;
  last_run_at: string;
}

export type Confidence = "high" | "medium" | "single";

/** How much to trust a median: MLPerf has one vetted number per system; we
 * expose N so readers can weigh community submissions themselves. */
export function confidenceFor(runs: number): Confidence {
  if (runs >= 5) return "high";
  if (runs >= 2) return "medium";
  return "single";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "high (≥5 runs)",
  medium: "medium (2–4 runs)",
  single: "single run",
};

/** Mirror of the SQL device_key expression, for tests and client display. */
export function deviceKeyFor(d: { device_model?: string | null; os?: string | null; gpu?: string | null }): string {
  if (d.device_model && d.device_model.trim()) return d.device_model;
  const parts = [d.os, d.gpu].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(" · ") : "Unknown device";
}

/**
 * Rank rows: higher median score first; ties broken by more runs (more
 * evidence), then by device name for a stable order. Non-finite scores sink.
 */
export function rankLeaderboard<T extends Pick<LeaderboardRow, "score_p50" | "runs" | "device_key">>(rows: T[]): T[] {
  const score = (r: T) => (Number.isFinite(r.score_p50) ? r.score_p50 : -Infinity);
  return [...rows].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    if (b.runs !== a.runs) return b.runs - a.runs;
    return a.device_key.localeCompare(b.device_key);
  });
}

/** Interquartile spread as a share of the median — a quick "how consistent is
 * this device" signal; null when quartiles are unavailable (N < 2). */
export function spreadRatio(r: Pick<LeaderboardRow, "score_p25" | "score_p50" | "score_p75">): number | null {
  if (r.score_p25 == null || r.score_p75 == null || !(r.score_p50 > 0)) return null;
  return (r.score_p75 - r.score_p25) / r.score_p50;
}
