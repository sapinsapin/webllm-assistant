# Kimi support plan (edge / local / web)

Status: **planned** — this directory holds the plan and the macOS conversion
tooling. Unlike Gemma 4, Moonshot publishes **no** edge, web, or mobile builds
of any Kimi model, so most tiers below require converting it ourselves.

## Why there is no drop-in Kimi

- The flagship K-line (Kimi K3: **2.78T params**, K2: 1T) is datacenter-only
  and out of scope for every platform this app targets.
- The edge-sized family members are:
  - **Kimi-VL-A3B** (`-Instruct` / `-Thinking`): 16B total / 3B active MoE,
    vision-language. Language tower is the Moonlight (DeepSeek-V3-style)
    architecture, vision tower is MoonViT.
  - **Moonlight-16B-A3B-Instruct**: the text-only sibling (same 16B-A3B MoE).
  - **Kimi-Linear-48B-A3B-Instruct**: hybrid linear-attention (KDA); ~24 GB
    at 4-bit — 32 GB+ Macs only.
- None of these ship ONNX, MLC/WebGPU, or LiteRT artifacts. MLX is the only
  ecosystem with existing conversions, and even there the -Instruct VL model
  has no official mlx-community build (only -Thinking).

## Phase 1 — macOS (MLX) — actionable now

Target: add a "Kimi power tier" alongside the Gemma 4 entries in a
`kimiModels.ts` registry (mirroring `src/lib/macosModels.ts`, with tests).

| Model | HF build | Min RAM | Action |
|---|---|---|---|
| Kimi-VL-A3B-Thinking | `mlx-community/Kimi-VL-A3B-Thinking-4bit` (exists) | 16 GB | use official |
| Kimi-VL-A3B-Instruct | none official | 16 GB | **convert ourselves** → `internetoftim/Kimi-VL-A3B-Instruct-mlx-4bit` |
| Kimi-Linear-48B-A3B-Instruct | `mlx-community/Kimi-Linear-48B-A3B-Instruct-4bit` (exists) | 32 GB | use official |

Run [`convert_and_upload.sh`](./convert_and_upload.sh) on an Apple Silicon
Mac (16 GB+, ~40 GB free disk) to produce and publish the -Instruct build:

```sh
hf auth login   # write token for internetoftim
./convert_and_upload.sh Instruct 4
```

Prerequisite to verify at run time (the script smoke-tests): `mlx-vlm` has a
`kimi_vl` model class — support landed upstream in 2025, but pin/upgrade as
needed.

## Phase 2 — web (WebGPU via MLC/WebLLM) — convert ourselves, gated

Kimi-VL cannot run in WebLLM (no vision-model support in the web runtime), so
the web tier is **text-only** via the Moonlight tower:

1. Verify `mlc-llm` supports the DeepSeek-V3-style MoE architecture that
   `moonshotai/Moonlight-16B-A3B-Instruct` uses (DeepSeek-V2 support exists;
   V3 delta must be checked — if missing, this phase is blocked upstream and
   we file/track an mlc-llm issue instead of forking).
2. Compile `Moonlight-16B-A3B-Instruct` with `mlc_llm convert_weight` +
   `gen_config` at `q4f16_1`, package the WebGPU wasm, and publish as
   `internetoftim/Moonlight-16B-A3B-Instruct-q4f16_1-MLC`.
3. Register it in `src/lib/models.ts` behind the existing device-capability
   gate: ~9 GB weights means it must require a high-VRAM WebGPU adapter
   (`deviceFlops`/`deviceInfo` checks), and the standard timeout/fallback
   chain must route down to Gemma 4 E2B when the gate fails.

`Kimi-Linear-48B` is **blocked** for web: its KDA hybrid attention is not
implemented in MLC, and 24 GB of weights exceeds any browser envelope.

## Phase 3 — native mobile (iOS / Android) — blocked, fallback only

No LiteRT/MediaPipe path exists for any Kimi architecture (custom MoE +
MoonViT / KDA are unsupported by the LiteRT converter), and 3B-active MoE
with 16B resident weights exceeds phone memory budgets regardless. Decision:

- Do **not** attempt a mobile conversion; revisit if Moonshot ships a
  sub-4B dense model or LiteRT gains the architecture.
- Mobile users selecting Kimi get the app's standard fallback chain
  (cloud endpoint when configured, else Gemma 4 E2B on-device).

## Sequencing

1. Phase 1 registry + conversions (this directory) — no app-code risk.
2. Phase 2 spike: arch-support check first (hours), full compile only if it
   passes (day-scale, needs a big-VRAM box for calibration-free quant).
3. Wire registries into UI/docs the same way `MACOS_MLX_GEMMA4` is surfaced.

Like the Gemma tooling, none of this can run in CI (MLX and Metal need
Apple Silicon; the dev container blocks huggingface.co) — run on a Mac.
