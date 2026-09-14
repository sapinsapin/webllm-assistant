import { beforeEach, describe, expect, it, vi } from "vitest";

const whisperWeb = {
  canUseWhisperWeb: vi.fn(),
  downloadWhisperModel: vi.fn(),
  transcribe: vi.fn(),
};
vi.mock("@remotion/whisper-web", () => whisperWeb);

vi.mock("@/lib/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/speech")>();
  return {
    ...actual,
    // jsdom has no AudioContext; 2s of fake 16kHz audio is enough for math.
    loadAudioSamples: vi.fn(async () => ({ data: new Float32Array(32000), seconds: 2 })),
  };
});

import { ASR_ENGINES, getAsrEngine } from "./index";
import { whisperCppAsrEngine, WHISPER_CPP_MODELS } from "./whispercpp-engine";

const sample = { id: "jfk", label: "JFK", url: "https://example.test/jfk.wav" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ASR engine registry", () => {
  it("keeps Transformers.js as the first (default) engine", () => {
    expect(ASR_ENGINES[0].id).toBe("transformers");
    expect(ASR_ENGINES.map((e) => e.id)).toContain("whispercpp");
  });

  it("throws on unknown engine ids", () => {
    expect(() => getAsrEngine("nope" as never)).toThrow(/Unknown ASR engine/);
  });

  it("gives every whisper.cpp preset a ggml model name and forced language", () => {
    for (const m of WHISPER_CPP_MODELS) {
      expect(["tiny", "tiny.en", "base", "base.en", "small", "small.en"]).toContain(m.repo);
      expect(m.task).toBe("asr");
      expect(m.language).toBe("tl");
    }
  });
});

describe("whisperCppAsrEngine", () => {
  it("reports unsupported environments with a readable reason", async () => {
    whisperWeb.canUseWhisperWeb.mockResolvedValue({
      supported: false,
      reason: "not-cross-origin-isolated",
    });
    const availability = await whisperCppAsrEngine.isAvailable();
    expect(availability.supported).toBe(false);
    expect(availability.reason).toMatch(/COOP\/COEP/);
  });

  it("never throws from isAvailable even when the runtime fails to load", async () => {
    whisperWeb.canUseWhisperWeb.mockRejectedValue(new Error("wasm boom"));
    const availability = await whisperCppAsrEngine.isAvailable();
    expect(availability).toEqual({ supported: false, reason: "wasm boom" });
  });

  it("refuses to benchmark when unsupported instead of failing opaquely", async () => {
    whisperWeb.canUseWhisperWeb.mockResolvedValue({
      supported: false,
      reason: "indexed-db-unavailable",
    });
    await expect(
      whisperCppAsrEngine.runBenchmark(WHISPER_CPP_MODELS[0], sample, () => {})
    ).rejects.toThrow(/IndexedDB/);
    expect(whisperWeb.downloadWhisperModel).not.toHaveBeenCalled();
  });

  it("runs the benchmark and computes RTF from the audio duration", async () => {
    whisperWeb.canUseWhisperWeb.mockResolvedValue({ supported: true });
    whisperWeb.downloadWhisperModel.mockImplementation(async ({ onProgress }) => {
      onProgress({ progress: 0.5, downloadedBytes: 1, totalBytes: 2 });
      return { alreadyDownloaded: false };
    });
    whisperWeb.transcribe.mockResolvedValue({
      transcription: [{ text: " Kamusta" }, { text: " ka?" }],
    });

    const progress: string[] = [];
    const result = await whisperCppAsrEngine.runBenchmark(
      WHISPER_CPP_MODELS[0],
      sample,
      (_pct, msg) => progress.push(msg)
    );

    expect(whisperWeb.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "tiny", language: "tl" })
    );
    expect(result.transcript).toBe("Kamusta ka?");
    expect(result.device).toBe("wasm (whisper.cpp)");
    expect(result.audioSeconds).toBe(2);
    expect(result.rtf).toBeCloseTo(result.inferMs / 1000 / 2);
    expect(result.xRealtime).toBeCloseTo(1 / result.rtf);
    expect(progress.some((m) => m.includes("Downloading"))).toBe(true);
  });
});
