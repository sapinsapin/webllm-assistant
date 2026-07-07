import { describe, it, expect } from "vitest";
import { PRESET_MODELS, getModelsForEngine, getSmallestModel, getBestQuickStartModel } from "./models";

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
