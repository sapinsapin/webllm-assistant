import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  METHODOLOGY_VERSION,
  BASE_CATEGORIES,
  CATEGORY_TIER,
  CLOSED_DIVISION_REFERENCE,
  MIN_RUNS_PER_BASE_CATEGORY,
  QUALITY_GATE,
  QUALITY_SMOKE_PROMPT_IDS,
  VERDICTS,
  aggregateRun,
  classifyLatency,
  divisionFor,
  geomean,
  getVerdict,
  median,
  percentile,
  qualityScoreFrom,
  resultTierFor,
  sampleProblem,
  type RunSample,
} from "./spec";
import { PRESET_MODELS, BENCHMARK_PROMPTS } from "@/lib/models";
import { EVAL_PROMPTS } from "@/lib/evals";

const sample = (over: Partial<RunSample> = {}): RunSample => ({
  category: "short",
  tokensGenerated: 40,
  timeMs: 2000,
  tokensPerSecond: 20,
  ttftMs: 300,
  tpotMs: 45,
  ...over,
});

/** A full, healthy suite: every base category × n runs, plus extended ones. */
function healthySuite(n = 3, tps = 20): RunSample[] {
  const out: RunSample[] = [];
  for (const cat of [...BASE_CATEGORIES, "long_context", "multi_turn", "concurrent"]) {
    for (let i = 0; i < n; i++) {
      out.push(sample({ category: cat, tokensPerSecond: tps + i, ttftMs: 300 + i * 50 }));
    }
  }
  return out;
}

describe("statistics", () => {
  it("percentile uses nearest-rank like MLPerf LoadGen", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 90)).toBe(90);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile([5], 90)).toBe(5);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it("median is order-independent", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("geomean is scale-robust and refuses non-positive inputs", () => {
    expect(geomean([1, 100])).toBeCloseTo(10, 6);
    expect(geomean([5, 0])).toBe(0);
    expect(Number.isNaN(geomean([]))).toBe(true);
  });
});

describe("tiers, divisions, verdicts", () => {
  it("base categories are exactly the five scored ones; extended are reported only", () => {
    expect(BASE_CATEGORIES.sort()).toEqual(["long", "medium", "reasoning", "short", "ttft"]);
    expect(CATEGORY_TIER.concurrent).toBe("extended");
    expect(CATEGORY_TIER.long_context).toBe("extended");
    expect(CATEGORY_TIER.multi_turn).toBe("extended");
  });

  it("every benchmark prompt category has a tier", () => {
    for (const p of BENCHMARK_PROMPTS) {
      expect(CATEGORY_TIER[p.category], p.label).toBeDefined();
    }
  });

  it("closed-division reference models exist as presets on the right engine", () => {
    for (const [engine, id] of Object.entries(CLOSED_DIVISION_REFERENCE)) {
      const preset = PRESET_MODELS.find((m) => m.id === id);
      expect(preset, `${engine} reference ${id}`).toBeDefined();
      expect(preset!.engine).toBe(engine);
    }
  });

  it("divisionFor is closed only for the engine's reference preset", () => {
    expect(divisionFor("webllm", "webllm-llama-1b")).toBe("closed");
    expect(divisionFor("webllm", "webllm-phi-3.5-mini")).toBe("open");
    expect(divisionFor("mediapipe", "webllm-llama-1b")).toBe("open");
    expect(divisionFor("onnx", null)).toBe("open");
  });

  it("verdict thresholds are monotonic and cover zero", () => {
    for (let i = 1; i < VERDICTS.length; i++) expect(VERDICTS[i].min).toBeLessThan(VERDICTS[i - 1].min);
    expect(getVerdict(0).label).toBe("No, not yet");
    expect(getVerdict(15).label).toBe("Yes, you can AI!");
    expect(getVerdict(14.9).label).toBe("Mostly, yes");
    expect(getVerdict(1).label).toBe("Barely…");
  });

  it("quality smoke prompts all exist in the eval suite and have required keywords", () => {
    for (const id of QUALITY_SMOKE_PROMPT_IDS) {
      const p = EVAL_PROMPTS.find((e) => e.id === id);
      expect(p, id).toBeDefined();
      expect(p!.requiredKeywords.length).toBeGreaterThan(0);
    }
  });
});

describe("latency classes (MLPerf LLM constraints)", () => {
  it("classifies interactive / conversational / batch", () => {
    expect(classifyLatency(400, 25)).toBe("interactive");
    expect(classifyLatency(400, 60)).toBe("conversational"); // TPOT too slow for interactive
    expect(classifyLatency(1500, 20)).toBe("conversational"); // TTFT too slow for interactive
    expect(classifyLatency(3000, 20)).toBe("batch");
    expect(classifyLatency(100, 150)).toBe("batch");
  });
});

describe("sampleProblem (per-run validity)", () => {
  it("accepts a healthy sample", () => {
    expect(sampleProblem(sample())).toBeNull();
  });

  it("rejects NaN/Infinity/negative metrics", () => {
    expect(sampleProblem(sample({ tokensPerSecond: NaN }))).toMatch(/non-finite/);
    expect(sampleProblem(sample({ ttftMs: -1 }))).toMatch(/non-finite or negative/);
    expect(sampleProblem(sample({ timeMs: Infinity }))).toMatch(/non-finite/);
  });

  it("rejects impossible timing (TTFT after completion, zero duration)", () => {
    expect(sampleProblem(sample({ ttftMs: 5000, timeMs: 2000 }))).toMatch(/TTFT exceeds/);
    expect(sampleProblem(sample({ timeMs: 0 }))).toMatch(/zero-duration/);
  });

  it("rejects degenerate generations except in the ttft category", () => {
    expect(sampleProblem(sample({ tokensGenerated: 1 }))).toMatch(/degenerate/);
    expect(sampleProblem(sample({ category: "ttft", tokensGenerated: 1 }))).toBeNull();
  });
});

describe("aggregateRun", () => {
  it("scores a healthy suite: geomean of base medians, p90 TTFT, valid", () => {
    const stats = aggregateRun(healthySuite(3, 20));
    expect(stats.spec_version).toBe(METHODOLOGY_VERSION);
    expect(stats.validity.valid).toBe(true);
    expect(stats.validity.reasons).toEqual([]);
    // each base category: tps 20,21,22 → median 21; geomean of five 21s = 21
    expect(stats.overall_score).toBeCloseTo(21, 6);
    expect(stats.ttft_p90_ms).toBe(400);
    expect(stats.categories.find((c) => c.category === "concurrent")?.tier).toBe("extended");
  });

  it("extended categories never affect the overall score", () => {
    const base = healthySuite(3, 20);
    const boosted = base.map((s) =>
      CATEGORY_TIER[s.category as keyof typeof CATEGORY_TIER] === "extended"
        ? { ...s, tokensPerSecond: 999 }
        : s
    );
    expect(aggregateRun(boosted).overall_score).toBeCloseTo(aggregateRun(base).overall_score, 9);
  });

  it("is invalid when a base category is missing or under-sampled", () => {
    const missing = healthySuite(3).filter((s) => s.category !== "reasoning");
    const stats = aggregateRun(missing);
    expect(stats.validity.valid).toBe(false);
    expect(stats.validity.reasons.join()).toMatch(/reasoning: 0\/3/);

    const under = healthySuite(MIN_RUNS_PER_BASE_CATEGORY - 1);
    expect(aggregateRun(under).validity.valid).toBe(false);
  });

  it("drops malformed samples with a reason instead of poisoning percentiles", () => {
    const suite = [...healthySuite(3, 20), sample({ category: "short", tokensPerSecond: Infinity })];
    const stats = aggregateRun(suite);
    expect(stats.validity.reasons.some((r) => /non-finite/.test(r))).toBe(true);
    expect(Number.isFinite(stats.overall_score)).toBe(true);
  });

  it("uses the median so a single outlier run can't inflate the score", () => {
    const suite = healthySuite(3, 20);
    suite.push(sample({ category: "short", tokensPerSecond: 10_000 }));
    expect(aggregateRun(suite).overall_score).toBeLessThan(30);
  });

  it("flags thermal throttling when late runs are much slower than early ones", () => {
    // 12 decode runs: first four at 30 tok/s, last four at 10 tok/s.
    const runs: RunSample[] = [];
    const cats = ["short", "medium", "long", "reasoning"];
    for (let i = 0; i < 12; i++) {
      runs.push(sample({ category: cats[i % 4], tokensPerSecond: i < 4 ? 30 : i < 8 ? 20 : 10 }));
    }
    for (let i = 0; i < 3; i++) runs.push(sample({ category: "ttft", tokensGenerated: 1 }));
    const stats = aggregateRun(runs);
    expect(stats.thermal_decay).toBeCloseTo(10 / 30, 6);
    expect(stats.validity.reasons.join()).toMatch(/throttling/);
  });

  it("returns a zero score and 'batch' class for an empty run instead of NaN garbage", () => {
    const stats = aggregateRun([]);
    expect(stats.overall_score).toBe(0);
    expect(stats.latency_class).toBe("batch");
    expect(stats.validity.valid).toBe(false);
  });
});

describe("result tier and quality gate", () => {
  const good = aggregateRun(healthySuite());
  const bad = aggregateRun([]);

  it("certifies only valid stats that pass the quality gate", () => {
    expect(resultTierFor(good, QUALITY_GATE)).toBe("certified");
    expect(resultTierFor(good, QUALITY_GATE - 0.01)).toBe("valid");
    expect(resultTierFor(good, null)).toBe("valid");
    expect(resultTierFor(bad, 1)).toBe("invalid");
  });

  it("qualityScoreFrom averages finite scores and is null when nothing was scored", () => {
    expect(qualityScoreFrom([1, 0, 0.5])).toBeCloseTo(0.5, 6);
    expect(qualityScoreFrom([NaN])).toBeNull();
    expect(qualityScoreFrom([])).toBeNull();
  });
});

describe("MCP edge function parity", () => {
  // The Deno MCP server can't import from src/, so it carries a copy of the
  // methodology version and verdict thresholds. This guards against drift.
  const src = readFileSync(resolve(__dirname, "../../../supabase/functions/mcp/index.ts"), "utf8");

  it("advertises the same methodology version", () => {
    expect(src).toContain(`"${METHODOLOGY_VERSION}"`);
  });

  it("uses the same verdict thresholds and labels", () => {
    for (const v of VERDICTS) {
      if (v.min > 0) expect(src, v.label).toMatch(new RegExp(`>=\\s*${v.min}\\)\\s*return\\s*"${v.label}"`));
    }
    expect(src).toContain(`"${VERDICTS[VERDICTS.length - 1].label}"`);
  });
});
