/**
 * Kimi (Moonshot AI) macOS-native MLX builds — the "power tier" beside
 * MACOS_MLX_GEMMA4.
 *
 * Moonshot publishes no edge/web/mobile builds of any Kimi model, so this
 * registry is macOS-only; see scripts/kimi-mlx/README.md for the full
 * multi-platform plan (web via a Moonlight MLC compile is Phase 2; native
 * mobile is blocked — those tiers fall back to Gemma 4).
 *
 * Verified 2026-08: the two "official" entries exist on Hugging Face; the
 * "self" entry is produced by scripts/kimi-mlx/convert_and_upload.sh and is
 * marked `published: false` until the upload lands (flip it after running
 * the script — kimiModels.test.ts allows unpublished self entries only).
 */

export interface KimiMlxModel {
  id: string;
  name: string;
  /** Hugging Face repo id (owner/name). */
  hfRepo: string;
  /** Base model the MLX build was converted from. */
  baseModel: string;
  quantBits: 4 | 8;
  /** "official" = community-maintained conversion; "self" = built and
   * published by this project via scripts/kimi-mlx. */
  source: "official" | "self";
  /** False until the build actually exists on Hugging Face. */
  published: boolean;
  /** Minimum unified memory (GB) to run comfortably at this quant. */
  minMemoryGB: number;
  /** One-liner to run it locally on an Apple Silicon Mac. */
  runCommand: string;
}

// Kimi-VL is multimodal → mlx-vlm; Kimi-Linear is text-only → mlx-lm.
const RUN_VLM = (repo: string) =>
  `pip install mlx-vlm && python -m mlx_vlm.generate --model ${repo} --prompt "Hello"`;
const RUN_LM = (repo: string) =>
  `pip install mlx-lm && python -m mlx_lm generate --model ${repo} --prompt "Hello"`;

export const MACOS_MLX_KIMI: KimiMlxModel[] = [
  {
    id: "mlx-kimi-vl-a3b-thinking-4bit",
    name: "Kimi VL A3B Thinking (MLX 4-bit, official)",
    hfRepo: "mlx-community/Kimi-VL-A3B-Thinking-4bit",
    baseModel: "moonshotai/Kimi-VL-A3B-Thinking",
    quantBits: 4,
    source: "official",
    published: true,
    minMemoryGB: 16,
    runCommand: RUN_VLM("mlx-community/Kimi-VL-A3B-Thinking-4bit"),
  },
  {
    id: "mlx-kimi-vl-a3b-instruct-4bit-internetoftim",
    name: "Kimi VL A3B Instruct (MLX 4-bit, internetoftim build)",
    // No official -Instruct MLX conversion exists; produced by
    // scripts/kimi-mlx/convert_and_upload.sh on an Apple Silicon Mac.
    // Published 2026-08-08, smoke-tested via mlx_vlm generate.
    hfRepo: "internetoftim/Kimi-VL-A3B-Instruct-mlx-4bit",
    baseModel: "moonshotai/Kimi-VL-A3B-Instruct",
    quantBits: 4,
    source: "self",
    published: true,
    minMemoryGB: 16,
    runCommand: RUN_VLM("internetoftim/Kimi-VL-A3B-Instruct-mlx-4bit"),
  },
  {
    id: "mlx-kimi-linear-48b-a3b-4bit",
    name: "Kimi Linear 48B A3B Instruct (MLX 4-bit, official)",
    hfRepo: "mlx-community/Kimi-Linear-48B-A3B-Instruct-4bit",
    baseModel: "moonshotai/Kimi-Linear-48B-A3B-Instruct",
    quantBits: 4,
    source: "official",
    published: true,
    minMemoryGB: 32,
    runCommand: RUN_LM("mlx-community/Kimi-Linear-48B-A3B-Instruct-4bit"),
  },
];
