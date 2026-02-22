export type { EngineType, EngineStatus, EngineCapability, InferenceEngine, InferenceCallbacks, GenerationResult } from "./types";
export { detectCapabilities, getBestEngine } from "./detect";
export { MediaPipeEngine } from "./mediapipe-engine";
export { WebLLMEngine } from "./webllm-engine";
export { OnnxEngine } from "./onnx-engine";

import type { EngineType, InferenceEngine } from "./types";
import { MediaPipeEngine } from "./mediapipe-engine";
import { WebLLMEngine } from "./webllm-engine";
import { OnnxEngine } from "./onnx-engine";

export function createEngine(type: EngineType): InferenceEngine {
  switch (type) {
    case "mediapipe":
      return new MediaPipeEngine();
    case "webllm":
      return new WebLLMEngine();
    case "onnx":
      return new OnnxEngine();
  }
}
