import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the three engine modules so createEngine() builds lightweight fakes —
// real engines import WebGPU/WASM runtimes and download models.
const h = vi.hoisted(() => ({
  behavior: {
    mediapipe: "fail" as "ok" | "fail",
    webllm: "ok" as "ok" | "fail",
    onnx: "ok" as "ok" | "fail",
  },
  loadCalls: [] as string[],
}));

function makeEngineClass(type: "mediapipe" | "webllm" | "onnx", label: string) {
  return class {
    type = type;
    label = label;
    async load(url: string) {
      h.loadCalls.push(`${type}:${url}`);
      if (h.behavior[type] === "fail") throw new Error(`${type} load failed`);
    }
    unload() {}
    formatPrompt() {
      return "";
    }
    async generateStream() {}
    async generateFull() {
      return { response: "", tokenCount: 0, timeMs: 0, ttftMs: 0, tpotMs: 0 };
    }
  };
}

vi.mock("@/lib/inference/mediapipe-engine", () => ({
  MediaPipeEngine: makeEngineClass("mediapipe", "MediaPipe (WebGPU)"),
}));
vi.mock("@/lib/inference/webllm-engine", () => ({
  WebLLMEngine: makeEngineClass("webllm", "WebLLM (WebGPU)"),
}));
vi.mock("@/lib/inference/onnx-engine", () => ({
  OnnxEngine: makeEngineClass("onnx", "Transformers.js (WASM)"),
}));

import { LlmInferenceProvider, useLlmInference } from "./LlmInferenceContext";

function Probe() {
  const { status, statusMessage, activeEngine, currentModelName, capabilities, loadModel } =
    useLlmInference();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="engine">{activeEngine ?? "none"}</span>
      <span data-testid="model">{currentModelName}</span>
      <span data-testid="caps">{capabilities.length}</span>
      <span data-testid="message">{statusMessage}</span>
      <button
        onClick={() => loadModel("https://example.com/model.task", "Primary Model", undefined, "mediapipe")}
      >
        load
      </button>
    </div>
  );
}

function setup() {
  render(
    <LlmInferenceProvider>
      <Probe />
    </LlmInferenceProvider>
  );
}

describe("LlmInferenceProvider engine fallback", () => {
  beforeEach(() => {
    h.loadCalls.length = 0;
    h.behavior.mediapipe = "fail";
    h.behavior.webllm = "ok";
    h.behavior.onnx = "ok";
    // Make WebGPU "available" so all three engines are in the fallback chain.
    (navigator as unknown as { gpu: unknown }).gpu = {
      requestAdapter: vi.fn().mockResolvedValue({}),
    };
  });

  it("falls back to the next engine (with its own model) when the preferred engine fails", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("caps").textContent).toBe("3"));

    await userEvent.click(screen.getByText("load"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("engine").textContent).toBe("webllm");
    // Fallback must swap to a model that belongs to the fallback engine.
    expect(h.loadCalls[0]).toBe("mediapipe:https://example.com/model.task");
    expect(h.loadCalls[1]).toMatch(/^webllm:/);
    expect(screen.getByTestId("model").textContent).not.toBe("Primary Model");
  });

  it("keeps falling until WASM succeeds", async () => {
    h.behavior.webllm = "fail";
    setup();
    await waitFor(() => expect(screen.getByTestId("caps").textContent).toBe("3"));

    await userEvent.click(screen.getByText("load"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("engine").textContent).toBe("onnx");
    expect(h.loadCalls).toHaveLength(3);
  });

  it("ends in a visible error state when every engine fails", async () => {
    h.behavior.webllm = "fail";
    h.behavior.onnx = "fail";
    setup();
    await waitFor(() => expect(screen.getByTestId("caps").textContent).toBe("3"));

    await userEvent.click(screen.getByText("load"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    // The failure reason must surface, not vanish into console.error.
    expect(screen.getByTestId("message").textContent).toContain("load failed");
  });

  it("loads directly on the preferred engine when it works", async () => {
    h.behavior.mediapipe = "ok";
    setup();
    await waitFor(() => expect(screen.getByTestId("caps").textContent).toBe("3"));

    await userEvent.click(screen.getByText("load"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("engine").textContent).toBe("mediapipe");
    expect(screen.getByTestId("model").textContent).toBe("Primary Model");
    expect(h.loadCalls).toHaveLength(1);
  });
});
