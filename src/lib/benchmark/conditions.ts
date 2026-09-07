/**
 * Run conditions captured alongside a benchmark — MLPerf Mobile's design
 * principle #4: "testing conditions must closely match the environments in
 * which mobile devices typically serve, such as ambient temperature and
 * battery power." Browsers expose very little, so this is best-effort and
 * every field is nullable; nothing here may throw.
 */

export interface RunConditions {
  /** navigator.getBattery() — Chrome/Android only. */
  battery_charging: boolean | null;
  battery_level: number | null;
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

export async function captureRunConditions(extra: {
  pageHiddenDuringRun: boolean;
  suiteDurationMs: number | null;
}): Promise<RunConditions> {
  let battery_charging: boolean | null = null;
  let battery_level: number | null = null;
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery === "function") {
      const b = await nav.getBattery();
      battery_charging = typeof b.charging === "boolean" ? b.charging : null;
      battery_level = typeof b.level === "number" ? b.level : null;
    }
  } catch {
    // unsupported or blocked by permissions policy
  }

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
    page_hidden_during_run: extra.pageHiddenDuringRun,
    network_type,
    suite_duration_ms: extra.suiteDurationMs,
  };
}
