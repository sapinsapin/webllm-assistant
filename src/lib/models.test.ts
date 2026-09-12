import { describe, it, expect } from "vitest";
import { PRESET_MODELS, BENCHMARK_PROMPTS, LONG_CONTEXT_4K_PASSAGE, buildLongContext4k, getModelsForEngine, getSmallestModel, getBestQuickStartModel, getGemma4Model } from "./models";

describe("PRESET_MODELS", () => {
  it("has unique ids", () => {
    const ids = PRESET_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every engine has at least one model to fall back to", () => {
    for (const engine of ["mediapipe", "webllm", "onnx"] as const) {
      expect(getModelsForEngine(engine).length, engine).toBeGreaterThan(0);
    }
  });

  it("webllm and onnx (the fallback engines) each have a non-gated model", () => {
    // The cross-engine fallback chain skips gated models; without a non-gated
    // model on the fallback engines, fallback would be impossible.
    for (const engine of ["webllm", "onnx"] as const) {
      expect(getModelsForEngine(engine).some((m) => !m.gated), engine).toBe(true);
    }
  });
});

describe("getSmallestModel", () => {
  it("prefers a non-gated model for the engine", () => {
    const m = getSmallestModel("webllm");
    expect(m).not.toBeNull();
    expect(m!.gated).toBe(false);
    expect(m!.engine).toBe("webllm");
  });
});

describe("getBestQuickStartModel", () => {
  it("picks the highest-priority available engine's first model", () => {
    const m = getBestQuickStartModel([
      { engine: "mediapipe", available: false, priority: 1 },
      { engine: "webllm", available: true, priority: 2 },
      { engine: "onnx", available: true, priority: 3 },
    ]);
    expect(m?.engine).toBe("webllm");
  });

  it("returns null when nothing is available", () => {
    expect(getBestQuickStartModel([])).toBeNull();
  });
});

describe("Gemma 4 web presets", () => {
  const gemma4 = PRESET_MODELS.filter((m) => m.id.startsWith("gemma-4-"));

  it("exist for both E2B and E4B", () => {
    expect(gemma4.map((m) => m.id).sort()).toEqual(["gemma-4-e2b", "gemma-4-e4b"]);
  });

  it("point at the web-optimized LiteRT builds (not desktop/mobile bundles)", () => {
    // LiteRT-LM ships a web-specific model because of browser memory
    // constraints — the preset must use the `-web.task` artifact from the
    // official litert-community repos.
    for (const m of gemma4) {
      expect(m.url, m.id).toMatch(/^https:\/\/huggingface\.co\/litert-community\/gemma-4-/);
      expect(m.url, m.id).toMatch(/-web\.task$/);
    }
  });

  it("are MediaPipe-engine, vision-capable, and gated (license acceptance)", () => {
    for (const m of gemma4) {
      expect(m.engine, m.id).toBe("mediapipe");
      expect(m.vision, m.id).toBe(true);
      expect(m.gated, m.id).toBe(true);
    }
  });
});

describe("getGemma4Model", () => {
  it("returns the Gemma 4 E2B preset when MediaPipe/WebGPU is available", () => {
    const m = getGemma4Model([
      { engine: "mediapipe", available: true },
      { engine: "onnx", available: true },
    ]);
    expect(m?.id).toBe("gemma-4-e2b");
  });

  it("returns null on devices without MediaPipe (e.g. iOS Safari) instead of an unloadable model", () => {
    expect(
      getGemma4Model([
        { engine: "mediapipe", available: false },
        { engine: "onnx", available: true },
      ])
    ).toBeNull();
    expect(getGemma4Model([])).toBeNull();
  });
});

describe("4K-context prompt (MLPerf Client 4K prompt class)", () => {
  const p4k = BENCHMARK_PROMPTS.find((p) => p.category === "long_context_4k")!;

  it("exists as a single-run extended prompt with a ~4K-token context", () => {
    expect(p4k).toBeDefined();
    expect(p4k.runs).toBe(1);
    expect(p4k.context).toBe(LONG_CONTEXT_4K_PASSAGE);
    expect(LONG_CONTEXT_4K_PASSAGE.length).toBeGreaterThanOrEqual(16_000);
    expect(LONG_CONTEXT_4K_PASSAGE.length).toBeLessThan(17_000);
  });

  it("is deterministic — identical on every device and run", () => {
    expect(buildLongContext4k()).toBe(LONG_CONTEXT_4K_PASSAGE);
  });

  it("the QA question is answerable from the passage (Section 7 → LSM trees / memtable)", () => {
    expect(LONG_CONTEXT_4K_PASSAGE).toContain("Section 7: storage. The recommended technique in this section is log-structured merge trees");
    expect(LONG_CONTEXT_4K_PASSAGE).toContain("memtable");
  });
});
