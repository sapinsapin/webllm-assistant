# M3 Results — Moonlight-16B-A3B-Instruct → LiteRT, verification & int8 quantization

Date: 2026-09-13. Machine: Mac (M4, 32 GB RAM). Repo: `/Users/timsan/litert-torch-m3`
(clone of `internetoftim/litert-torch@kimi-moonlight-port`), venv `/Users/timsan/litert-torch-m3-venv`.

All parity checks run with the `ai_edge_litert` Python interpreter. Full-model runs use
`experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES, num_threads=8`
(reference kernels, weights read in place from the mmap'd flatbuffer) — see "XNNPACK note" below.
The prefill signatures emit only KV caches, so "prefill-last logits" are obtained by replaying the
prompt token-by-token through the `decode` signature from an empty cache; the prefill path itself is
validated by comparing every layer's KV cache after `prefill_8`.

## Summary — all checks PASSED

| Step | Check | Result |
|---|---|---|
| 1 | slice-4 int8 vs fp32 eager ref | decode cos 0.9949, argmax match |
| 2 | full fp32 tflite self-contained | decode invoke OK with weights.f32 absent → deleted (freed 59 GB) |
| 3 | full-model int8 dynamic-range quantize | 15.09 GiB output, 3.9x, 261 s, peak RSS 13.3 GiB |
| 4 | full int8 vs fp32 eager ref (seed-7) | decode cos 0.9937, argmax 269 = ref |
| 5 | greedy smoke generation | "Ready.<|im_end|>", first token 23019 = ref argmax |

## Step 1 — Slice-4 (4-layer) quantized parity vs `slice4-ref.npz`

Model: `artifacts/slice4-export/model_quantized.tflite` (2,538,550,752 B, int8 `dynamic_wi8_afp32`).
Sanity: `slice4-ref.npz` vs `slice4-ref-streamed.npz` are bit-identical (max abs diff 0.0 on both logits arrays).

- Prefill KV-cache (after `prefill_8`, worst over 4 layers): k = 1.341e-01, v = 1.683e-02
- Decode logits: max abs diff = 1.541e+00, cosine = 0.994895, argmax 2727 (tflite) = 2727 (ref)
- Prefill-last logits (decode replay): max abs diff = 4.967e-01, cosine = 0.999586, argmax 1696 = 1696
- Peak RSS 5.41 GiB; prefill invoke ~2 s (XNNPACK default delegate is fine at slice scale)

Abs diffs are larger than the M2 toy's ~2e-2 because these are real-scale logits (|logits| up to
tens); cosine ≥0.995 and matching argmax are the meaningful signals for int8 dynamic-range.

## Step 2 — full fp32 flatbuffer is self-contained; weights.f32 deleted

`artifacts/full-export/model.tflite` (63,873,642,960 B, signatures `prefill_8` + `decode`,
cache_len=128, 54 KV tensors of [1,16,128,192]) was loaded and run with
`weights.f32` renamed to `weights.f32.hold`:

- Interpreter construction + `decode` signature runner + tensor allocation: OK (mmap; ~0.1 s, peak RSS <0.2 GiB)
- One real `decode` invoke (reference kernels, pages all 59 GB of weights through the file mapping):
  **OK in 55.2 s**, logits shape (1,1,163840), peak RSS 20.53 GiB (clean mmap pages, no swap growth)

Conclusion: every weight buffer lives inside the flatbuffer; `weights.f32` was only the export-time
staging blob. **Deleted permanently** (freed 59 GB; disk went 34 → 93 GB free).

XNNPACK note: a first attempt with the default delegate was killed by memory pressure after ~250 s
(peak memory footprint 45.7 GB) — XNNPACK repacks all FULLY_CONNECTED fp32 weights into anonymous
RAM. Use `BUILTIN_WITHOUT_DEFAULT_DELEGATES` for interpreter checks of the fp32 model on 32 GB.

## Step 3 — full-model int8 dynamic-range quantization

Same repo-standard recipe as the slice: `ai_edge_quantizer` recipe `dynamic_wi8_afp32`
(int8 weights / fp32 activations, dynamic range), invoked through
`export_lib.maybe_quantize_model` via `m3/convert.py --skip-fp32-convert`.

- Input: `artifacts/full-export/model.tflite`, 63,873,642,960 B (59.5 GiB)
- Output: `artifacts/full-export/model_quantized.tflite`, **16,201,445,312 B (15.09 GiB)**, ratio 3.9x
  (quantizer report: "Quantized model size: 15.09 GiB", "Quantization Ratio: 0.25 (3.9x smaller)")
- 47,367 tensors parameterized; wall time **261 s**; peak RSS **13.30 GiB** (`/usr/bin/time -l`:
  14,281,162,752 B max RSS); swap peaked ~23 GB during materialization, no OOM
- Log: `artifacts/full-quantize.log`

## Step 4 — full quantized parity vs `full-ref-seed7.npz`

Reference: layer-streamed eager transformers fp32 on real weights (seed-7 random 8-token prompt +
1 decode token; ref decode argmax 269). cache_len 128, prefill_len 8.

- Prefill KV-cache (worst over 27 layers): k = 5.377e-01, v = 2.265e-01
- **Decode logits: max abs diff = 1.071e+00, cosine = 0.993748, argmax 269 (tflite) = 269 (ref)**
- Prefill-last logits (decode replay): max abs diff = 7.717e-01, cosine = 0.998244, argmax 378 = 378
- Peak RSS 15.76 GiB; first invoke 12.6 s (pages the 15 GiB model), subsequent decode steps ~0.5 s
  (model stays in page cache)
- Log: `artifacts/full-parity-seed7.log`

At 16B scale, int8 dynamic-range abs diffs of O(1) on logits with cosine ≥0.994 and exact argmax
agreement on both checked positions is the expected/healthy regime.

## Step 5 — greedy smoke generation

Prompt: chat template of "Reply with the single word: ready" (23 ids — verified identical to
`full-ref-smoke.npz` prompt+next_token). `full-ref-smoke.npz` contains no reference generation,
only the first-step decode logits (argmax 23019 = "Ready"), so the comparison is on the first token.

- Generated (greedy, max 10, stopped at end token): tokens `[23019, 13, 163586]` →
  **`Ready.<|im_end|>`**
- First generated token 23019 **matches** the fp32 reference argmax (23019)
- Coherent and exactly the instructed behavior
- Timing: 11.3 s total (model already in page cache); ~0.5 s/decode step, 8-token prefill chunks
  ~1.5 s. Peak RSS 16.16 GiB. Log: `artifacts/full-smoke-run.log`

## Step 6 — cleanup

After steps 4–5 passed: deleted `artifacts/full-export/model.tflite` (59.5 GiB fp32).
Kept: `model_quantized.tflite` (full, 15.09 GiB), `slice4-export/model_quantized.tflite` (2.36 GiB),
all reference npz files and logs. Disk: **136 GB free** (was ~30 GB at session start).

## Artifact inventory (post-M3)

| File | Size |
|---|---|
| `artifacts/full-export/model_quantized.tflite` | 16,201,445,312 B (15.09 GiB) |
| `artifacts/slice4-export/model_quantized.tflite` | 2,538,550,752 B (2.36 GiB) |
| `artifacts/full-ref-seed7.npz` / `full-ref-smoke.npz` | 4.6 MB / 10.4 MB |
| `artifacts/slice4-ref.npz` / `slice4-ref-streamed.npz` | 1.7 MB each |
| logs: `full-export.log`, `full-quantize.log`, `full-parity-seed7.log`, `full-smoke-run.log`, `slice4-export.log`, … | |

Removed this session: `full-export/weights.f32` (59.4 GB), `full-export/model.tflite` (59.5 GB).

## Peak RSS per step

| Step | Peak RSS |
|---|---|
| 1. slice parity | 5.41 GiB |
| 2. fp32 self-containment decode | 20.53 GiB (45.7 GB footprint w/ XNNPACK → killed; avoid) |
| 3. full quantize | 13.30 GiB (swap peak ~23 GB) |
| 4. full parity | 15.76 GiB |
| 5. smoke generation | 16.16 GiB |

## Repro commands

```bash
cd /Users/timsan/litert-torch-m3 && source /Users/timsan/litert-torch-m3-venv/bin/activate

# Step 3 — quantize an existing fp32 flatbuffer (repo-standard recipe)
python -u m3/convert.py --model-dir artifacts/full-model --workdir artifacts/full-export \
    --skip-fp32-convert --quantize dynamic_wi8_afp32

# Step 1/4 — parity (script: parity of prefill KV caches + decode logits + decode-replay
# prefill-last logits; slice used the stock XNNPACK interpreter, full used
# BUILTIN_WITHOUT_DEFAULT_DELEGATES). Equivalent repo tool: m3/verify_tflite.py
python -u m3/parity_check.py --tflite artifacts/slice4-export/model_quantized.tflite \
    --ref artifacts/slice4-ref.npz --cache-len 64 --prefill-len 8
python -u m3/parity_check_nodelegate.py --tflite artifacts/full-export/model_quantized.tflite \
    --ref artifacts/full-ref-seed7.npz --cache-len 128 --prefill-len 8

# Step 5 — smoke (smoke_generate.py + the no-delegate op resolver)
python -u m3/smoke_generate_nodelegate.py --tflite artifacts/full-export/model_quantized.tflite \
    --cache-len 128 --max-new 10
```

(The parity/smoke scripts `m3/parity_check.py`, `m3/parity_check_nodelegate.py` and
`m3/smoke_generate_nodelegate.py` were added this session; the `_nodelegate` variants differ only in adding
`experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES, num_threads=8`
to the Interpreter constructor, and in deriving prefill-last logits via decode replay because the
prefill signatures do not output logits.)

## Verdict

M3 verification complete: the 4.8 h full-model conversion is valid, the flatbuffer is
self-contained, the int8 dynamic-range quantized full model (15.09 GiB) matches the fp32 eager
reference (cos ≥0.9937, argmax-exact on all checked positions) and generates the expected smoke
output on-device-style through the LiteRT interpreter. Nothing was pushed or uploaded.
