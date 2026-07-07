import { describe, it, expect } from "vitest";
import {
  EVAL_PROMPTS,
  scoreResponse,
  computeScore,
  computeHybridScore,
  computeCategoryAccuracy,
  type EvalPrompt,
  type EvalScore,
} from "./evals";

const basePrompt: EvalPrompt = {
  id: "test-1",
  label: "Test",
  category: "factual",
  prompt: "What is the capital of France?",
  requiredKeywords: ["paris"],
  expectedAnswer: "Paris",
};

describe("scoreResponse", () => {
  it("counts required keyword hits case-insensitively", () => {
    const b = scoreResponse(basePrompt, "The capital is PARIS.");
    expect(b.requiredHits).toBe(1);
    expect(b.requiredTotal).toBe(1);
  });

  it("misses when the keyword is absent", () => {
    const b = scoreResponse(basePrompt, "The capital is Lyon.");
    expect(b.requiredHits).toBe(0);
  });

  it("scores bonus keywords proportionally", () => {
    const p: EvalPrompt = { ...basePrompt, bonusKeywords: ["france", "europe"] };
    const b = scoreResponse(p, "Paris is in France.");
    expect(b.bonusHits).toBe(1);
    expect(b.bonusTotal).toBe(2);
  });

  it("evaluates exactPattern against the response", () => {
    const p: EvalPrompt = {
      ...basePrompt,
      exactPattern: '\\{[^}]*"greeting"\\s*:\\s*"hello"[^}]*\\}',
    };
    expect(scoreResponse(p, '{"greeting": "hello"}').patternMatch).toBe(true);
    expect(scoreResponse(p, "greeting hello").patternMatch).toBe(false);
  });

  it("treats an invalid regex as a failed pattern, not a crash", () => {
    const p: EvalPrompt = { ...basePrompt, exactPattern: "([unclosed" };
    expect(scoreResponse(p, "anything").patternMatch).toBe(false);
  });
});

describe("computeScore", () => {
  it("gives full marks when everything hits", () => {
    const score = computeScore({
      requiredHits: 1, requiredTotal: 1, bonusHits: 2, bonusTotal: 2, patternMatch: true,
    });
    expect(score).toBe(1);
  });

  it("gives ~0.3 when only required keywords miss", () => {
    const score = computeScore({
      requiredHits: 0, requiredTotal: 1, bonusHits: 0, bonusTotal: 0, patternMatch: null,
    });
    expect(score).toBeCloseTo(0.3, 2);
  });

  it("passing required alone earns the 0.7 weight", () => {
    const score = computeScore({
      requiredHits: 1, requiredTotal: 1, bonusHits: 0, bonusTotal: 0, patternMatch: null,
    });
    expect(score).toBe(1); // bonus and pattern weights granted when absent
  });
});

describe("computeHybridScore", () => {
  it("returns keyword score when there is no judge score", () => {
    expect(computeHybridScore(0.8)).toBe(0.8);
  });

  it("blends 60% judge + 40% keyword", () => {
    // judge 5 → normalized 1.0; 0.6*1 + 0.4*0.5 = 0.8
    expect(computeHybridScore(0.5, 5)).toBe(0.8);
    // judge 1 → normalized 0; 0.6*0 + 0.4*1 = 0.4
    expect(computeHybridScore(1, 1)).toBe(0.4);
  });
});

describe("computeCategoryAccuracy", () => {
  const mkScore = (evalId: string, score: number): EvalScore => ({
    evalId,
    score,
    maxScore: 1,
    response: "",
    timeMs: 0,
    tokensGenerated: 0,
    breakdown: { requiredHits: 0, requiredTotal: 0, bonusHits: 0, bonusTotal: 0, patternMatch: null },
  });

  it("averages per category and zeroes untested categories", () => {
    const factIds = EVAL_PROMPTS.filter((e) => e.category === "factual").slice(0, 2);
    const acc = computeCategoryAccuracy([
      mkScore(factIds[0].id, 1),
      mkScore(factIds[1].id, 0),
    ]);
    expect(acc.factual).toBe(0.5);
    expect(acc.math).toBe(0);
    expect(acc.safety).toBe(0);
  });

  it("ignores scores for unknown eval ids", () => {
    const acc = computeCategoryAccuracy([mkScore("does-not-exist", 1)]);
    expect(Object.values(acc).every((v) => v === 0)).toBe(true);
  });
});

describe("EVAL_PROMPTS dataset sanity", () => {
  it("has unique ids", () => {
    const ids = EVAL_PROMPTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every prompt has at least one required keyword", () => {
    for (const e of EVAL_PROMPTS) {
      expect(e.requiredKeywords.length, e.id).toBeGreaterThan(0);
    }
  });
});
