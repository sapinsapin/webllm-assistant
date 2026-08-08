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

  it("uses official mlx-community builds only (self-publishing skipped — official conversions exist)", () => {
    expect(MACOS_MLX_GEMMA4.filter((m) => m.source === "self")).toHaveLength(0);
    for (const m of MACOS_MLX_GEMMA4) {
      expect(m.hfRepo, m.id).toMatch(/^mlx-community\//);
    }
  });

  it("offers an edge/low-memory E2B tier alongside E4B", () => {
    const bases = MACOS_MLX_GEMMA4.map((m) => m.baseModel);
    expect(bases).toContain("google/gemma-4-E2B-it");
    expect(bases).toContain("google/gemma-4-E4B-it");
  });

  it("valid HF repo ids throughout (owner/name, no URL, no spaces)", () => {
    for (const m of MACOS_MLX_GEMMA4) {
      expect(m.hfRepo, m.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });
});
