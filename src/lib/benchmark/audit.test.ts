import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_MIN_RUNS, AUDIT_OUTLIER_FACTOR, auditOutliers, effectiveTier, type AuditRow } from "./audit";

const row = (id: string, overall_score: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  spec_version: "2026.09",
  division: "closed",
  model_id: "webllm-llama-1b",
  engine: "webllm",
  device_key: "MacBook Pro M4",
  overall_score,
  result_tier: "certified",
  ...over,
});

describe("auditOutliers", () => {
  it("demotes a certified run scoring > 2× the device median once the device has enough runs", () => {
    const rows = [row("a", 40), row("b", 42), row("c", 41), row("d", 39), row("e", 40), row("x", 95)];
    const flags = auditOutliers(rows);
    expect(flags.map((f) => f.id)).toEqual(["x"]);
    expect(flags[0].device_runs).toBe(6);
    expect(flags[0].device_median).toBeCloseTo(40.5, 6);
    expect(flags[0].reason).toMatch(/> 2×/);
    expect(effectiveTier(rows[5], flags)).toBe("valid");
    expect(effectiveTier(rows[0], flags)).toBe("certified");
  });

  it("does nothing below the minimum run count — a small sample can't define an outlier", () => {
    // AUDIT_MIN_RUNS - 2 normal runs + the outlier = one short of the minimum.
    const rows = Array.from({ length: AUDIT_MIN_RUNS - 2 }, (_, i) => row(`r${i}`, 40));
    rows.push(row("x", 400));
    expect(auditOutliers(rows)).toEqual([]);
    // One more normal run reaches the minimum and the outlier is flagged.
    expect(auditOutliers([...rows, row("r9", 40)]).map((f) => f.id)).toEqual(["x"]);
  });

  it("does not demote low scores (throttling is real; only implausibly high ones corrupt rankings)", () => {
    const rows = [row("a", 40), row("b", 42), row("c", 41), row("d", 39), row("e", 40), row("slow", 5)];
    expect(auditOutliers(rows)).toEqual([]);
  });

  it("groups strictly by round, division, model, engine and device", () => {
    const base = [row("a", 40), row("b", 42), row("c", 41), row("d", 39), row("e", 40)];
    // Same device but a different model: its 95 is not an outlier of THIS group.
    const other = row("x", 95, { model_id: "webllm-phi-3.5-mini" });
    expect(auditOutliers([...base, other])).toEqual([]);
    const otherRound = row("y", 95, { spec_version: "2026.10" });
    expect(auditOutliers([...base, otherRound])).toEqual([]);
  });

  it("ignores non-certified, legacy, and malformed rows", () => {
    const rows = [row("a", 40), row("b", 42), row("c", 41), row("d", 39), row("e", 40),
      row("v", 95, { result_tier: "valid" }),
      row("l", 95, { spec_version: null }),
      row("n", NaN)];
    expect(auditOutliers(rows)).toEqual([]);
  });

  it("thresholds are exactly as documented", () => {
    expect(AUDIT_MIN_RUNS).toBe(5);
    expect(AUDIT_OUTLIER_FACTOR).toBe(2);
  });
});

describe("SQL parity", () => {
  it("the benchmark_audit view applies the same thresholds", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20260913000000_benchmark_audit.sql"), "utf8");
    expect(sql).toMatch(new RegExp(`runs\\s*>=\\s*${AUDIT_MIN_RUNS}\\b`));
    expect(sql).toMatch(new RegExp(`>\\s*${AUDIT_OUTLIER_FACTOR}\\s*\\*\\s*g\\.score_p50`));
  });
});
