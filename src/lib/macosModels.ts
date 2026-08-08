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
 * Hugging Face and are actively maintained (e4b 4-bit: ~29k downloads),
 * so we use them directly instead of self-publishing a duplicate build.
 * `scripts/gemma4-mlx/convert_and_upload.sh` remains available if a
 * self-published internetoftim build is ever needed (MLX cannot run on
 * Linux/x86, so CI never exercises these entries).
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
    id: "mlx-gemma-4-e2b-4bit",
    // Edge-tier build: E2B is the Gemma 4 successor to gemma-3n-E2B
    // (MatFormer effective-2B), for Macs with 8 GB unified memory.
    name: "Gemma 4 E2B (MLX 4-bit, official, edge/low-memory)",
    hfRepo: "mlx-community/gemma-4-e2b-it-4bit",
    baseModel: "google/gemma-4-E2B-it",
    quantBits: 4,
    source: "official",
    runCommand: RUN("mlx-community/gemma-4-e2b-it-4bit"),
  },
];
