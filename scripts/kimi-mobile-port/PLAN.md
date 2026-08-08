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
- **M1 — `export_hf/model_ext/deepseek_v3` (cloud, ~week)**: cache-shape
  override for asymmetric head dims (k=192/v=128), attention output-reshape
  patch, noaux_tc router rewritten gemma4-style (static-shape mask
  arithmetic, no scatter_). Naive full-K/V cache is acceptable (≈1.1 GB
  fp16 @ 4K ctx); latent caching deferred to M3 as an optimization. Unit
  parity vs `transformers` DeepSeek-V3 on random weights (fp32 CPU,
  atol 1e-4). Exit: parity test green in the fork's CI.
- **M2 — MoE dispatch (cloud, ~week)**: 2-layer toy `.tflite` export with
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
