#!/usr/bin/env bash
# Convert Gemma 4 to an MLX (Apple Silicon) 4-bit build and upload it to
# huggingface.co/internetoftim.
#
# REQUIREMENTS — this must run on a Mac with Apple Silicon (MLX does not run
# on Linux/x86), with:
#   - python3 + pip
#   - `huggingface-cli login` done with a WRITE token for the `internetoftim`
#     account, and the Gemma license accepted on https://huggingface.co/google
#
# Usage:
#   ./convert_and_upload.sh [E2B|E4B] [bits]
#   ./convert_and_upload.sh E4B 4     # default: E4B, 4-bit
#
# Output:
#   - Local model saved under ./models/gemma-4-<size>-it-mlx-<bits>bit
#   - Uploaded to huggingface.co/internetoftim/gemma-4-<size>-it-mlx-<bits>bit
#
# Note: official conversions already exist (mlx-community/gemma-4-e4b-it-4bit,
# lmstudio-community/gemma-4-E4B-it-MLX-4bit). Run this only if you want the
# build under your own account; otherwise just use the mlx-community repo.

set -euo pipefail

SIZE="${1:-E4B}"                 # E2B or E4B
BITS="${2:-4}"                   # quantization bits (4 or 8)
SRC="google/gemma-4-${SIZE}-it"
NAME="gemma-4-$(echo "$SIZE" | tr '[:upper:]' '[:lower:]')-it-mlx-${BITS}bit"
OUT_DIR="$(dirname "$0")/models/${NAME}"
HF_REPO="internetoftim/${NAME}"

if [[ "$(uname -s)/$(uname -m)" != "Darwin/arm64" ]]; then
  echo "ERROR: MLX conversion requires macOS on Apple Silicon (found $(uname -s)/$(uname -m))." >&2
  exit 1
fi

echo "==> Installing/refreshing mlx-vlm (Gemma 4 is multimodal — use mlx-vlm, not mlx-lm)"
pip install --upgrade mlx-vlm huggingface_hub

echo "==> Converting ${SRC} → ${OUT_DIR} (${BITS}-bit)"
python -m mlx_vlm.convert \
  --hf-path "${SRC}" \
  --mlx-path "${OUT_DIR}" \
  -q --q-bits "${BITS}"

echo "==> Smoke test"
python -m mlx_vlm.generate \
  --model "${OUT_DIR}" \
  --prompt "Reply with the single word: ready" \
  --max-tokens 5

echo "==> Creating ${HF_REPO} and uploading"
hf repo create "${HF_REPO}" --repo-type model --exist-ok
hf upload "${HF_REPO}" "${OUT_DIR}" . --repo-type model

echo "==> Done: https://huggingface.co/${HF_REPO} (local copy kept at ${OUT_DIR})"
