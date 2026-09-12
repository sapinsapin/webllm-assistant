import { describe, it, expect, vi, afterEach } from "vitest";
import { sampleBattery, captureRunConditions } from "./conditions";

afterEach(() => vi.unstubAllGlobals());

describe("sampleBattery", () => {
  it("returns nulls when the Battery API is absent (iOS Safari, Firefox)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await sampleBattery()).toEqual({ level: null, charging: null });
  });

  it("returns level and charging when available, and swallows API errors", async () => {
    vi.stubGlobal("navigator", { getBattery: async () => ({ level: 0.42, charging: false }) });
    expect(await sampleBattery()).toEqual({ level: 0.42, charging: false });
    vi.stubGlobal("navigator", { getBattery: async () => { throw new Error("blocked by permissions policy"); } });
    expect(await sampleBattery()).toEqual({ level: null, charging: null });
  });
});

describe("captureRunConditions", () => {
  it("records start/end battery and a valid energy proxy for an on-battery run", async () => {
    vi.stubGlobal("navigator", { getBattery: async () => ({ level: 0.7, charging: false }), connection: { effectiveType: "4g" } });
    const c = await captureRunConditions({
      pageHiddenDuringRun: false,
      suiteDurationMs: 120_000,
      batteryStart: { level: 0.75, charging: false },
      totalTokens: 2500,
    });
    expect(c.battery_level_start).toBe(0.75);
    expect(c.battery_level).toBe(0.7);
    expect(c.energy.valid).toBe(true);
    expect(c.energy.battery_pct_per_1k_tokens).toBeCloseTo(2, 6);
    expect(c.network_type).toBe("4g");
  });

  it("never throws and marks the proxy invalid without the API", async () => {
    vi.stubGlobal("navigator", {});
    const c = await captureRunConditions({ pageHiddenDuringRun: true, suiteDurationMs: null, batteryStart: null, totalTokens: 10 });
    expect(c.energy.valid).toBe(false);
    expect(c.page_hidden_during_run).toBe(true);
  });
});
