/**
 * Can I AI? benchmark methodology — the single source of truth for how a
 * run is scored, classified, validated, and turned into a verdict.
 *
 * Modelled on MLPerf Inference: Mobile / MLPerf Client (MLCommons), adapted
 * for zero-install, in-browser measurement at community scale:
 *
 *   MLPerf concept                      Can I AI? equivalent
 *   ─────────────────────────────────   ─────────────────────────────────────
 *   Single-stream scenario, 90%-ile     Sequential prompts × N runs; TTFT p90,
 *   latency                             TPS p50 (median) per category
 *   Offline / throughput scenario       "concurrent" category (extended tier)
 *   Base vs Extended components         base categories score; extended
 *                                       categories reported but not scored
 *   Closed vs Open division             closed = reference model preset for
 *                                       the engine; open = any preset
 *   Accuracy target (e.g. TinyMMLU)     quality smoke test from the eval
 *                                       suite, gated at QUALITY_GATE
 *   TTFT/TPOT latency constraints       latency_class: interactive /
 *   (interactive 500/30, conv 2000/100) conversational / batch
 *   LoadGen validity checks             validateRun() → result_tier
 *   Submission system description       device fields + engine + model_id +
 *                                       spec_version + run conditions
 *
 * Everything here is pure and unit-tested (spec.test.ts). The MCP edge
 * function carries a copy of the verdict thresholds and version — a parity
 * test guards against drift.
 */

import type { BenchmarkCategory } from "@/lib/models";
import type { EngineType } from "@/lib/inference/types";

/** Methodology "round". Bump when scoring rules or prompt sets change so
 * results stay comparable only within a round (as MLPerf versions do). */
export const METHODOLOGY_VERSION = "2026.09";

// ---------------------------------------------------------------------------
// Tiers, divisions, references
// ---------------------------------------------------------------------------

export type PromptTier = "base" | "extended";

/** Base categories contribute to the overall score; extended categories are
 * measured and reported but don't affect the score (they may not run on every
 * device — e.g. concurrency on WASM). */
export const CATEGORY_TIER: Record<BenchmarkCategory, PromptTier> = {
  ttft: "base",
  short: "base",
  medium: "base",
  long: "base",
  reasoning: "base",
  long_context: "extended",
  multi_turn: "extended",
  concurrent: "extended",
};

export const BASE_CATEGORIES = (Object.keys(CATEGORY_TIER) as BenchmarkCategory[]).filter(
  (c) => CATEGORY_TIER[c] === "base"
);

export type Division = "closed" | "open";

/** Closed-division reference model per engine — the apples-to-apples preset
 * every device in that engine class is compared on. One per engine because
 * engines are model-format-specific (MediaPipe only runs Gemma .task files). */
export const CLOSED_DIVISION_REFERENCE: Record<EngineType, string> = {
  mediapipe: "gemma-1b",
  webllm: "webllm-llama-1b",
  onnx: "onnx-smollm2-135m",
};

export function divisionFor(engine: EngineType, modelId: string | null | undefined): Division {
  return modelId && CLOSED_DIVISION_REFERENCE[engine] === modelId ? "closed" : "open";
}

// ---------------------------------------------------------------------------
// Run requirements & thresholds
// ---------------------------------------------------------------------------

/** Minimum successful runs per base category for a valid result. */
export const MIN_RUNS_PER_BASE_CATEGORY = 3;
/** A non-TTFT run that produced fewer tokens than this is a degenerate
 * generation (empty/EOS-only) and cannot support a throughput claim. */
export const MIN_TOKENS_NON_TTFT = 4;
/** Ratio of late-run to early-run throughput below which we flag throttling. */
export const THROTTLE_DECAY_RATIO = 0.7;

/** Quality gate: mean keyword-eval score over the smoke set. MLPerf gates
 * performance results on an accuracy target; a device that is fast because
 * the model emits garbage must not be certified. */
export const QUALITY_GATE = 0.5;
/** Eval-suite prompt ids used as the quality smoke test (short, objective,
 * keyword-scorable; ~6 generations so it stays cheap). */
export const QUALITY_SMOKE_PROMPT_IDS = ["fact-1", "fact-2", "math-1", "math-2", "inst-1", "inst-2"] as const;

/** MLPerf LLM latency constraints (TTFT ms / TPOT ms). */
export const LATENCY_CLASSES = {
  interactive: { ttftMs: 500, tpotMs: 30 },
  conversational: { ttftMs: 2000, tpotMs: 100 },
} as const;
export type LatencyClass = keyof typeof LATENCY_CLASSES | "batch";

export function classifyLatency(ttftP90Ms: number, tpotP50Ms: number): LatencyClass {
  const i = LATENCY_CLASSES.interactive;
  const c = LATENCY_CLASSES.conversational;
  if (ttftP90Ms <= i.ttftMs && tpotP50Ms <= i.tpotMs) return "interactive";
  if (ttftP90Ms <= c.ttftMs && tpotP50Ms <= c.tpotMs) return "conversational";
  return "batch";
}

/** Verdict thresholds on overall_score (tok/s). Mirrored in
 * supabase/functions/mcp/index.ts — keep in sync (parity-tested). */
export const VERDICTS = [
  { min: 15, label: "Yes, you can AI!", emoji: "🚀", description: "Your device handles AI smoothly." },
  { min: 6, label: "Mostly, yes", emoji: "👍", description: "Good enough for short tasks. Longer generation will feel sluggish." },
  { min: 1, label: "Barely…", emoji: "🐢", description: "It works, but expect noticeable latency." },
  { min: 0, label: "No, not yet", emoji: "⛔", description: "Too slow for practical on-device AI right now." },
] as const;

export function getVerdict(overallScore: number) {
  return VERDICTS.find((v) => overallScore >= v.min) ?? VERDICTS[VERDICTS.length - 1];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Nearest-rank percentile (p in 0..100) — what MLPerf LoadGen reports. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export const median = (values: number[]) => percentile(values, 50);

/** Geometric mean — robust to categories on different scales (MLPerf Client
 * combines category scores this way). */
export function geomean(values: number[]): number {
  if (values.length === 0) return NaN;
  if (values.some((v) => !(v > 0))) return 0;
  return Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Minimal per-run shape the aggregator needs (matches BenchmarkResult). */
export interface RunSample {
  category: string;
  tokensGenerated: number;
  timeMs: number;
  tokensPerSecond: number;
  ttftMs: number;
  tpotMs: number;
}

export interface CategoryStats {
  category: string;
  tier: PromptTier;
  runs: number;
  tps_p50: number;
  ttft_p50_ms: number;
  ttft_p90_ms: number;
  tpot_p50_ms: number;
  tokens_mean: number;
}

export interface Validity {
  valid: boolean;
  reasons: string[];
}

export type ResultTier = "certified" | "valid" | "invalid";

export interface RunStats {
  spec_version: string;
  /** Geometric mean of base-category median throughput (tok/s). */
  overall_score: number;
  ttft_p90_ms: number;
  tpot_p50_ms: number;
  latency_class: LatencyClass;
  categories: CategoryStats[];
  /** Late-run / early-run throughput ratio over base runs (1 = stable). */
  thermal_decay: number;
  validity: Validity;
}

const isFiniteNonNeg = (n: number) => Number.isFinite(n) && n >= 0;

/** Per-sample sanity checks — a sample failing these is dropped from stats
 * and its reason recorded, rather than silently polluting percentiles. */
export function sampleProblem(s: RunSample): string | null {
  if (![s.tokensGenerated, s.timeMs, s.tokensPerSecond, s.ttftMs, s.tpotMs].every(isFiniteNonNeg)) {
    return `non-finite or negative metric in ${s.category}`;
  }
  if (s.timeMs <= 0) return `zero-duration run in ${s.category}`;
  if (s.ttftMs > s.timeMs) return `TTFT exceeds total time in ${s.category}`;
  if (s.category !== "ttft" && s.tokensGenerated < MIN_TOKENS_NON_TTFT) {
    return `degenerate generation (<${MIN_TOKENS_NON_TTFT} tokens) in ${s.category}`;
  }
  return null;
}

export function aggregateRun(samples: RunSample[]): RunStats {
  const reasons: string[] = [];
  const clean: RunSample[] = [];
  for (const s of samples) {
    const problem = sampleProblem(s);
    if (problem) reasons.push(problem);
    else clean.push(s);
  }

  const byCategory = new Map<string, RunSample[]>();
  for (const s of clean) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }

  const categories: CategoryStats[] = [...byCategory.entries()].map(([category, runs]) => ({
    category,
    tier: CATEGORY_TIER[category as BenchmarkCategory] ?? "extended",
    runs: runs.length,
    tps_p50: median(runs.map((r) => r.tokensPerSecond)),
    ttft_p50_ms: median(runs.map((r) => r.ttftMs)),
    ttft_p90_ms: percentile(runs.map((r) => r.ttftMs), 90),
    tpot_p50_ms: median(runs.map((r) => r.tpotMs)),
    tokens_mean: runs.reduce((a, r) => a + r.tokensGenerated, 0) / runs.length,
  }));

  // Validity: every base category present with enough runs.
  for (const cat of BASE_CATEGORIES) {
    const n = byCategory.get(cat)?.length ?? 0;
    if (n < MIN_RUNS_PER_BASE_CATEGORY) {
      reasons.push(`${cat}: ${n}/${MIN_RUNS_PER_BASE_CATEGORY} required runs`);
    }
  }

  const baseCats = categories.filter((c) => c.tier === "base" && c.runs >= MIN_RUNS_PER_BASE_CATEGORY);
  const baseRuns = clean.filter((s) => CATEGORY_TIER[s.category as BenchmarkCategory] === "base");

  const overall_score = baseCats.length > 0 ? geomean(baseCats.map((c) => c.tps_p50)) : 0;
  const ttft_p90_ms = baseRuns.length > 0 ? percentile(baseRuns.map((r) => r.ttftMs), 90) : NaN;
  // TPOT only meaningful where decode happened (non-ttft prompts).
  const decodeRuns = baseRuns.filter((r) => r.category !== "ttft");
  const tpot_p50_ms = decodeRuns.length > 0 ? median(decodeRuns.map((r) => r.tpotMs)) : NaN;

  // Thermal/throttling indicator: samples arrive in run order, so compare the
  // first and last thirds of the base decode runs.
  let thermal_decay = 1;
  if (decodeRuns.length >= 6) {
    const third = Math.floor(decodeRuns.length / 3);
    const early = decodeRuns.slice(0, third).map((r) => r.tokensPerSecond);
    const late = decodeRuns.slice(-third).map((r) => r.tokensPerSecond);
    const e = median(early);
    thermal_decay = e > 0 ? median(late) / e : 1;
    if (thermal_decay < THROTTLE_DECAY_RATIO) {
      reasons.push(`throughput decayed to ${(thermal_decay * 100).toFixed(0)}% of early runs (thermal throttling?)`);
    }
  }

  const valid =
    BASE_CATEGORIES.every((cat) => (byCategory.get(cat)?.length ?? 0) >= MIN_RUNS_PER_BASE_CATEGORY) &&
    overall_score > 0;

  return {
    spec_version: METHODOLOGY_VERSION,
    overall_score,
    ttft_p90_ms,
    tpot_p50_ms,
    latency_class: Number.isFinite(ttft_p90_ms) && Number.isFinite(tpot_p50_ms)
      ? classifyLatency(ttft_p90_ms, tpot_p50_ms)
      : "batch",
    categories,
    thermal_decay,
    validity: { valid, reasons },
  };
}

/**
 * Result tier — what a row on the leaderboard is allowed to claim.
 *  certified: valid stats AND quality gate passed (comparable, rankable)
 *  valid:     stats valid but quality unknown/failed — listed, not ranked
 *  invalid:   insufficient or malformed runs — stored for diagnostics only
 */
export function resultTierFor(stats: RunStats, qualityScore: number | null): ResultTier {
  if (!stats.validity.valid) return "invalid";
  if (qualityScore != null && Number.isFinite(qualityScore) && qualityScore >= QUALITY_GATE) return "certified";
  return "valid";
}

/** Mean of per-prompt quality scores (0..1); null when nothing was scored. */
export function qualityScoreFrom(scores: number[]): number | null {
  const finite = scores.filter((s) => Number.isFinite(s));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}
