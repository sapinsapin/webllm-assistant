import type { AsrBenchmarkResult, AudioSample, SpeechModelPreset } from "@/lib/speech";

export type AsrEngineId = "transformers" | "whispercpp";

export interface AsrEngineAvailability {
  supported: boolean;
  /** Human-readable reason when unsupported (rendered in the UI, never swallowed) */
  reason?: string;
}

type ProgressFn = (pct: number, msg: string) => void;

/**
 * Engine contract for the speech benchmark, mirroring the interchangeability
 * principle of `InferenceEngine` (src/lib/inference/types.ts): SpeechBench
 * only talks to this interface, so ASR backends stay swappable.
 *
 * For the `whispercpp` engine, a preset's `repo` field holds the whisper.cpp
 * GGML model name ("tiny" | "base" | ...) instead of a Hugging Face repo id.
 */
export interface SpeechAsrEngine {
  id: AsrEngineId;
  label: string;
  description: string;
  models: SpeechModelPreset[];
  /** Cheap capability probe; must never throw. */
  isAvailable(): Promise<AsrEngineAvailability>;
  runBenchmark(
    model: SpeechModelPreset,
    sample: AudioSample,
    onProgress: ProgressFn
  ): Promise<AsrBenchmarkResult>;
}
