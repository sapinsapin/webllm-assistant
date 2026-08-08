# M0 Go/No-Go Memo — Kimi/Moonlight (DeepSeek-V3) port to ai-edge-torch / LiteRT-LM

**Date:** 2026-08-08 · **Milestone:** M0 feasibility spike (see PLAN.md)
**Source examined:** `google-ai-edge/ai-edge-torch` @ `ed258930cc86` (2026-08-07).
Produced by the M0 cloud spike session; paths are relative to that repo root.

## Headline

**GO — with a major plan revision.** The repo has changed substantially since
PLAN.md was written (package renamed `ai_edge_torch` → `litert_torch`), and two
of the three "missing" components are no longer entirely missing:

1. **MoE is already in-tree.** `litert_torch/generative/layers/moe.py`
   implements a TFLite **custom op `"moe"`** (fp32 and int8 variants) plus a
   dense **sequential fallback**, wired into HuggingFace transformers via
   `transformers.integrations.moe.ALL_EXPERTS_FUNCTIONS`
   (`litert_torch/generative/export_hf/model_ext/__init__.py`). Gemma 4 — the
   PLAN's own quality bar — is a MoE model exported through this exact
   machinery (`export_hf/model_ext/gemma4/patch.py`).
2. **A second, HF-native export path exists** (`litert_torch/generative/export_hf/`)
   that exports `transformers` models directly through `torch.export` with a
   registered `lrt_transposed_attention` backend — no reauthoring required.
   Since DeepSeek-V3/Moonlight ships in `transformers`, the fastest route is a
   `deepseek_v3` **model_ext** (cache-shape override + small attention patch),
   not a from-scratch reauthor in `generative/layers`.

MLA still requires new code on either path, but it is a bounded, expressible
change — not an architectural blocker.

## 1. Authoring API map

**Layers** (`litert_torch/generative/layers/`):
- `attention.py` — `TransformerBlock`, `CausalSelfAttention` (fused QKV, single
  `head_dim`, MHA/MQA/GQA via `num_query_groups`), `SelfAttention`,
  `CrossAttention`.
- `model_config.py` — dataclass configs. `AttentionConfig` has
  `num_heads`/`head_dim`/`num_query_groups`/`rotary_percentage`/q-k-v norms;
  `FeedForwardType` is **`SEQUENTIAL` or `GATED` only — no MoE variant**; no
  low-rank/MLA fields.
- `kv_cache.py` — `KVCacheEntry`/`KVCache`: plain tensors + layouts (`BTNH`,
  transposed `BNHT`), shapes derived from `num_query_groups × head_dim`,
  updated via `custom_ops/dynamic_update_slice.py`. Shape-agnostic machinery.
- `feed_forward.py`, `builder.py` — dense FFN builders only.
  `moe.py`/`moe_test.py` — MoE custom op (see §3). Also `einsum.py`,
  `lora.py`, `rotary_position_embedding.py` (`build_rope` per-model pluggable
  via `ModelConfig.build_rope`), `sdpa_with_kv_update.py`.

**Examples** (`litert_torch/generative/examples/`): gemma/gemma3, llama, phi,
qwen, qwen_vl, smollm, openelm, paligemma, t5, stable_diffusion, and
**`deepseek/`** — but that is **DeepSeek-R1-Distill-Qwen (dense GQA)**, not V3
(`examples/deepseek/deepseek.py`, class `DeepSeekDistillQwen`). **No
reauthoring example uses MoE or MLA.**

**HF export path** (`litert_torch/generative/export_hf/`): `export_lib.py`
loads any `AutoModelForCausalLM`, sets
`config._attn_implementation = 'lrt_transposed_attention'` and
`config._experts_implementation = 'litert_moe' | 'litert_moe_sequential'`,
exports prefill+decode signatures, quantizes via `ai_edge_quantizer`, and
bundles `.litertlm`. Per-model quirks live in
`export_hf/model_ext/{gemma3n,gemma4,qwen3_5,lfm2,...}` — the exact template a
`deepseek_v3` extension should follow. **Closest MoE analog:
`model_ext/gemma4`** (custom router patch + `moe` custom op + per-expert
scales + split-cache variant).

## 2. MLA feasibility

**Verdict: feasible; needs a new attention class (reauthoring path) or a
model_ext patch (HF path). Latent caching is expressible but is new work; the
naive path is acceptable at 4K context.**

- The reauthoring `CausalSelfAttention` cannot express MLA as-is: it assumes
  one fused `qkv_projection` with a single shared `head_dim` and applies RoPE
  to the full head (`layers/attention.py` lines 205–261). MLA needs: kv
  down-proj to rank 512, RMSNorm on the latent, up-proj to per-head
  K_nope/V, a separate 64-dim decoupled-RoPE key path, and q/k head dim (192)
  ≠ v head dim (128). None of that fits `AttentionConfig`; **a new
  `MLAttention` class + config extension is required** (M1 as planned). No
  `q_lora_rank` complication for Moonlight (q is a plain projection).
- The HF path is closer: `export_hf/core/attention.py` registers
  `lrt_transposed_attention` against `transformers.AttentionInterface`, and
  DeepSeek-V3's HF attention goes through that interface. Two concrete
  asymmetry bugs/limits found for MLA:
  - `transposed_attention` reshapes the SDPA output with `h` taken from the
    **query** head dim (`sdpa_out.reshape(b, -1, seq_len, h)`, lines 190/206)
    — wrong when v_head_dim (128) ≠ qk_head_dim (192). Small patch.
  - `export_hf/core/cache.py` assumes one `head_dim` for both K and V
    (`self.head_dim = self.v_cache_shape[...]`, line 272; K reshapes at lines
    317–321 reuse it), and `_infer_cache_shape_from_config` reads `head_dim`
    from config. Needs a deepseek_v3 cache-shape override — precedent exists
    (`global_head_dim` special-casing, line 419).
- **Latent (rank-512) caching:** no KV-cache machinery on either path knows
  about compressed latents; HF's DeepSeek-V3 code materializes full K/V. But
  `KVCacheEntry` is just tensors — a custom MLA block can allocate a
  `[B, S, 1, 576]` cache (c_kv 512 + rope-k 64) and do absorbed attention with
  einsums (`layers/einsum.py` exists; `torch_tfl` lowers einsum/bmm).
  Genuinely new work; whether the absorbed einsum chain lowers cleanly and
  performs well is **needs experiment**.
- **Naive-path memory cost (Moonlight-16B: 27 layers, 16 heads, qk 192 /
  v 128):** full K+V = 16×(192+128) = 5,120 elem/token/layer vs 576 for the
  latent — **8.9×**. At 4,096 context: ~1.13 GB fp16 (2.26 GB fp32) naive vs
  ~127 MB fp16 latent. **Recommendation: ship M1 with the naive cache
  (tolerable at 2–4K context on a 16 GB device), treat latent caching as an
  M3 optimization, not a gate.**

## 3. MoE feasibility

**Verdict: feasible — routing lowers to supported ops, and two
expert-dispatch implementations already exist in-tree.**

- **Router ops:** `torch.topk` decomposes to `tfl.topk_v2`
  (`backend/experimental/torch_tfl/_decomps.py` line 417; lowering at
  `_lowerings.py` line 692; largest=True only — fine). Sigmoid, softmax,
  one-hot compare-masks all lower. `gemma4/patch.py` (lines 347–372) shows the
  proven pattern: probabilities → `topk` → int32 indices → `arange`+`==` mask
  arithmetic instead of `scatter_`. DeepSeek's `noaux_tc` (bias-corrected
  sigmoid scores, group-topk then in-group top-k) uses `scatter_`/group
  reductions in HF's implementation — **rewrite it gemma4-style with
  static-shape mask arithmetic**; with Moonlight's `n_group=1` the group stage
  may collapse entirely (verify against the actual checkpoint config; note
  PLAN says top-8 but Moonlight's config is `num_experts_per_tok=6` — confirm
  at M2).
- **Dynamic dispatch:** true token-gather dispatch is *not* expressed in
  TFLite ops at all — it lowers to a **`tfl.custom` op named `"moe"`** taking
  `(src, top_weights, top_indices, gate_w, ff1_w, down_w, per_expert_scale)`
  with flexbuffer options (`layers/moe.py`, `_tfl_custom_moe`). The runtime
  kernel lives in LiteRT, not this repo. Two caveats in the wrapper: options
  hardcode `"activation": "gelu"` and `renormalized_top_weights: True` (lines
  141–151), and `weight_type` supports only `fp32`/`int8`. DeepSeek experts
  use **SiLU** — whether the runtime kernel accepts `"silu"` is **needs
  experiment** (likely a small kernel/flag addition since the field is
  parameterized). Delegate coverage (CPU/GPU/NPU) on-device is also **needs
  experiment**.
- **Dense fallback:** `litert_sequential_experts_forward` (moe.py lines
  466–530) computes **all** experts with pre-split per-expert weights
  (`pre_split_model_experts`, `export_lib.py` line 155) and mask-accumulates —
  activation comes from `ACT2FN[config.hidden_activation]`, so SiLU works
  today. Auto-selected for split-cache exports
  (`exportable_module_config.py` line 175). **Cost estimate:** routed experts
  are ~14.4 B of Moonlight's 16.4 B params (26 MoE layers × 64 experts × 3 ×
  2048×1408). Dense fallback makes every token pay the full 16.4 B — decode is
  bandwidth-bound, so at 4-bit that's ~8.2 GB weight traffic/token vs ~1.5 GB
  active-only: **≤ ~6 tok/s theoretical, realistically 2–4 tok/s on a
  ~50 GB/s flagship — usable for parity tests and toy exports (M2 exit), not
  shippable.** The custom `moe` op (or REAP pruning to far fewer experts) is
  required for the shipping artifact.
- **Shared expert:** just a dense gated FFN added to the routed output —
  trivially expressible (Moonlight has 2 shared experts; fold into one FFN of
  2× width).

## 4. Converter / LiteRT constraints

- **Quantization of grouped expert weights:** `ai_edge_quantizer` recipes
  target `FULLY_CONNECTED` / `EMBEDDING_LOOKUP` (`export_lib.py` lines
  497–508). The `moe` custom op bypasses that — int8 expert weights are passed
  as explicit tensors + scale tensors in delegate OHWI layout
  (`flatten_expert_weight/scale`, moe.py). **No int4 path for expert weights
  exists** (`weight_type ∈ {fp32, int8}`): at int8, unpruned routed experts
  alone are ~14.4 GB. PLAN's ~5 GB 4-bit target therefore depends on REAP
  pruning **and** an int4 moe-kernel path that does not exist yet — **needs
  experiment / likely upstream kernel work**.
- **Model size through the pipeline:** export writes an fp32 `model.tflite`
  before quantizing (`export_lib.py` lines 461–473) — ~66 GB intermediate for
  16.4 B fp32. `experimental_lightweight_conversion` exists, and flatbuffer
  >2 GB handling in current LiteRT is **needs experiment**. Plan M3 on a
  big-disk GPU box; use random-weight 2-layer toys
  (`use_random_weights=True` is supported) for everything before checkpoint
  mapping.
- **Known-unsupported:** dynamic/longrope RoPE rejected outright
  (`export_lib.py` line 91); quantized source checkpoints rejected (line 124).
  Moonlight uses standard RoPE — fine.
- `topk_v2` largest-only, `tfl.gather` 1-D-indices note
  (`torch_tfl/_decomps.py` line 377) — the gemma4 mask-arithmetic router
  pattern avoids both pitfalls.

## 5. Verdict

| Component | Verdict | Basis |
|---|---|---|
| **MLA** | **GO** | Expressible on both paths; needs new attention class or ~2 targeted patches (attention output reshape, cache head-dim asymmetry). Naive KV cache costs ~1.1 GB fp16 @ 4K ctx — acceptable interim; latent caching is an optimization. |
| **MoE** | **GO (conditional)** | Routing lowers (topk_v2 + masks, proven by gemma4). Dispatch: custom `moe` op exists but is gelu/int8-flavored today (SiLU + int4 support **needs experiment**); dense sequential fallback works today for parity/toys but is 2–4 tok/s-class — not shippable. |
| **Full Moonlight tower** | **GO (M3 gated on two experiments)** | (a) `moe` custom-op kernel accepts SiLU + non-renormalized/scaled sigmoid weights on target delegates; (b) 16 B-scale model survives convert+quantize (fp32 intermediate, int4 experts). |

**Recommended implementation order (revises PLAN M1/M2):**
1. **M1 — deepseek_v3 via `export_hf`, not reauthoring:** build
   `export_hf/model_ext/deepseek_v3/` (cache-shape override for k=192/v=128,
   attention output-reshape patch, noaux_tc router rewritten gemma4-style).
   Parity vs HF on random weights. This reuses the maintained path and matches
   how Google ports its own MoE models.
2. **M2 — MoE dispatch:** parity + 2-layer toy `.tflite` with
   `litert_moe_sequential` first (works today); in parallel, experiment with
   the `moe` custom op (SiLU flexbuffer option, runtime kernel acceptance,
   int8 scales).
3. **M3 — full convert** on GPU box; only then invest in latent-cache
   absorbed MLA if 4K-context memory or speed demands it.
4. Keep the `generative/layers` reauthored MLA/MoE variant only if upstreaming
   (M6) requires it — check with maintainers first; they are actively
   investing in the export_hf path.

**Top 3 technical risks:**
1. **`moe` custom-op runtime contract** — the kernel is outside this repo;
   SiLU activation, DeepSeek's sigmoid+`routed_scaling_factor` weighting,
   64-expert/rank sizes, int4 weights, and delegate coverage (CPU/GPU/NPU) are
   all unverified. Fallback is the dense path, which caps decode at
   ~2–4 tok/s unpruned.
2. **MLA asymmetric head dims through cache + transposed-attention plumbing**
   — several single-`head_dim` assumptions (`core/cache.py:272,317–331`;
   `core/attention.py:190,206`) must be patched consistently across prefill,
   decode, and split-cache variants; silent shape-coercion bugs here are
   exactly the "silently diverging model" PLAN warns about. Parity tests at
   every step.
3. **Scale through the converter/quantizer** — 66 GB fp32 intermediate,
   flatbuffer size limits, and the missing int4-expert quantization path
   together gate the shippable ~5 GB artifact; REAP pruning (M4) may need to
   move earlier if int4 expert kernels don't materialize.
