import { describe, it, expect } from "vitest";
import { confidenceFor, deviceKeyFor, rankLeaderboard, spreadRatio } from "./leaderboard";

describe("confidenceFor", () => {
  it("maps run counts to confidence tiers", () => {
    expect(confidenceFor(1)).toBe("single");
    expect(confidenceFor(2)).toBe("medium");
    expect(confidenceFor(4)).toBe("medium");
    expect(confidenceFor(5)).toBe("high");
    expect(confidenceFor(500)).toBe("high");
  });
});

describe("deviceKeyFor (mirrors the SQL device_key expression)", () => {
  it("prefers device_model", () => {
    expect(deviceKeyFor({ device_model: "Pixel 9", os: "Android", gpu: "adreno-7xx" })).toBe("Pixel 9");
  });

  it("falls back to os · gpu, then to Unknown device", () => {
    expect(deviceKeyFor({ device_model: "", os: "Windows", gpu: "ampere" })).toBe("Windows · ampere");
    expect(deviceKeyFor({ os: "Linux" })).toBe("Linux");
    expect(deviceKeyFor({})).toBe("Unknown device");
    expect(deviceKeyFor({ device_model: "   ", os: null, gpu: null })).toBe("Unknown device");
  });
});

describe("rankLeaderboard", () => {
  const row = (device_key: string, score_p50: number, runs = 1) => ({ device_key, score_p50, runs });

  it("orders by median score descending", () => {
    const ranked = rankLeaderboard([row("slow", 5), row("fast", 50), row("mid", 20)]);
    expect(ranked.map((r) => r.device_key)).toEqual(["fast", "mid", "slow"]);
  });

  it("breaks score ties by more runs, then device name", () => {
    const ranked = rankLeaderboard([row("b", 20, 1), row("a", 20, 1), row("c", 20, 7)]);
    expect(ranked.map((r) => r.device_key)).toEqual(["c", "a", "b"]);
  });

  it("sinks non-finite scores instead of crashing or floating them to the top", () => {
    const ranked = rankLeaderboard([row("nan", NaN), row("ok", 1)]);
    expect(ranked[0].device_key).toBe("ok");
  });

  it("does not mutate the input", () => {
    const input = [row("a", 1), row("b", 2)];
    rankLeaderboard(input);
    expect(input.map((r) => r.device_key)).toEqual(["a", "b"]);
  });
});

describe("spreadRatio", () => {
  it("is IQR over median", () => {
    expect(spreadRatio({ score_p25: 18, score_p50: 20, score_p75: 22 })).toBeCloseTo(0.2, 6);
  });

  it("is null without quartiles or with a non-positive median", () => {
    expect(spreadRatio({ score_p25: null, score_p50: 20, score_p75: null })).toBeNull();
    expect(spreadRatio({ score_p25: 1, score_p50: 0, score_p75: 2 })).toBeNull();
  });
});
