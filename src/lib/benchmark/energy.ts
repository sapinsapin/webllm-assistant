/**
 * Energy proxy (roadmap 5.4).
 *
 * MLPerf reports energy per stream from a power meter. Browsers expose no
 * power measurement, but the Battery Status API (Chrome/Android; absent on
 * iOS Safari) reports the battery level, so the level drop across the suite
 * gives a comparable proxy: **battery percentage points per 1,000 generated
 * tokens**. It is only meaningful when the device was on battery for the
 * whole run and the drop exceeds the API's reporting resolution (levels are
 * typically reported in 1 % steps), so every result carries an explicit
 * validity and reason instead of a fabricated number.
 */

export interface BatterySample {
  /** 0..1 as reported by navigator.getBattery(); null when unavailable. */
  level: number | null;
  charging: boolean | null;
}

export interface EnergyProxyInput {
  start: BatterySample | null;
  end: BatterySample | null;
  /** Decode tokens generated across the whole suite. */
  totalTokens: number;
}

export interface EnergyProxy {
  /** Battery percentage points consumed during the suite (0..100 scale). */
  battery_delta_pct: number | null;
  /** Percentage points per 1,000 generated tokens — the comparable figure. */
  battery_pct_per_1k_tokens: number | null;
  valid: boolean;
  reason: string | null;
}

/** Battery API levels are reported coarsely; a drop at or below this is
 * indistinguishable from noise, so it's reported as "below resolution". */
export const BATTERY_RESOLUTION_PCT = 1;

export function computeEnergyProxy({ start, end, totalTokens }: EnergyProxyInput): EnergyProxy {
  const invalid = (reason: string, delta: number | null = null): EnergyProxy => ({
    battery_delta_pct: delta,
    battery_pct_per_1k_tokens: null,
    valid: false,
    reason,
  });

  if (!start || !end || start.level == null || end.level == null) {
    return invalid("battery API unavailable");
  }
  if (start.charging || end.charging) {
    return invalid("device was charging during the run");
  }
  const delta = Math.round((start.level - end.level) * 100 * 100) / 100; // pct points, 2dp
  if (delta < 0) {
    return invalid("battery level rose during the run (charger connected?)", delta);
  }
  if (!(totalTokens > 0)) {
    return invalid("no tokens generated", delta);
  }
  if (delta <= BATTERY_RESOLUTION_PCT) {
    return invalid(`drop of ${delta}% is at or below the ${BATTERY_RESOLUTION_PCT}% reporting resolution`, delta);
  }
  return {
    battery_delta_pct: delta,
    battery_pct_per_1k_tokens: Math.round((delta / totalTokens) * 1000 * 1000) / 1000,
    valid: true,
    reason: null,
  };
}

/** Human label for the feed/suite badge. */
export function formatEnergyProxy(e: EnergyProxy | null | undefined): string | null {
  if (!e || !e.valid || e.battery_pct_per_1k_tokens == null) return null;
  return `≈${e.battery_pct_per_1k_tokens.toFixed(2)}% battery / 1k tok`;
}
