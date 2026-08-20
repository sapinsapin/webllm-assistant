import { describe, expect, it } from "vitest";
import { ASR_MODELS, TTS_MODELS, speechVerdict } from "./speech";

describe("speech model presets", () => {
  it("defaults to the sapinsapin ONNX exports (first entry is the UI default)", () => {
    expect(ASR_MODELS[0].repo).toBe("sapinsapin/whisper-small-fsc-ONNX");
    expect(TTS_MODELS[0].repo).toBe("sapinsapin/speecht5_tts-fsc-ONNX");
  });

  it("keeps tasks consistent per list", () => {
    for (const m of ASR_MODELS) expect(m.task).toBe("asr");
    for (const m of TTS_MODELS) expect(m.task).toBe("tts");
  });

  it("has unique preset ids", () => {
    const ids = [...ASR_MODELS, ...TTS_MODELS].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives SpeechT5 presets a speaker embedding", () => {
    for (const m of TTS_MODELS.filter((m) => m.id.startsWith("speecht5"))) {
      expect(m.speakerEmbeddings).toBeTruthy();
    }
  });
});

describe("speechVerdict", () => {
  it("rates real-time factor bands", () => {
    expect(speechVerdict(0.2).label).toBe("Great");
    expect(speechVerdict(0.8).label).toBe("Realtime capable");
    expect(speechVerdict(2).label).toBe("Slow");
    expect(speechVerdict(5).label).toBe("Not viable");
  });
});
