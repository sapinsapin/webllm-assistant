/**
 * Schema-rollout compatibility for Supabase/PostgREST calls.
 *
 * The frontend and the database deploy independently (Lovable ships `main`
 * on merge; migrations need `supabase db push`). During that window the
 * client may reference columns or views the live schema doesn't have yet.
 * PostgREST reports this with a small set of codes; callers use
 * `isSchemaMismatch` to fall back to the legacy shape instead of failing —
 * a *known, temporary* condition, distinct from a real fetch error.
 */

import type { Json } from "@/integrations/supabase/types";

/** Plain data objects (interfaces without index signatures) aren't assignable
 * to the generated `Json` type; this is the one sanctioned cast for jsonb
 * columns — only ever pass JSON-serialisable data. */
export const asJson = (value: unknown): Json => value as Json;

export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

// 42703 undefined_column · 42P01 undefined_table (Postgres)
// PGRST204 column not in schema cache · PGRST205 table/view not in schema cache
const SCHEMA_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);
const SCHEMA_MESSAGE = /schema cache|does not exist|Could not find the/i;

export function isSchemaMismatch(err: PostgrestErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.code && SCHEMA_CODES.has(err.code)) return true;
  return !!err.message && SCHEMA_MESSAGE.test(err.message);
}

/** Columns added by methodology round 2026.09 — stripped from writes when
 * the live schema predates the migration. */
export const METHODOLOGY_COLUMNS = [
  "spec_version",
  "division",
  "model_id",
  "overall_score",
  "ttft_p90_ms",
  "tpot_p50_ms",
  "latency_class",
  "quality_score",
  "result_tier",
  "validity",
  "stats",
  "conditions",
  "engine_version",
] as const;

export function stripMethodologyColumns<T extends Record<string, unknown>>(row: T): Omit<T, (typeof METHODOLOGY_COLUMNS)[number]> {
  const out = { ...row } as Record<string, unknown>;
  for (const k of METHODOLOGY_COLUMNS) delete out[k];
  return out as Omit<T, (typeof METHODOLOGY_COLUMNS)[number]>;
}
