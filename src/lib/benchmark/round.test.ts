import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROUND_REGISTRY,
  LEGACY_ROUND,
  computeRoundFingerprint,
  currentRound,
  currentRoundInputs,
  fingerprintOf,
  roundOptions,
  stableStringify,
} from "./round";
import { METHODOLOGY_VERSION } from "./spec";

describe("round registry (MLPerf-style versioning)", () => {
  it("the last registered round is the current METHODOLOGY_VERSION", () => {
    expect(currentRound().version).toBe(METHODOLOGY_VERSION);
  });

  it("versions are unique, YYYY.MM, and chronological", () => {
    const versions = ROUND_REGISTRY.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const v of versions) expect(v).toMatch(/^\d{4}\.\d{2}$/);
    expect([...versions].sort()).toEqual(versions);
  });

  it("the current round's fingerprint matches the round-defining inputs — change them and you must open a new round", () => {
    const computed = computeRoundFingerprint();
    expect(
      currentRound().fingerprint,
      `Round inputs changed (prompts / reference presets / quality set / tiers / thresholds). ` +
        `Bump METHODOLOGY_VERSION, append a ROUND_REGISTRY entry with fingerprint "${computed}", ` +
        `and add a docs/METHODOLOGY_CHANGELOG.md entry.`
    ).toBe(computed);
  });

  it("every round has a changelog entry", () => {
    const changelog = readFileSync(resolve(__dirname, "../../../docs/METHODOLOGY_CHANGELOG.md"), "utf8");
    for (const r of ROUND_REGISTRY) {
      expect(changelog, r.version).toContain(`## ${r.version}`);
      expect(changelog, `${r.version} fingerprint`).toContain(r.fingerprint);
    }
  });

  it("the MCP server advertises every round", () => {
    const src = readFileSync(resolve(__dirname, "../../../supabase/functions/mcp/index.ts"), "utf8");
    for (const r of ROUND_REGISTRY) expect(src, r.version).toContain(`"${r.version}"`);
  });
});

describe("fingerprinting", () => {
  it("is stable across key order and detects any input change", () => {
    const a = fingerprintOf({ x: 1, y: [1, 2] });
    const b = fingerprintOf({ y: [1, 2], x: 1 });
    expect(a).toBe(b);
    expect(fingerprintOf({ x: 1, y: [1, 3] })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changing a single prompt word changes the round fingerprint", () => {
    const inputs = currentRoundInputs();
    const mutated = { ...inputs, prompts: inputs.prompts.map((p, i) => (i === 0 ? { ...p, prompt: p.prompt + "!" } : p)) };
    expect(fingerprintOf(mutated)).not.toBe(fingerprintOf(inputs));
  });

  it("changing a threshold or reference preset changes the round fingerprint", () => {
    const inputs = currentRoundInputs();
    expect(fingerprintOf({ ...inputs, thresholds: { ...inputs.thresholds, QUALITY_GATE: 0.6 } })).not.toBe(fingerprintOf(inputs));
    expect(fingerprintOf({ ...inputs, reference: { ...inputs.reference, onnx: "other" } })).not.toBe(fingerprintOf(inputs));
  });

  it("stableStringify sorts nested keys and preserves arrays", () => {
    expect(stableStringify({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });
});

describe("roundOptions", () => {
  it("lists newest round first, marks the current one, and adds all/legacy on request", () => {
    const opts = roundOptions({ includeAll: true, includeLegacy: true });
    expect(opts[0]).toEqual({ value: "all", label: "All rounds" });
    expect(opts[1].value).toBe(METHODOLOGY_VERSION);
    expect(opts[1].label).toMatch(/current/);
    expect(opts[opts.length - 1].value).toBe(LEGACY_ROUND);
    expect(roundOptions().map((o) => o.value)).toEqual(ROUND_REGISTRY.map((r) => r.version).reverse());
  });
});
