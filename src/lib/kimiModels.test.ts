import { describe, it, expect } from "vitest";
import { MACOS_MLX_KIMI } from "./kimiModels";

describe("MACOS_MLX_KIMI (Kimi macOS power-tier registry)", () => {
  it("has unique ids and at least one published official conversion", () => {
    const ids = MACOS_MLX_KIMI.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      MACOS_MLX_KIMI.some((m) => m.source === "official" && m.published),
    ).toBe(true);
  });

  it("every entry converts from an official moonshotai base model", () => {
    for (const m of MACOS_MLX_KIMI) {
      expect(m.baseModel, m.id).toMatch(/^moonshotai\//);
    }
  });

  it("multimodal Kimi-VL entries run via mlx-vlm; text-only via mlx-lm", () => {
    for (const m of MACOS_MLX_KIMI) {
      const isVL = m.baseModel.includes("Kimi-VL");
      expect(m.runCommand, m.id).toContain(isVL ? "mlx_vlm" : "mlx_lm");
      expect(m.runCommand, m.id).toContain(m.hfRepo);
    }
  });

  it("only self-published builds may be unpublished, and they match the conversion script's naming", () => {
    for (const m of MACOS_MLX_KIMI) {
      if (!m.published) {
        expect(m.source, m.id).toBe("self");
      }
      if (m.source === "self") {
        // convert_and_upload.sh publishes internetoftim/Kimi-VL-A3B-<variant>-mlx-<bits>bit
        expect(m.hfRepo, m.id).toMatch(
          /^internetoftim\/Kimi-VL-A3B-(Instruct|Thinking)-mlx-\dbit$/,
        );
      }
    }
  });

  it("declares a sane memory floor (Kimi has no <16 GB tier — that's Gemma's job)", () => {
    for (const m of MACOS_MLX_KIMI) {
      expect(m.minMemoryGB, m.id).toBeGreaterThanOrEqual(16);
    }
  });

  it("valid HF repo ids throughout (owner/name, no URL, no spaces)", () => {
    for (const m of MACOS_MLX_KIMI) {
      expect(m.hfRepo, m.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });
});
