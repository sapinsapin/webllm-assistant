import { describe, it, expect } from "vitest";
import { computeEnergyProxy, formatEnergyProxy, BATTERY_RESOLUTION_PCT } from "./energy";

const s = (level: number | null, charging: boolean | null = false) => ({ level, charging });

describe("computeEnergyProxy (battery % per 1k tokens)", () => {
  it("computes the proxy from a clean on-battery run", () => {
    const e = computeEnergyProxy({ start: s(0.8), end: s(0.76), totalTokens: 2000 });
    expect(e.valid).toBe(true);
    expect(e.battery_delta_pct).toBeCloseTo(4, 6);
    expect(e.battery_pct_per_1k_tokens).toBeCloseTo(2, 6);
    expect(e.reason).toBeNull();
  });

  it("is invalid without the battery API (e.g. iOS Safari) — never a fabricated number", () => {
    expect(computeEnergyProxy({ start: null, end: null, totalTokens: 1000 })).toMatchObject({ valid: false, reason: "battery API unavailable", battery_pct_per_1k_tokens: null });
    expect(computeEnergyProxy({ start: s(null), end: s(0.5), totalTokens: 1000 }).valid).toBe(false);
  });

  it("is invalid if the device was charging at either end", () => {
    expect(computeEnergyProxy({ start: s(0.8, true), end: s(0.79), totalTokens: 1000 }).reason).toMatch(/charging/);
    expect(computeEnergyProxy({ start: s(0.8), end: s(0.79, true), totalTokens: 1000 }).reason).toMatch(/charging/);
  });

  it("is invalid when the level rose (charger connected mid-run)", () => {
    const e = computeEnergyProxy({ start: s(0.5), end: s(0.6), totalTokens: 1000 });
    expect(e.valid).toBe(false);
    expect(e.battery_delta_pct).toBeCloseTo(-10, 6);
  });

  it("treats a drop at or below the reporting resolution as unmeasurable, not zero energy", () => {
    const e = computeEnergyProxy({ start: s(0.5), end: s(0.5 - BATTERY_RESOLUTION_PCT / 100), totalTokens: 5000 });
    expect(e.valid).toBe(false);
    expect(e.reason).toMatch(/resolution/);
    expect(e.battery_pct_per_1k_tokens).toBeNull();
  });

  it("is invalid with no generated tokens", () => {
    expect(computeEnergyProxy({ start: s(0.9), end: s(0.8), totalTokens: 0 }).reason).toMatch(/no tokens/);
  });

  it("formats only valid results", () => {
    expect(formatEnergyProxy(computeEnergyProxy({ start: s(0.8), end: s(0.76), totalTokens: 2000 }))).toBe("≈2.00% battery / 1k tok");
    expect(formatEnergyProxy(computeEnergyProxy({ start: null, end: null, totalTokens: 1 }))).toBeNull();
    expect(formatEnergyProxy(null)).toBeNull();
  });
});
