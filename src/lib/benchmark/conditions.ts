/**
 * Run conditions captured alongside a benchmark — MLPerf Mobile's design
 * principle #4: "testing conditions must closely match the environments in
 * which mobile devices typically serve, such as ambient temperature and
 * battery power." Browsers expose very little, so this is best-effort and
 * every field is nullable; nothing here may throw.
 */

import { computeEnergyProxy, type BatterySample, type EnergyProxy } from "./energy";

export interface RunConditions {
  /** navigator.getBattery() at the END of the suite — Chrome/Android only. */
  battery_charging: boolean | null;
  battery_level: number | null;
  /** …and at the START, so the drop across the suite can be computed. */
  battery_level_start: number | null;
  battery_charging_start: boolean | null;
  /** Battery % per 1k generated tokens (MLPerf energy-per-stream proxy);
   * carries its own validity + reason. */
  energy: EnergyProxy;
  /** Tab was hidden at some point during the run (throttled timers/GPU). */
  page_hidden_during_run: boolean;
  /** navigator.connection.effectiveType, where available. */
  network_type: string | null;
  /** Wall-clock duration of the whole suite, ms. */
  suite_duration_ms: number | null;
}

interface BatteryLike {
  charging: boolean;
  level: number;
}

/** Read the battery once; nulls when the API is missing or blocked. Call at
 * suite start and again at the end. */
export async function sampleBattery(): Promise<BatterySample> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery === "function") {
      const b = await nav.getBattery();
      return {
        charging: typeof b.charging === "boolean" ? b.charging : null,
        level: typeof b.level === "number" ? b.level : null,
      };
    }
  } catch {
    // unsupported or blocked by permissions policy
  }
  return { charging: null, level: null };
}

export async function captureRunConditions(extra: {
  pageHiddenDuringRun: boolean;
  suiteDurationMs: number | null;
  batteryStart: BatterySample | null;
  totalTokens: number;
}): Promise<RunConditions> {
  const end = await sampleBattery();
  const battery_charging = end.charging;
  const battery_level = end.level;

  let network_type: string | null = null;
  try {
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    network_type = conn?.effectiveType ?? null;
  } catch {
    // ignore
  }

  return {
    battery_charging,
    battery_level,
    battery_level_start: extra.batteryStart?.level ?? null,
    battery_charging_start: extra.batteryStart?.charging ?? null,
    energy: computeEnergyProxy({ start: extra.batteryStart, end, totalTokens: extra.totalTokens }),
    page_hidden_during_run: extra.pageHiddenDuringRun,
    network_type,
    suite_duration_ms: extra.suiteDurationMs,
  };
}
