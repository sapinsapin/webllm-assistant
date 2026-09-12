/**
 * Methodology rounds (roadmap 5.2) — MLPerf-style versioning.
 *
 * MLPerf results are comparable only within a version (v0.7 … v6.0), and
 * each version ships release notes. Here a "round" is identified by
 * METHODOLOGY_VERSION and pinned by a FINGERPRINT of everything that makes
 * results comparable: the prompt set, the closed-division reference presets,
 * the quality smoke set, category tiers, and every threshold. round.test.ts
 * recomputes the fingerprint and fails if any of those inputs changed without
 * bumping the version and recording the new fingerprint + changelog entry —
 * so a round can never drift silently.
 */

import { BENCHMARK_PROMPTS } from "@/lib/models";
import { EVAL_PROMPTS } from "@/lib/evals";
import {
  CATEGORY_TIER,
  CLOSED_DIVISION_REFERENCE,
  LATENCY_CLASSES,
  METHODOLOGY_VERSION,
  MIN_RUNS_PER_BASE_CATEGORY,
  MIN_TOKENS_NON_TTFT,
  QUALITY_GATE,
  QUALITY_SMOKE_PROMPT_IDS,
  THROTTLE_DECAY_RATIO,
  VERDICTS,
} from "./spec";

export interface MethodologyRound {
  version: string;
  /** Fingerprint of the round-defining inputs (see computeRoundFingerprint). */
  fingerprint: string;
  /** ISO date the round opened. */
  opened: string;
  summary: string;
}

/** Every round ever published, oldest first. The last entry is the current
 * round and must match METHODOLOGY_VERSION. Never edit a past entry. */
export const ROUND_REGISTRY: MethodologyRound[] = [
  {
    version: "2026.09",
    fingerprint: "c3b1aafa",
    opened: "2026-09-07",
    summary:
      "First MLPerf-style round: percentiles, geomean score, closed/open divisions, quality gate, latency classes, result tiers, per-device leaderboards.",
  },
];

/** Sentinel for rows submitted before rounds existed (spec_version IS NULL). */
export const LEGACY_ROUND = "legacy" as const;

export function currentRound(): MethodologyRound {
  return ROUND_REGISTRY[ROUND_REGISTRY.length - 1];
}

/** The inputs that define comparability. Anything here changing ⇒ new round. */
export function currentRoundInputs() {
  return {
    // Base-tier prompts only: extended categories are reported, never scored,
    // so adding or changing one does not alter comparability of overall_score.
    prompts: BENCHMARK_PROMPTS.filter((p) => CATEGORY_TIER[p.category] === "base").map((p) => ({
      label: p.label,
      prompt: p.prompt,
      category: p.category,
      turns: p.turns ?? null,
      concurrency: p.concurrency ?? null,
      context: p.context ?? null,
    })),
    reference: CLOSED_DIVISION_REFERENCE,
    quality: QUALITY_SMOKE_PROMPT_IDS.map((id) => {
      const e = EVAL_PROMPTS.find((x) => x.id === id);
      return { id, prompt: e?.prompt ?? null, required: e?.requiredKeywords ?? null, pattern: e?.exactPattern ?? null };
    }),
    tiers: CATEGORY_TIER,
    thresholds: {
      MIN_RUNS_PER_BASE_CATEGORY,
      MIN_TOKENS_NON_TTFT,
      QUALITY_GATE,
      THROTTLE_DECAY_RATIO,
      LATENCY_CLASSES,
      verdicts: VERDICTS.map((v) => [v.min, v.label]),
    },
  };
}

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit over the stable JSON, as 8 hex chars. Not cryptographic —
 * it only needs to change when the inputs change. */
export function fingerprintOf(inputs: unknown): string {
  const s = stableStringify(inputs);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function computeRoundFingerprint(): string {
  return fingerprintOf(currentRoundInputs());
}

export interface RoundOption {
  value: string; // "all" | version | "legacy"
  label: string;
}

/** Options for a round picker; `includeAll`/`includeLegacy` for feeds
 * (leaderboards are per round, so they pass false). */
export function roundOptions(opts: { includeAll?: boolean; includeLegacy?: boolean } = {}): RoundOption[] {
  const out: RoundOption[] = [];
  if (opts.includeAll) out.push({ value: "all", label: "All rounds" });
  for (const r of [...ROUND_REGISTRY].reverse()) {
    out.push({ value: r.version, label: r.version === METHODOLOGY_VERSION ? `Round ${r.version} (current)` : `Round ${r.version}` });
  }
  if (opts.includeLegacy) out.push({ value: LEGACY_ROUND, label: "Legacy (pre-rounds)" });
  return out;
}
