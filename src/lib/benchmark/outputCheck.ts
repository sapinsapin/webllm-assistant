/**
 * Output checks (roadmap 5.6) — MLPerf's accuracy-target rule applied per
 * prompt: a performance sample only counts if the output is correct.
 * Checks are DECLARATIVE data (so the MCP server mirrors them verbatim and
 * external agents apply the same rule) and deterministic — no LLM judge.
 */

export type OutputCheck =
  | {
      kind: "json";
      /** Object keys that must be present (case-sensitive). */
      requiredKeys?: string[];
      /** Require a JSON array with at least this many items. */
      arrayMinLength?: number;
    }
  | {
      kind: "regex";
      /** Every pattern must match (case-insensitive, dotall). */
      all: string[];
    };

/** Pull the first JSON value out of prose / code fences; null if none parses. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = Math.min(...["{", "["].map((ch) => c.indexOf(ch)).filter((i) => i >= 0));
    if (!Number.isFinite(start)) continue;
    const open = c[start];
    const close = open === "{" ? "}" : "]";
    const end = c.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function checkOutput(check: OutputCheck | undefined, response: string): boolean | null {
  if (!check) return null;
  if (check.kind === "regex") {
    return check.all.every((p) => {
      try {
        return new RegExp(p, "is").test(response);
      } catch {
        return false;
      }
    });
  }
  const value = extractJson(response);
  if (value === null || typeof value !== "object") return false;
  if (check.arrayMinLength != null) {
    return Array.isArray(value) && value.length >= check.arrayMinLength;
  }
  if (Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (check.requiredKeys ?? []).every((k) => k in obj);
}
