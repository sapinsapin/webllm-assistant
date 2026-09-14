import { loadAudioSamples, type SpeechModelPreset } from "@/lib/speech";
import type { SpeechAsrEngine } from "./types";

/**
 * whisper.cpp (GGML) compiled to WASM, via @remotion/whisper-web.
 *
 * Models are the stock ggml checkpoints streamed from
 * huggingface.co/ggerganov/whisper.cpp and cached in IndexedDB. The runtime
 * is multi-threaded WASM, which needs SharedArrayBuffer and therefore a
 * cross-origin-isolated page (COOP/COEP headers) — `isAvailable` reports
 * this instead of failing mid-benchmark.
 *
 * `repo` on these presets is the whisper.cpp model name, not a HF repo id.
 */
export const WHISPER_CPP_MODELS: SpeechModelPreset[] = [
  {
    id: "wcpp-tiny",
    name: "Whisper Tiny (ggml)",
    task: "asr",
    repo: "tiny",
    size: "~75MB",
    description: "Multilingual tiny checkpoint. Tagalog forced, matching the Filipino default.",
    language: "tl",
  },
  {
    id: "wcpp-base",
    name: "Whisper Base (ggml)",
    task: "asr",
    repo: "base",
    size: "~142MB",
    description: "Multilingual base checkpoint — better accuracy, still lightweight.",
    language: "tl",
  },
  {
    id: "wcpp-small",
    name: "Whisper Small (ggml)",
    task: "asr",
    repo: "small",
    size: "~466MB",
    description: "Same size class as the fine-tuned Filipino Whisper models.",
    language: "tl",
  },
];

const UNSUPPORTED_HINTS: Record<string, string> = {
  "not-cross-origin-isolated":
    "page is not cross-origin isolated — the host must send COOP/COEP headers for multi-threaded WASM",
  "indexed-db-unavailable": "IndexedDB is unavailable (private browsing?)",
  "not-enough-space": "not enough browser storage for the model",
};

// Loaded lazily so whisper.cpp stays out of the main bundle.
const loadWhisperWeb = () => import("@remotion/whisper-web");

export const whisperCppAsrEngine: SpeechAsrEngine = {
  id: "whispercpp",
  label: "whisper.cpp (WASM, experimental)",
  description:
    "GGML whisper.cpp compiled to multi-threaded WASM. Needs a cross-origin-isolated page.",
  models: WHISPER_CPP_MODELS,

  async isAvailable() {
    try {
      const { canUseWhisperWeb } = await loadWhisperWeb();
      const res = await canUseWhisperWeb("tiny");
      if (res.supported) return { supported: true };
      const hint = (res.reason && UNSUPPORTED_HINTS[res.reason]) || res.detailedReason || res.reason;
      return { supported: false, reason: hint || "whisper.cpp WASM is not supported here" };
    } catch (e) {
      return {
        supported: false,
        reason: e instanceof Error ? e.message : "failed to load the whisper.cpp runtime",
      };
    }
  },

  async runBenchmark(model, sample, onProgress) {
    const { canUseWhisperWeb, downloadWhisperModel, transcribe } = await loadWhisperWeb();
    type WhisperModel = Parameters<typeof downloadWhisperModel>[0]["model"];
    const ggmlModel = model.repo as WhisperModel;

    const support = await canUseWhisperWeb(ggmlModel);
    if (!support.supported) {
      const hint =
        (support.reason && UNSUPPORTED_HINTS[support.reason]) ||
        support.detailedReason ||
        support.reason;
      throw new Error(`whisper.cpp cannot run here: ${hint || "unsupported environment"}`);
    }

    onProgress(2, `Downloading ${model.name}…`);
    const loadStart = performance.now();
    await downloadWhisperModel({
      model: ggmlModel,
      onProgress: ({ progress }) =>
        onProgress(Math.min(2 + progress * 73, 75), `Downloading ${model.name}: ${Math.round(progress * 100)}%`),
    });
    const loadMs = performance.now() - loadStart;

    onProgress(76, "Decoding audio…");
    // loadAudioSamples already yields mono Float32 PCM at 16 kHz — exactly
    // the channelWaveform whisper.cpp expects.
    const audio = await loadAudioSamples(sample.url);

    onProgress(80, "Transcribing…");
    const inferStart = performance.now();
    const out = await transcribe({
      channelWaveform: audio.data,
      model: ggmlModel,
      language: (model.language as never) ?? "auto",
      threads: Math.min(navigator.hardwareConcurrency || 4, 8),
      onProgress: (p) => onProgress(Math.min(80 + p * 19, 99), `Transcribing: ${Math.round(p * 100)}%`),
    });
    const inferMs = performance.now() - inferStart;
    onProgress(100, "Done");

    const rtf = inferMs / 1000 / audio.seconds;
    return {
      modelName: model.name,
      repo: `ggerganov/whisper.cpp (ggml-${model.repo})`,
      device: "wasm (whisper.cpp)",
      loadMs,
      inferMs,
      audioSeconds: audio.seconds,
      rtf,
      xRealtime: rtf > 0 ? 1 / rtf : 0,
      transcript: out.transcription.map((t) => t.text).join("").trim(),
    };
  },
};
