import { transformersAsrEngine } from "./transformers-engine";
import { whisperCppAsrEngine } from "./whispercpp-engine";
import type { AsrEngineId, SpeechAsrEngine } from "./types";

export type { AsrEngineAvailability, AsrEngineId, SpeechAsrEngine } from "./types";
export { WHISPER_CPP_MODELS } from "./whispercpp-engine";

/** Transformers.js first — it is the default and works everywhere. */
export const ASR_ENGINES: SpeechAsrEngine[] = [transformersAsrEngine, whisperCppAsrEngine];

export function getAsrEngine(id: AsrEngineId): SpeechAsrEngine {
  const engine = ASR_ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`Unknown ASR engine: ${id}`);
  return engine;
}
