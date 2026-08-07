# Gemma 4 builds per platform

"Can I AI?" serves Gemma 4 differently per platform. This directory holds the
tooling for the macOS build; the web build needs no tooling because Google
publishes it ready-made.

## Web (in-app, all platforms with WebGPU)

The app's presets (`src/lib/models.ts`: `gemma-4-e2b`, `gemma-4-e4b`) already
point at the **web-optimized** LiteRT-LM artifacts — the `*-web.task` files
from [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm)
and [litert-community/gemma-4-E4B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm).
Google ships a web-specific model because of browser memory constraints; the
presets are locked to that artifact shape by `src/lib/models.test.ts`.
Devices without WebGPU (e.g. iOS Safari) can't run Gemma 4 —
`getGemma4Model()` returns `null` there and the engine fallback chain routes
to an ONNX/WASM model instead.

## macOS (native, Apple Silicon) — MLX

Two options:

1. **Use the existing official conversions** (recommended):
   [mlx-community/gemma-4-e4b-it-4bit](https://huggingface.co/mlx-community/gemma-4-e4b-it-4bit)
   or [lmstudio-community/gemma-4-E4B-it-MLX-4bit](https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit).

   ```sh
   pip install mlx-vlm
   python -m mlx_vlm.generate --model mlx-community/gemma-4-e4b-it-4bit --prompt "Hello"
   ```

2. **Build and publish your own** under `internetoftim` with
   [`convert_and_upload.sh`](./convert_and_upload.sh):

   ```sh
   huggingface-cli login   # write token for internetoftim; Gemma license accepted
   ./convert_and_upload.sh E4B 4
   ```

   The script converts `google/gemma-4-E4B-it` with `mlx_vlm.convert`
   (4-bit), smoke-tests it, keeps the local copy in `./models/`, and uploads
   to `huggingface.co/internetoftim/gemma-4-e4b-it-mlx-4bit`.

### Why this can't run in CI or the cloud dev container

- MLX only runs on **macOS/Apple Silicon** — Linux x86 containers cannot
  execute the conversion at all.
- The dev container's network policy blocks `huggingface.co`, and no
  `internetoftim` write token is (or should be) present in the repo.

Run the script on a Mac. Nothing else about the repo depends on it.
