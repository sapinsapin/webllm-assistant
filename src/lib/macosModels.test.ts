import { describe, it, expect } from "vitest";
import { MACOS_MLX_GEMMA4 } from "./macosModels";

describe("MACOS_MLX_GEMMA4 (macOS-optimized Gemma 4 registry)", () => {
  it("has unique ids and at least one official conversion", () => {
    const ids = MACOS_MLX_GEMMA4.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MACOS_MLX_GEMMA4.some((m) => m.source === "official")).toBe(true);
  });

  it("every entry converts from an official google/gemma-4 base model", () => {
    for (const m of MACOS_MLX_GEMMA4) {
      expect(m.baseModel, m.id).toMatch(/^google\/gemma-4-/);
    }
  });

  it("run commands use mlx-vlm (Gemma 4 is multimodal; mlx-lm would fail)", () => {
    for (const m of MACOS_MLX_GEMMA4) {
      expect(m.runCommand, m.id).toContain("mlx_vlm");
      expect(m.runCommand, m.id).toContain(m.hfRepo);
    }
  });

  it("the self-published build targets the internetoftim account and matches the conversion script's naming", () => {
    const self = MACOS_MLX_GEMMA4.filter((m) => m.source === "self");
    expect(self).toHaveLength(1);
    // convert_and_upload.sh publishes internetoftim/gemma-4-<size>-it-mlx-<bits>bit
    expect(self[0].hfRepo).toMatch(/^internetoftim\/gemma-4-e\db-it-mlx-\dbit$/);
    expect(self[0].quantBits).toBe(4);
  });

  it("valid HF repo ids throughout (owner/name, no URL, no spaces)", () => {
    for (const m of MACOS_MLX_GEMMA4) {
      expect(m.hfRepo, m.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });
});
