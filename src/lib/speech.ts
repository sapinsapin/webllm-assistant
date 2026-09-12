import { pipeline, env } from "@huggingface/transformers";
import { getNavigatorGpu } from "@/lib/browser";

export type SpeechTask = "asr" | "tts";

export interface SpeechModelPreset {
  id: string;
  name: string;
  task: SpeechTask;
  /** Hugging Face repo id passed to Transformers.js */
  repo: string;
  size: string;
  description: string;
  /** SpeechT5-style models need an external speaker embedding */
  speakerEmbeddings?: string;
  /** Forced transcription language for fine-tuned Whisper checkpoints */
  language?: string;
  /**
   * Force the WASM backend. Set for repos that ship only fp32 + q8 ONNX
   * variants (e.g. optimum-cli exports): the WebGPU path requests a q4
   * decoder that doesn't exist there and the load fails.
   */
  wasmOnly?: boolean;
}


const XENOVA_DOCS = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main";

export const SPEAKER_EMBEDDING_URL = `${XENOVA_DOCS}/speaker_embeddings.bin`;


/**
 * Default models (first entry of each list) are ONNX exports of the
 * sapinsapin Philippine-language fine-tunes, converted with
 * `optimum-cli export onnx` + dynamic q8 quantization.
 */
export const ASR_MODELS: SpeechModelPreset[] = [
  {
    id: "whisper-small-pld-fil",
    name: "Whisper Small PLD-FIL (Filipino)",
    task: "asr",
    repo: "internetoftim/whisper-small-pld-fil-ONNX",
    size: "~287MB (q8)",
    description:
      "sapinsapin's Filipino Whisper fine-tune, converted to ONNX for in-browser inference.",
    language: "tl",
    // The repo ships only fp32 + q8 variants — no q4 decoder for WebGPU.
    wasmOnly: true,
  },

  {
    id: "whisper-tiny-en",
    name: "Whisper Tiny (en)",
    task: "asr",
    repo: "onnx-community/whisper-tiny.en",
    size: "~40MB",
    description: "Fastest ASR. English only. Good baseline for weak devices.",
  },
  {
    id: "whisper-base",
    name: "Whisper Base (multilingual)",
    task: "asr",
    repo: "onnx-community/whisper-base",
    size: "~80MB",
    description: "Multilingual ASR, better accuracy, still small.",
  },
  {
    id: "whisper-small",
    name: "Whisper Small (multilingual)",
    task: "asr",
    repo: "onnx-community/whisper-small",
    size: "~250MB",
    description: "Same size class as the fine-tuned Filipino Whisper models.",
  },
  {
    id: "moonshine-tiny",
    name: "Moonshine Tiny (en)",
    task: "asr",
    repo: "onnx-community/moonshine-tiny-ONNX",
    size: "~50MB",
    description: "Streaming-oriented ASR built for on-device latency.",
  },
];

export const TTS_MODELS: SpeechModelPreset[] = [
  {
    id: "speecht5-pld-fil",
    name: "SpeechT5 PLD-FIL (Filipino)",
    task: "tts",
    repo: "internetoftim/speecht5_tts-pld-fil-ONNX",
    size: "~180MB (q8)",
    description:
      "sapinsapin's Filipino SpeechT5 fine-tune, converted to ONNX (HiFi-GAN vocoder bundled).",
    speakerEmbeddings: SPEAKER_EMBEDDING_URL,
  },

  {
    id: "speecht5",
    name: "SpeechT5 TTS (en)",
    task: "tts",
    repo: "Xenova/speecht5_tts",
    size: "~140MB",
    description: "Same architecture as the SpeechT5 Philippine-language fine-tunes.",
    speakerEmbeddings: SPEAKER_EMBEDDING_URL,
  },
  {
    id: "mms-tts-eng",
    name: "MMS TTS (en)",
    task: "tts",
    repo: "Xenova/mms-tts-eng",
    size: "~65MB",
    description: "VITS-based TTS, no speaker embedding required.",
  },
  {
    id: "mms-tts-tgl",
    name: "MMS TTS (Tagalog)",
    task: "tts",
    repo: "Xenova/mms-tts-tgl",
    size: "~65MB",
    description: "Tagalog VITS voice — closest runnable match for Filipino TTS.",
  },
];

export interface AudioSample {
  id: string;
  label: string;
  url: string;
}

export const ASR_SAMPLES: AudioSample[] = [
  { id: "jfk", label: "JFK (~11s, English)", url: `${XENOVA_DOCS}/jfk.wav` },
  { id: "mlk", label: "MLK (~30s, English)", url: `${XENOVA_DOCS}/mlk.wav` },
];

export const TTS_SENTENCES = [
  "On device inference keeps your data on your own hardware.",
  "The quick brown fox jumps over the lazy dog while the benchmark runs.",
  "Speech synthesis in the browser is measured in real time factor, not tokens per second.",
];

/* ------------------------------------------------------------------ *
 * Runtime compatibility check for arbitrary Hugging Face repos
 * ------------------------------------------------------------------ */

export interface RuntimeSupport {
  repo: string;
  supported: boolean;
  /** Detected task, if the repo declares one */
  pipelineTag?: string;
  library?: string;
  onnxFiles: string[];
  reason: string;
  /** Actionable next step when unsupported */
  hint?: string;
}

/**
 * Transformers.js (our WASM/WebGPU runtime) can only load repos that ship an
 * `onnx/` folder. PyTorch-only repos (`model.safetensors` with no ONNX export)
 * cannot run in the browser without a conversion step.
 */
export async function checkRuntimeSupport(repo: string): Promise<RuntimeSupport> {
  const clean = repo.trim().replace(/^https?:\/\/huggingface\.co\//, "").replace(/\/+$/, "");
  const res = await fetch(`https://huggingface.co/api/models/${clean}`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Model "${clean}" not found on Hugging Face (or it is gated/private).`
        : `Hugging Face API error (${res.status})`
    );
  }
  const data = (await res.json()) as {
    pipeline_tag?: string;
    library_name?: string;
    siblings?: Array<{ rfilename: string }>;
  };
  const files = (data.siblings || []).map((s) => s.rfilename);
  const onnxFiles = files.filter((f) => f.endsWith(".onnx"));
  const supported = onnxFiles.length > 0;

  return {
    repo: clean,
    supported,
    pipelineTag: data.pipeline_tag,
    library: data.library_name,
    onnxFiles,
    reason: supported
      ? `Found ${onnxFiles.length} ONNX file(s) — loadable by Transformers.js in the browser.`
      : "No ONNX weights in this repo — only PyTorch/safetensors, which the browser runtime cannot execute.",
    hint: supported
      ? undefined
      : "Export it with Optimum (`optimum-cli export onnx`) or the ONNX community conversion Space, then re-check.",
  };
}

/* ------------------------------------------------------------------ *
 * Benchmark runners
 * ------------------------------------------------------------------ */

export interface AsrBenchmarkResult {
  modelName: string;
  repo: string;
  device: string;
  loadMs: number;
  inferMs: number;
  audioSeconds: number;
  /** inference time / audio duration — lower is better, <1 means faster than realtime */
  rtf: number;
  /** how many seconds of audio processed per second of compute */
  xRealtime: number;
  transcript: string;
}

export interface TtsBenchmarkResult {
  modelName: string;
  repo: string;
  device: string;
  loadMs: number;
  inferMs: number;
  chars: number;
  audioSeconds: number;
  rtf: number;
  xRealtime: number;
  charsPerSecond: number;
  audioUrl: string;
}

type ProgressFn = (pct: number, msg: string) => void;

interface PipelineProgress {
  status?: string;
  progress?: number;
  file?: string;
}

export async function pickSpeechDevice(): Promise<"webgpu" | "wasm"> {
  const gpu = getNavigatorGpu();
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function progressHandler(onProgress: ProgressFn) {
  return (p: PipelineProgress) => {
    if (p.status === "download" || p.status === "progress") {
      const pct = Math.round(p.progress || 0);
      onProgress(Math.min(5 + pct * 0.9, 95), `Downloading ${p.file || ""}: ${pct}%`);
    } else if (p.status === "done") {
      onProgress(95, "Initializing…");
    }
  };
}

/** Fetches a wav/mp3 and decodes it to mono 16kHz Float32 samples. */
export async function loadAudioSamples(url: string): Promise<{ data: Float32Array; seconds: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download audio sample (${res.status})`);
  const buf = await res.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(buf);
  const data = decoded.getChannelData(0);
  await ctx.close();
  return { data: new Float32Array(data), seconds: decoded.duration };
}

/** Encodes Float32 PCM into a 16-bit WAV blob URL for playback. */
export function pcmToWavUrl(pcm: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
}

export async function runAsrBenchmark(
  model: SpeechModelPreset,
  sample: AudioSample,
  onProgress: ProgressFn
): Promise<AsrBenchmarkResult> {
  env.allowLocalModels = false;
  const device = model.wasmOnly ? "wasm" : await pickSpeechDevice();

  onProgress(2, `Loading ${model.name} (${device})…`);
  const loadStart = performance.now();
  const transcriber = (await pipeline("automatic-speech-recognition", model.repo, {
    device,
    dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: progressHandler(onProgress),
  })) as unknown as ((audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text?: string }>) & {
    dispose?: () => Promise<void>;
  };
  const loadMs = performance.now() - loadStart;

  onProgress(96, "Decoding audio…");
  const audio = await loadAudioSamples(sample.url);

  onProgress(98, "Transcribing…");
  const inferStart = performance.now();
  const out = await transcriber(audio.data, {
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(model.language ? { language: model.language, task: "transcribe" } : {}),
  });

  const inferMs = performance.now() - inferStart;

  await transcriber.dispose?.();
  onProgress(100, "Done");

  const rtf = inferMs / 1000 / audio.seconds;
  return {
    modelName: model.name,
    repo: model.repo,
    device,
    loadMs,
    inferMs,
    audioSeconds: audio.seconds,
    rtf,
    xRealtime: rtf > 0 ? 1 / rtf : 0,
    transcript: (out?.text || "").trim(),
  };
}

export async function runTtsBenchmark(
  model: SpeechModelPreset,
  sentence: string,
  onProgress: ProgressFn
): Promise<TtsBenchmarkResult> {
  env.allowLocalModels = false;
  // TTS decoders are not reliably supported on WebGPU yet — WASM is the safe path.
  const device = "wasm" as const;

  onProgress(2, `Loading ${model.name}…`);
  const loadStart = performance.now();
  const synth = (await pipeline("text-to-speech", model.repo, {
    device,
    dtype: "q8",
    progress_callback: progressHandler(onProgress),
  })) as unknown as ((text: string, opts?: Record<string, unknown>) => Promise<{
    audio: Float32Array;
    sampling_rate: number;
  }>) & { dispose?: () => Promise<void> };
  const loadMs = performance.now() - loadStart;

  onProgress(98, "Synthesizing…");
  const inferStart = performance.now();
  const out = await synth(
    sentence,
    model.speakerEmbeddings ? { speaker_embeddings: model.speakerEmbeddings } : undefined
  );
  const inferMs = performance.now() - inferStart;

  await synth.dispose?.();
  onProgress(100, "Done");

  const audioSeconds = out.audio.length / out.sampling_rate;
  const rtf = inferMs / 1000 / audioSeconds;
  return {
    modelName: model.name,
    repo: model.repo,
    device,
    loadMs,
    inferMs,
    chars: sentence.length,
    audioSeconds,
    rtf,
    xRealtime: rtf > 0 ? 1 / rtf : 0,
    charsPerSecond: sentence.length / (inferMs / 1000),
    audioUrl: pcmToWavUrl(out.audio, out.sampling_rate),
  };
}

/** Verdict for a speech benchmark based on real time factor. */
export function speechVerdict(rtf: number): { label: string; tone: "good" | "ok" | "bad"; emoji: string } {
  if (rtf <= 0.3) return { label: "Great", tone: "good", emoji: "🚀" };
  if (rtf <= 1) return { label: "Realtime capable", tone: "good", emoji: "👍" };
  if (rtf <= 3) return { label: "Slow", tone: "ok", emoji: "🐢" };
  return { label: "Not viable", tone: "bad", emoji: "⛔" };
}
