#!/usr/bin/env bash
# Convert Kimi-VL-A3B to an MLX (Apple Silicon) quantized build and upload it
# to huggingface.co/internetoftim.
#
# Only the -Instruct variant needs this — mlx-community already publishes
# Kimi-VL-A3B-Thinking-4bit and Kimi-Linear-48B-A3B-Instruct-4bit. See
# README.md in this directory for the full Kimi support plan.
#
# REQUIREMENTS — Apple Silicon Mac (MLX does not run on Linux/x86), with:
#   - python3 + pip
#   - `hf auth login` done with a WRITE token for the `internetoftim` account
#   - ~40 GB free disk, 16 GB+ unified memory
#
# Usage:
#   ./convert_and_upload.sh [Instruct|Thinking] [bits]
#   ./convert_and_upload.sh Instruct 4     # default
#
# Output:
#   - Local model saved under ./models/Kimi-VL-A3B-<variant>-mlx-<bits>bit
#   - Uploaded to huggingface.co/internetoftim/Kimi-VL-A3B-<variant>-mlx-<bits>bit

set -euo pipefail

VARIANT="${1:-Instruct}"         # Instruct or Thinking
BITS="${2:-4}"                   # quantization bits (4 or 8)
SRC="moonshotai/Kimi-VL-A3B-${VARIANT}"
NAME="Kimi-VL-A3B-${VARIANT}-mlx-${BITS}bit"
OUT_DIR="$(dirname "$0")/models/${NAME}"
HF_REPO="internetoftim/${NAME}"

if [[ "$(uname -s)/$(uname -m)" != "Darwin/arm64" ]]; then
  echo "ERROR: MLX conversion requires macOS on Apple Silicon (found $(uname -s)/$(uname -m))." >&2
  exit 1
fi

echo "==> Installing/refreshing mlx-vlm (Kimi-VL is multimodal — needs the kimi_vl model class)"
# torch/torchvision: Kimi-VL's custom HF processor imports them (unlike
# most mlx-vlm conversions, which are pure-MLX).
pip install --upgrade mlx-vlm huggingface_hub torch torchvision

echo "==> Checking mlx-vlm supports kimi_vl"
python - <<'EOF'
import importlib.util, sys
if importlib.util.find_spec("mlx_vlm.models.kimi_vl") is None:
    sys.exit("ERROR: this mlx-vlm build has no kimi_vl support — upgrade mlx-vlm.")
print("kimi_vl model class found.")
EOF

echo "==> Converting ${SRC} → ${OUT_DIR} (${BITS}-bit)"
# --trust-remote-code: Kimi-VL ships its processor as custom code in the
# official moonshotai HF repo; transformers refuses to load it without this.
python -m mlx_vlm convert \
  --hf-path "${SRC}" \
  --mlx-path "${OUT_DIR}" \
  -q --q-bits "${BITS}" \
  --trust-remote-code

echo "==> Smoke test"
python -m mlx_vlm generate \
  --model "${OUT_DIR}" \
  --prompt "Reply with the single word: ready" \
  --max-tokens 5

echo "==> Creating ${HF_REPO} and uploading"
hf repo create "${HF_REPO}" --repo-type model --exist-ok
hf upload "${HF_REPO}" "${OUT_DIR}" . --repo-type model

echo "==> Done: https://huggingface.co/${HF_REPO} (local copy kept at ${OUT_DIR})"
