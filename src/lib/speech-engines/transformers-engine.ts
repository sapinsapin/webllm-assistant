import { ASR_MODELS, runAsrBenchmark } from "@/lib/speech";
import type { SpeechAsrEngine } from "./types";

/** The existing Transformers.js (ONNX WASM/WebGPU) path, behind the engine contract. */
export const transformersAsrEngine: SpeechAsrEngine = {
  id: "transformers",
  label: "Transformers.js (ONNX)",
  description: "WebGPU with WASM fallback. Runs any Hugging Face repo with ONNX weights.",
  models: ASR_MODELS,
  // Always available: the WASM backend works everywhere, incl. iOS Safari.
  isAvailable: async () => ({ supported: true }),
  runBenchmark: (model, sample, onProgress) => runAsrBenchmark(model, sample, onProgress),
};
