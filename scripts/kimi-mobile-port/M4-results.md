# M4 Results — REAP-style expert pruning of Moonlight-16B-A3B-Instruct → LiteRT

Date: 2026-09-15. Machine: Mac (M4, 32 GB RAM). Repo: `/Users/timsan/litert-torch-m3`
(clone of `internetoftim/litert-torch@kimi-moonlight-port`), venv `/Users/timsan/litert-torch-m3-venv`.
Tooling added this session: `m4/` (committed to the fork, commit `63b7d27`; artifacts NOT uploaded anywhere).

## Headline

- Router-guided expert pruning **64→24** (`pruned-24`, 6.96 B params) survives: **0.967 bits/byte**
  vs unpruned 0.824 and vs the Gemma 4 E2B bar of 1.812 — clearly ahead on raw-text modeling.
  **64→16 collapses** (2.313 bits/byte — *worse than Gemma*) and is rejected.
- pruned-24 converted through the M3 pipeline: **6.58 GiB int8** `.tflite`, parity vs its own fp32
  eager reference **cos 0.9998 / argmax-exact** (seed-7), coherent smoke generation.
- **Bonus beyond best-effort:** a full **`.litertlm` bundle** (7.07 GB, tokenizer + chat template
  included) was built and **runs end-to-end in the real LiteRT-LM desktop runtime
  (`litert-lm` 0.17.0, macOS arm64)** — `litert-lm run model.litertlm --prompt "Reply with the
  single word: ready"` → `ready`, 9.5 s cold / ~4.8 s warm, peak RSS 13.2 GiB.
- **But: instruct quality is visibly damaged** at 64→24 (repetition loops, missed turn-ends,
  factual slips) while Gemma 4 E2B's instruct behavior is crisp. **Shipping verdict: REJECT as-is**
  (registry entry "rejected with eval numbers" per PLAN M4 exit); the honest path forward is
  post-prune healing (short fine-tune) or a milder ratio (~32) — see Verdict.
- No physical phone was available: **no on-device numbers**; the desktop LiteRT-LM runtime smoke is
  the closest proxy exercised.

## 1. Calibration & router statistics

Corpus: 384 seqs × 512 tok = **196,608 tokens** — 256 seqs wikitext-2-raw-v1 train (packed) +
128 chat-templated instruct samples (yahma/alpaca-cleaned, wikitext-filled to length), tokenized
with the Moonlight tokenizer (`m4/calib_data.py`). Layer-streamed bf16 forward on MPS
(`m4/router_stats.py`, 13 min wall, never >1 layer resident). Per expert × 26 MoE layers recorded:
selection count, router-weight mass **as used** (post `norm_topk_prob` renorm, post
`routed_scaling_factor`=2.446), and REAP-style contribution Σ‖w·expert_out(x)‖₂.
Saved: `artifacts/m4/router-stats.npz`.

**Expert usage is NOT concentrated.** By weight mass (`wsum`):

| statistic (over the 26 MoE layers) | value |
|---|---|
| effective #experts (exp of routing entropy) | mean **45.4**, range 41.2–49.5 (of 64) |
| top-24 experts' share of weight mass | mean **0.693**, min 0.631 |
| top-16 experts' share of weight mass | mean **0.524**, min 0.455 |
| top-24 share by selection count | mean 0.629 |
| top-24 share by contribution norm | mean 0.702 |

Metric agreement is high (top-24 sets by wsum vs contrib overlap 23/24; top-16 overlap 13–15/16),
so the ranking metric barely matters — the flat routing distribution is the story. This predicted
real quality loss at both ratios, which the evals confirmed: Moonlight's router spreads mass too
evenly for cheap 2.7–4× expert pruning. (DeepSeek-V3-style training actively load-balances experts —
REAP's "few experts dominate" premise holds only weakly here.)

## 2. Pruning

`m4/prune_checkpoint.py`: per MoE layer keep top-K experts by `wsum`, renumber contiguously,
slice `mlp.gate.weight` rows and `mlp.gate.e_score_correction_bias`, keep shared experts / dense
layer 0 / attention / embeddings intact, `num_experts_per_tok` stays 6 (valid: 6 ≤ 16),
`n_routed_experts` updated in config. Proper HF checkpoints (bf16, legacy per-expert key layout,
one shard per layer). The top-16 sets are strict subsets of the top-24 sets (verified).

| variant | routed experts | params | bf16 checkpoint | int8 est./actual |
|---|---|---|---|---|
| unpruned | 64/layer | 15.96 B | 29.73 GiB | 15.09 GiB (M3 actual) |
| `pruned-24` | 24/layer | 6.96 B | 12.97 GiB | **6.58 GiB (actual)** |
| `pruned-16` | 16/layer | 5.16 B | 9.61 GiB | ~4.9 GiB (est., not converted) |

## 3. Quality — bits per byte (held-out) + instruct sanity

Protocol (`m4/eval_bpb_streamed.py` / `m4/eval_bpb_hf.py`): first 250 KB of wikitext-2-raw-v1
**test** (held out from calibration), tokenized per model; windows = [BOS] + 511 text tokens; all
511 scored (teacher forcing); **BPB = Σ NLL(bits) / utf-8 bytes of scored tokens** —
tokenizer-independent, unlike token perplexity. bf16 for all models (Moonlight variants
layer-streamed on MPS; Gemma fully loaded). fp32-vs-bf16 spot check on Gemma agreed to <2%.
BOS matters: Gemma without BOS degrades 1.81→3.23 BPB; all models get their BOS.

| model | bits/byte | token ppl (informational; tokenizers differ) |
|---|---|---|
| Moonlight-16B unpruned (bf16) | **0.824** | 12.2 |
| **Moonlight pruned-24 (bf16)** | **0.967** | 18.8 |
| Moonlight pruned-16 (bf16) | 2.313 | 1114.9 |
| google/gemma-4-E2B-it (bf16) | 1.812 | 225.8 |

(56,721 scored tokens / 248,221 bytes for Moonlight variants; 57,743 / 249,095 for Gemma.
Gemma's high raw-text BPB is consistent across fp32/bf16 and both window policies — it is a
heavily instruction-tuned small multimodal model; its strength is the instruct behavior below.)

Instruct sanity (10 fixed prompts, greedy, `artifacts/m4/instruct-*.json`):

- **unpruned (int8 tflite, M3 artifact)**: 10/10 correct, crisp ("Ready.", Paris, Jupiter, 42,
  clean haiku, correct translations).
- **Gemma 4 E2B**: 10/10 correct, crisp, well-formatted.
- **pruned-24 (bf16)**: ~4/10 acceptable. Systematic damage: fails to emit `<|im_end|>` and
  rambles into fake extra turns; repetition loops ("Sure!user Sure!assistant…"); factual slips
  (largest planet → "Saturn"; 17+25 → "=== 32"); verbal tics ("Surely, surely, and surely!").
  Content is often right-ish but the chat protocol behavior is broken.
- **pruned-16 (bf16)**: incoherent (topic drift, self-contradiction) — matches the BPB collapse.

**Selection per the M4 rule** (smallest ratio whose BPB stays clearly ahead of Gemma): pruned-16
fails the bar outright; **pruned-24 selected** for conversion.

## 4. Conversion + quantization (pruned-24, M3 pipeline)

`m3/convert.py --model-dir artifacts/m4/pruned-24 --load mmapf32 --cache-len 128 --prefill-len 8
--quantize dynamic_wi8_afp32`:

| step | result |
|---|---|
| streamed fp32 load (mmap-backed) | 171 s |
| convert (torch.export → tfl) | **1790 s (30 min)**, `model.tflite` 27,860,979,712 B (25.9 GiB) |
| quantize `dynamic_wi8_afp32` | **92 s**, `model_quantized.tflite` **7,066,570,672 B (6.58 GiB)**, 3.9× |
| peak RSS / swap during convert | 19.4 GiB / swap briefly 51.6 GiB (macOS coped; no OOM — above the 25 GB back-off line, noted for future runs) |
| cleanup | `weights.f32` (25.9 GiB) and fp32 `model.tflite` deleted after parity passed |

## 5. Parity + smoke (int8 vs fresh fp32 eager references)

Fresh layer-streamed fp32 eager references generated from the pruned checkpoint itself
(`m3/ref_logits_streamed.py`): seed-7 random prompt (`p24-ref-seed7.npz`, ref argmax 13) and the
chat smoke prompt (`p24-ref-smoke.npz`, ref argmax 60118 = "Sure"). Interpreter:
`BUILTIN_WITHOUT_DEFAULT_DELEGATES`, 8 threads (M3 regime).

| check | result |
|---|---|
| seed-7 decode logits | max abs 0.581, **cos 0.999754, argmax 13 = ref 13** |
| seed-7 prefill-last (decode replay) | max abs 0.882, **cos 0.999620, argmax 220 = ref 220** |
| worst prefill KV diff over 27 layers | k 1.08, v 0.57 (same O(1) regime as M3 full model) |
| smoke-prompt decode logits | cos 0.988365; argmax 3704 "ready" vs ref 60118 "Sure" — **near-tie flip**: ref top-2 gap is 0.23 logits (14.51 "Sure" vs 14.29 "ready"), inside int8 noise; prefill-last argmax exact (163586) |
| greedy smoke generation | **`ready<|im_end|>`** — exactly the instructed behavior, ~0.2 s/decode step warm, peak RSS 7.5 GiB |

Same cos≥0.99 + argmax-exact regime as M3 on the seed-7 check; the one argmax flip is a
documented two-way tie, and the generated behavior is correct.

## 6. `.litertlm` bundling + desktop runtime — WORKS

- `export_lib.export_tokenizer` fails for Moonlight's tiktoken tokenizer (its sentencepiece
  converter chokes: "Wire format was corrupt"). Workaround in `m4/bundle_litertlm.py`: build a
  proper HF `tokenizer.json` via `transformers.convert_slow_tokenizer.TikTokenConverter` +
  manually appended 258 special tokens (verified: text and special-token encodings match the
  remote-code tokenizer exactly), then drive `litert_lm_builder.package_model` standalone with
  `tokenizer_path_override` (jinja chat template embedded).
- Bundle: `artifacts/m4/p24-bundle/model.litertlm`, **7,070,142,384 B**.
- Desktop runtime: **`litert-lm` 0.17.0 pip (macOS arm64 native `liblitert-lm.dylib`) loads and
  runs the bundle**: `run --prompt "Reply with the single word: ready"` → `ready` (9.5 s total
  cold, peak RSS 13.2 GiB, XNNPACK weight cache written); haiku prompt → coherent 3-liner in
  4.8 s warm (~6–8 tok/s CPU decode). `describe` reports Text modality, temp 0 sampler.
- Not exercised: any mobile delegate/NPU path, and no physical device — no on-device numbers.

## 7. Artifact inventory (local only; NOTHING uploaded)

| file | size |
|---|---|
| `artifacts/m4/p24-export/model_quantized.tflite` | 7,066,570,672 B (6.58 GiB) |
| `artifacts/m4/p24-bundle/model.litertlm` (+ tokenizer.json 19.6 MB, xnnpack cache 6.7 GB) | 7,070,142,384 B |
| `artifacts/m4/pruned-24/` / `pruned-16/` (bf16 HF checkpoints + `kept_experts.json`) | 12.97 / 9.61 GiB |
| `artifacts/m4/router-stats.npz` | 24 KB |
| `artifacts/m4/p24-ref-seed7.npz` / `p24-ref-smoke.npz` | 4.5 / 10.4 MB |
| `artifacts/m4/bpb-*.json`, `instruct-*.json`, `*.log` | eval evidence |
| carried from M3: `artifacts/full-export/model_quantized.tflite` | 15.09 GiB (parity baseline) |

Deleted this session: p24 `weights.f32` (25.9 GiB), p24 fp32 `model.tflite` (25.9 GiB). Disk ≥90 GB free.

## 8. Repro commands

```bash
cd /Users/timsan/litert-torch-m3 && source /Users/timsan/litert-torch-m3-venv/bin/activate
SNAP=$(ls -d ~/.cache/huggingface/hub/models--moonshotai--Moonlight-16B-A3B-Instruct/snapshots/*/)

# 1. calibration + eval data
python m4/calib_data.py --tokenizer-dir "$SNAP" --out-dir artifacts/m4
# 2. router stats (13 min, MPS)
python -u m4/router_stats.py --model-dir artifacts/full-model --calib-ids artifacts/m4/calib_ids.npy \
    --out artifacts/m4/router-stats.npz --device mps --dtype bfloat16 --sub-batch 16
# 3. prune
python -u m4/prune_checkpoint.py --model-dir artifacts/full-model --stats artifacts/m4/router-stats.npz \
    --keep 24 --out-dir artifacts/m4/pruned-24   # and --keep 16
# 4. bits per byte (per model; ~5 min each on MPS)
python -u m4/eval_bpb_streamed.py --model-dir artifacts/m4/pruned-24 --tokenizer-dir "$SNAP" \
    --eval-text artifacts/m4/eval_text.txt --device mps --dtype bfloat16 --sub-batch 8 --out artifacts/m4/bpb-p24.json
python -u m4/eval_bpb_hf.py --model-id google/gemma-4-E2B-it --eval-text artifacts/m4/eval_text.txt \
    --device mps --batch 2 --out artifacts/m4/bpb-gemma4e2b.json
# 5. instruct sanity
python -u m4/instruct_generate.py --model-dir artifacts/m4/pruned-24 --tokenizer-dir "$SNAP" \
    --prompts artifacts/m4/instruct_prompts.json --device mps --out artifacts/m4/instruct-p24.json
python -u m4/instruct_generate_tflite.py --tflite artifacts/full-export/model_quantized.tflite \
    --prompts artifacts/m4/instruct_prompts.json --cache-len 128 --max-new 64 --out artifacts/m4/instruct-full-int8.json
# 6. convert + quantize winner (32 min total)
python -u m3/convert.py --model-dir artifacts/m4/pruned-24 --workdir artifacts/m4/p24-export \
    --load mmapf32 --cache-len 128 --prefill-len 8 --quantize dynamic_wi8_afp32
# 7. fresh references + parity + smoke
python -u m3/ref_logits_streamed.py --model-dir artifacts/m4/pruned-24 --out artifacts/m4/p24-ref-seed7.npz
python -u m3/parity_check_nodelegate.py --tflite artifacts/m4/p24-export/model_quantized.tflite \
    --ref artifacts/m4/p24-ref-seed7.npz --cache-len 128 --prefill-len 8
python -u m3/smoke_generate_nodelegate.py --tflite artifacts/m4/p24-export/model_quantized.tflite \
    --cache-len 128 --max-new 12
# 8. bundle + desktop runtime (tokenizer.json built per m4/bundle_litertlm.py docstring)
python -u m4/bundle_litertlm.py --model-dir artifacts/m4/pruned-24 --tokenizer-dir "$SNAP" \
    --tflite artifacts/m4/p24-export/model_quantized.tflite --workdir artifacts/m4/p24-bundle \
    --tokenizer-json artifacts/m4/p24-bundle/tokenizer.json
litert-lm run artifacts/m4/p24-bundle/model.litertlm --prompt "Reply with the single word: ready"
```

## 9. Shipping verdict vs the Gemma 4 E2B bar

**REJECT for the app registry as-is; publish nothing.**

- On raw-text modeling, pruned-24 **beats the bar decisively** (0.967 vs 1.812 bits/byte) at a
  phone-plausible 6.58 GiB int8 — the full pipeline (prune → convert → quantize → bundle →
  runtime) is proven end-to-end, which was the engineering goal of M4.
- But the product bar is an *instruct* assistant, and there pruned-24 **loses to Gemma 4 E2B on
  sight**: broken turn-termination, repetition loops, factual slips — pruning without healing
  damaged exactly the chat behaviors the app needs. pruned-16 (the ~5 GB 4-bit-class target) is
  rejected on both axes (BPB 2.31 > Gemma's 1.81).
- Root cause is structural: Moonlight's routing is deliberately load-balanced (effective ~45 of
  64 experts; top-24 hold only ~69% of routing mass), so zero-shot expert dropping at 2.7×+ is
  lossy. REAP-style scoring worked as designed — the model just doesn't have 40 dead experts.
- Paths that could flip the verdict, in order of expected value: (a) **post-prune healing**
  (LoRA/short full fine-tune of the pruned-24 checkpoint on chat data — specifically targets the
  turn-end/repetition damage), (b) milder ratio (64→32, est. ~8.1 GiB int8) + healing, (c) int4
  expert weights via the `moe` custom op (LiteRT#9930 + int4 weight_type) to buy back size
  headroom. None are in M4 scope on this machine.

M4 exit per PLAN: **registry entry = explicitly rejected, with the eval numbers above.**
