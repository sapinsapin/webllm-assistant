/**
 * macOS-native (Apple Silicon / MLX) Gemma 4 builds.
 *
 * The web app cannot run MLX — it is a native framework — but "Can I AI?"
 * documents and surfaces the macOS-optimized path so Mac users can run
 * Gemma 4 natively at full speed. This registry is the single source of
 * truth for that path (rendered in docs/UI; shape locked by
 * macosModels.test.ts).
 *
 * Verified 2026-08: the official mlx-community conversions exist on
 * Hugging Face; `scripts/gemma4-mlx/convert_and_upload.sh` produces the
 * internetoftim build from google/gemma-4-E4B-it on an Apple Silicon Mac
 * (MLX cannot run on Linux/x86, so CI never exercises these entries).
 */

export interface MacosMlxModel {
  id: string;
  name: string;
  /** Hugging Face repo id (owner/name). */
  hfRepo: string;
  /** Base model the MLX build was converted from. */
  baseModel: string;
  quantBits: 4 | 8;
  /** "official" = community-maintained conversion; "self" = built and
   * published by this project via scripts/gemma4-mlx. */
  source: "official" | "self";
  /** One-liner to run it locally on an Apple Silicon Mac. */
  runCommand: string;
}

// Gemma 4 is multimodal, so the runner is mlx-vlm (not mlx-lm).
const RUN = (repo: string) =>
  `pip install mlx-vlm && python -m mlx_vlm.generate --model ${repo} --prompt "Hello"`;

export const MACOS_MLX_GEMMA4: MacosMlxModel[] = [
  {
    id: "mlx-gemma-4-e4b-4bit",
    name: "Gemma 4 E4B (MLX 4-bit, official)",
    hfRepo: "mlx-community/gemma-4-e4b-it-4bit",
    baseModel: "google/gemma-4-E4B-it",
    quantBits: 4,
    source: "official",
    runCommand: RUN("mlx-community/gemma-4-e4b-it-4bit"),
  },
  {
    id: "mlx-gemma-4-e4b-qat-4bit",
    name: "Gemma 4 E4B (MLX QAT 4-bit, official)",
    hfRepo: "mlx-community/gemma-4-E4B-it-qat-4bit",
    baseModel: "google/gemma-4-E4B-it",
    quantBits: 4,
    source: "official",
    runCommand: RUN("mlx-community/gemma-4-E4B-it-qat-4bit"),
  },
  {
    id: "mlx-gemma-4-e4b-4bit-internetoftim",
    name: "Gemma 4 E4B (MLX 4-bit, internetoftim build)",
    // Produced and uploaded by scripts/gemma4-mlx/convert_and_upload.sh —
    // requires an Apple Silicon Mac and an internetoftim HF write token.
    hfRepo: "internetoftim/gemma-4-e4b-it-mlx-4bit",
    baseModel: "google/gemma-4-E4B-it",
    quantBits: 4,
    source: "self",
    runCommand: RUN("internetoftim/gemma-4-e4b-it-mlx-4bit"),
  },
];
