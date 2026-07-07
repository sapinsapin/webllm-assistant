import { describe, it, expect } from "vitest";
import { getBestEngine, getFallbackChain } from "./detect";
import type { EngineCapability } from "./types";

const caps = (overrides: Partial<Record<string, boolean>> = {}): EngineCapability[] => [
  { engine: "mediapipe", label: "MediaPipe (WebGPU)", available: overrides.mediapipe ?? true, priority: 1 },
  { engine: "webllm", label: "WebLLM (WebGPU)", available: overrides.webllm ?? true, priority: 2 },
  { engine: "onnx", label: "Transformers.js (WASM)", available: overrides.onnx ?? true, priority: 3 },
];

describe("getBestEngine", () => {
  it("prefers mediapipe when WebGPU is available", () => {
    expect(getBestEngine(caps())).toBe("mediapipe");
  });

  it("falls to onnx when WebGPU engines are unavailable", () => {
    expect(getBestEngine(caps({ mediapipe: false, webllm: false }))).toBe("onnx");
  });

  it("defaults to onnx with no capabilities at all", () => {
    expect(getBestEngine([])).toBe("onnx");
  });
});

describe("getFallbackChain", () => {
  it("puts the preferred engine first, then others by priority", () => {
    expect(getFallbackChain(caps(), "mediapipe")).toEqual(["mediapipe", "webllm", "onnx"]);
  });

  it("does not duplicate the preferred engine", () => {
    const chain = getFallbackChain(caps(), "webllm");
    expect(chain).toEqual(["webllm", "mediapipe", "onnx"]);
    expect(chain.filter((e) => e === "webllm")).toHaveLength(1);
  });

  it("skips unavailable engines", () => {
    expect(getFallbackChain(caps({ webllm: false }), "mediapipe")).toEqual(["mediapipe", "onnx"]);
  });

  it("always includes onnx as a last resort, even with empty capabilities", () => {
    expect(getFallbackChain([], "mediapipe")).toEqual(["mediapipe", "onnx"]);
    expect(getFallbackChain([], "onnx")).toEqual(["onnx"]);
  });
});
