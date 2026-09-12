import { describe, it, expect } from "vitest";
import { isSchemaMismatch, stripMethodologyColumns, METHODOLOGY_COLUMNS } from "./supabaseCompat";

describe("isSchemaMismatch", () => {
  it("recognizes PostgREST schema-cache errors for missing columns and views", () => {
    expect(isSchemaMismatch({ code: "PGRST204", message: "Could not find the 'overall_score' column of 'benchmark_runs' in the schema cache" })).toBe(true);
    expect(isSchemaMismatch({ code: "PGRST205", message: "Could not find the table 'public.benchmark_leaderboard' in the schema cache" })).toBe(true);
  });

  it("recognizes raw Postgres undefined column/table codes", () => {
    expect(isSchemaMismatch({ code: "42703", message: "column x does not exist" })).toBe(true);
    expect(isSchemaMismatch({ code: "42P01", message: "relation y does not exist" })).toBe(true);
  });

  it("falls back to the message when the code is missing", () => {
    expect(isSchemaMismatch({ message: "relation \"benchmark_leaderboard\" does not exist" })).toBe(true);
  });

  it("does not treat real failures as schema mismatches", () => {
    expect(isSchemaMismatch({ code: "42501", message: "permission denied for table benchmark_runs" })).toBe(false);
    expect(isSchemaMismatch({ message: "Failed to fetch" })).toBe(false);
    expect(isSchemaMismatch(null)).toBe(false);
    expect(isSchemaMismatch(undefined)).toBe(false);
  });
});

describe("stripMethodologyColumns", () => {
  it("removes every 2026.09 column and keeps legacy ones, without mutating input", () => {
    const row = { model_name: "m", engine: "onnx", avg_tps: 1, overall_score: 2, result_tier: "certified", stats: {} };
    const out = stripMethodologyColumns(row);
    expect(out).toEqual({ model_name: "m", engine: "onnx", avg_tps: 1 });
    expect(row.overall_score).toBe(2);
    for (const k of METHODOLOGY_COLUMNS) expect(k in out).toBe(false);
  });
});
