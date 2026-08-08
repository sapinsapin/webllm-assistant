# Kimi → LiteRT mobile architecture port — work plan

Status: **started 2026-08** (long-running; cloud-driven). This is the
Phase-3 "multi-week port" that scripts/kimi-mlx/README.md declares blocked —
this document is the unblock plan. Owner: cloud agent sessions, checkpointed
here; nothing in the app depends on it until M4.

## Goal

Run a Kimi-family model natively on Android/iOS via LiteRT-LM, by porting
the missing architecture pieces into
[ai-edge-torch](https://github.com/google-ai-edge/ai-edge-torch)'s
generative authoring API. Because all 16.4B MoE params stay resident,
the *shippable* target is a **REAP-pruned Moonlight text tower** (~5 GB at
4-bit, tablet/flagship tier); the unpruned port is still built first because
parity-testing against the reference model requires it.

## What's missing in ai-edge-torch (the actual port surface)

| Component | Kimi/Moonlight uses | ai-edge-torch today |
|---|---|---|
| Attention | MLA (multi-head latent attention, kv_lora_rank=512) | standard MHA/GQA only |
| FFN | DeepSeek-V3 MoE: 64 routed experts, sigmoid scoring, `noaux_tc` top-k, shared experts | dense FFN only |
| Vision (stretch) | MoonViT (native-resolution ViT) | a few fixed ViTs |

## Milestones

- **M0 — feasibility spike** ✅ **DONE 2026-08-08 — GO** (see
  [M0-memo.md](./M0-memo.md)). Key revision: upstream renamed the package
  `litert_torch` and now has (a) an in-tree MoE custom op + dense fallback
  already used by Gemma 4's export, and (b) an HF-native `export_hf` path
  that exports `transformers` models without reauthoring. So M1/M2 below
  are re-scoped from "reimplement blocks" to "write a `deepseek_v3`
  model_ext + targeted patches".
- **M1 — `export_hf/model_ext/deepseek_v3`** ✅ **DONE 2026-08-08** —
  landed on the fork (`internetoftim/litert-torch@kimi-moonlight-port`,
  commits 5de5836/ca03ba9/86a230b): asymmetric K/V head-dim cache support,
  attention output-reshape fix, static-shape noaux_tc router. 5/5 parity
  tests green (router atol 1e-6, MoE 1e-5, full prefill+decode 1e-4);
  26-test regression suite clean; torch.export + tfl decompositions
  succeed. Experts needed zero patching (HF DeepseekV3Experts is directly
  litert_moe_sequential-compatible). Correction from checkpoint: Moonlight
  is top-**6** (not top-8), n_group=1, 26/27 layers MoE. Original scope
  below for reference: cache-shape
  override for asymmetric head dims (k=192/v=128), attention output-reshape
  patch, noaux_tc router rewritten gemma4-style (static-shape mask
  arithmetic, no scatter_). Naive full-K/V cache is acceptable (≈1.1 GB
  fp16 @ 4K ctx); latent caching deferred to M3 as an optimization. Unit
  parity vs `transformers` DeepSeek-V3 on random weights (fp32 CPU,
  atol 1e-4). Exit: parity test green in the fork's CI.
- **M2 — MoE dispatch** ✅ **DONE 2026-08-08** — toy .tflite converted and
  verified (see checkpoint log). Original scope below for reference: 2-layer toy `.tflite` export with
  the working `litert_moe_sequential` dense fallback first; in parallel,
  experiment with the `moe` custom op (its options hardcode gelu +
  renormalized weights today — DeepSeek needs SiLU + sigmoid/scaled; kernel
  lives in LiteRT proper and may need an upstream flag). Exit:
  single-layer parity + toy export; custom-op go/no-go recorded here.
- **M3 — full Moonlight-16B convert (cloud, GPU + big-disk box)**:
  checkpoint mapping, end-to-end logits parity on 32 prompts, then
  quantized `.litertlm` export. Watch: export writes an fp32 intermediate
  (~66 GB for 16.4B) and no int4 path exists for expert weights yet (int8
  only → REAP pruning may move earlier). Exit: artifact loads in LiteRT-LM
  runtime on a desktop host.
- **M4 — prune + on-device (Mac + device lab)**: REAP-prune experts to a
  ~5 GB 4-bit artifact; quality eval vs Gemma 4 E2B (the bar to beat);
  smoke on a 16 GB Android flagship and M-series iPad. Exit: registry entry
  in the app (published or explicitly rejected with eval numbers).
- **M5 — MoonViT (stretch)** and **M6 — upstream PR** to ai-edge-torch
  (their maintainers take architecture contributions; upstreaming removes
  our fork burden).

## Ground rules

- Fork `google-ai-edge/ai-edge-torch` under `internetoftim`; all port work
  lands there on branch `kimi-moonlight-port`, PR'd milestone by milestone.
- Parity tests are non-negotiable at every milestone — a converted model
  that silently diverges is worse than no model.
- Each cloud session ends by updating this file's checkpoint log below.

## Checkpoint log

- 2026-08-08 (M2 done): **toy `.tflite` works, numerically verified — no
  converter blockers.** Real converter path on the M1 tiny config with
  `litert_moe_sequential`: one flatbuffer, prefill+decode signatures,
  fp32 decode logits match eager transformers at 4.8e-7; repo-standard
  int8 dynamic-range recipe quantizes cleanly (5.08 → 1.60 MiB, diff
  2.5e-2 = expected quant error). Fork commits 3347ceb/474b814/d81aa3d.
  **`moe` custom-op probe — better than feared:** kernel is public
  (google-ai-edge/LiteRT) and runs under the stock python interpreter;
  DeepSeek's non-renormalized sigmoid weighting already works on the CPU
  kernel (it ignores renormalized_top_weights); the ONLY CPU-path gap is
  `activation='silu'` being rejected at prepare time — a genuinely small
  upstream change. GPU parser is gelu-only + renormalize-required but
  **accepts int4 expert weights**, revising M0's "no int4 path" finding.
  M3 adjustments: (a) full convert derisked except pure scale (66 GB fp32
  intermediate, >2 GB flatbuffer); (b) small upstream-LiteRT PR for SiLU
  unlocks the fast path and makes M4's pruned artifact viable on the
  custom op instead of the 2–4 tok/s dense fallback; (c) size the ~5 GB
  artifact against the GPU delegate's int4 weight_type and extend
  moe.py's weight_type to emit int4.
- 2026-08-08 (M1 done): parity green end-to-end on tiny random-weight
  configs through the real export path (prefill + cached decode vs eager
  DeepseekV3ForCausalLM, atol 1e-4). Negative controls confirm both core
  fixes are load-bearing. Bonus: torch.export and torch_tfl decompositions
  already succeed — no lowering blockers found. M2 start: run
  export_lib's converter on the toy config with litert_moe_sequential and
  numerically check the resulting .tflite; in parallel probe the `moe`
  custom op (needs SiLU + non-renormalized sigmoid weights; kernel lives
  in LiteRT proper). Deferred: latent caching, split-cache variant,
  GPU-composite paths with asymmetric dims.

- 2026-08-08 (later still): M1 started in a cloud session. Fork created:
  upstream renamed the repo too — it is now `google-ai-edge/litert-torch`
  → fork at `internetoftim/litert-torch`, work branch
  `kimi-moonlight-port`. Scope: deepseek_v3 model_ext (cache-shape
  override, attention reshape fix, gemma4-style noaux_tc router,
  litert_moe_sequential experts) + random-weight parity tests. Also:
  `internetoftim/Kimi-VL-A3B-Instruct-mlx-4bit` published (macOS tier
  complete).

- 2026-08-08 (later): M0 complete — **GO** with plan revision; memo at
  [M0-memo.md](./M0-memo.md). M1/M2 re-scoped onto upstream's `export_hf`
  path. Top risks: `moe` custom-op runtime contract (SiLU/int4/delegates),
  asymmetric-head-dim plumbing, converter scale limits.
- 2026-08-08: Plan created. M0 kicked off in a cloud session. Related
  finding: mlc-llm already registers `deepseek_v3`, so the *web* tier of
  Kimi support needs no port at all — only an MLC compile (tracked in
  scripts/kimi-mlx/README.md Phase 2).
