/**
 * Reproducibility audit (roadmap 5.5).
 *
 * MLPerf audits submissions and demotes results that don't hold up. With
 * community-scale data we can do it statistically and deterministically:
 * within a round, once a device has enough certified runs, a run whose score
 * is implausibly far above that device's median is demoted from `certified`
 * to `valid` (still listed, never ranked). The database view
 * `benchmark_audit` (migration 20260913) applies exactly these rules at read
 * time, so the leaderboard self-heals as more runs arrive; this module is the
 * mirror used for client display and tests (a parity test checks the SQL
 * carries the same thresholds).
 *
 * Only implausibly HIGH scores are demoted: a low score is usually a real
 * condition (thermal throttling, background load) that the conditions
 * fields already explain, whereas a high outlier can only be a measurement
 * or reporting fault — and it is the one that would corrupt a leaderboard.
 */

/** A device needs this many certified runs before its median is trusted. */
export const AUDIT_MIN_RUNS = 5;
/** Demote a run scoring more than this multiple of the device median. */
export const AUDIT_OUTLIER_FACTOR = 2;

export interface AuditRow {
  id: string;
  spec_version: string | null;
  division: string | null;
  model_id: string | null;
  engine: string;
  device_key: string;
  overall_score: number | null;
  result_tier: string | null;
}

export interface AuditFlag {
  id: string;
  device_median: number;
  device_runs: number;
  overall_score: number;
  reason: string;
}

/** Interpolated median — matches Postgres percentile_cont(0.5) used by the
 * benchmark_audit view (unlike spec.ts's nearest-rank percentile). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = Math.floor(mid), hi = Math.ceil(mid);
  return (s[lo] + s[hi]) / 2;
}

export const groupKey = (r: AuditRow) => [r.spec_version, r.division, r.model_id, r.engine, r.device_key].join("|");

/** Flags certified rows that are implausible outliers for their device. */
export function auditOutliers(rows: AuditRow[]): AuditFlag[] {
  const groups = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (r.result_tier !== "certified" || r.overall_score == null || !Number.isFinite(r.overall_score) || !r.spec_version) continue;
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const flags: AuditFlag[] = [];
  for (const g of groups.values()) {
    if (g.length < AUDIT_MIN_RUNS) continue;
    const m = median(g.map((r) => r.overall_score as number));
    if (!(m > 0)) continue;
    for (const r of g) {
      const score = r.overall_score as number;
      if (score > AUDIT_OUTLIER_FACTOR * m) {
        flags.push({
          id: r.id,
          device_median: m,
          device_runs: g.length,
          overall_score: score,
          reason: `${score.toFixed(1)} tok/s is > ${AUDIT_OUTLIER_FACTOR}× this device's median of ${m.toFixed(1)} over ${g.length} runs`,
        });
      }
    }
  }
  return flags;
}

/** The tier a row is treated as after the audit. */
export function effectiveTier(row: Pick<AuditRow, "id" | "result_tier">, flags: AuditFlag[]): string | null {
  if (row.result_tier === "certified" && flags.some((f) => f.id === row.id)) return "valid";
  return row.result_tier;
}
