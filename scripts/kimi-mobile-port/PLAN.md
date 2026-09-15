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
- **M3 — full Moonlight-16B convert** ✅ **DONE 2026-09-13** — completed
  ON THE 32 GB M4 MAC (no GPU box needed): 4.8 h streamed fp32 convert
  (peak RSS 16.4 GiB), int8 dynamic-range quantize to **15.09 GiB**
  (3.9x, 261 s), parity vs fp32 eager reference cos ≥0.9937 with exact
  argmax on all checked positions, coherent greedy smoke generation
  (~0.5 s/token on CPU reference kernels once paged in). Full numbers
  in [M3-results.md](./M3-results.md); tooling in `m3/` on the fork.
  Two operational findings: the flatbuffer is fully self-contained
  (weights.f32 staging blob deletable), and XNNPACK's fp32 FC repacking
  makes the un-quantized model infeasible on 32 GB (use
  BUILTIN_WITHOUT_DEFAULT_DELEGATES for fp32 checks). Original scope:
  checkpoint mapping, end-to-end logits parity on 32 prompts, then
  quantized `.litertlm` export. Watch: export writes an fp32 intermediate
  (~66 GB for 16.4B) and no int4 path exists for expert weights yet (int8
  only → REAP pruning may move earlier). Exit: artifact loads in LiteRT-LM
  runtime on a desktop host.
- **M4 — prune + on-device** ✅ **DONE 2026-09-15 — exit = REJECTED with
  eval numbers** (see [M4-results.md](./M4-results.md) and checkpoint
  log). Pipeline proven end-to-end (prune → convert → quantize →
  .litertlm bundle → litert-lm desktop runtime), pruned-24 beats the
  Gemma 4 E2B bar on bits/byte (0.967 vs 1.812) at 6.58 GiB int8, but
  its instruct behavior is visibly damaged — not shippable without
  post-prune healing. Original scope: REAP-prune experts to a
  ~5 GB 4-bit artifact; quality eval vs Gemma 4 E2B (the bar to beat);
  smoke on a 16 GB Android flagship and M-series iPad (no device lab
  was available; desktop LiteRT-LM runtime smoke ran instead). Exit:
  registry entry in the app (published or explicitly rejected with
  eval numbers).
- **M4.5 (proposed) — post-prune healing**: LoRA/short fine-tune of the
  pruned-24 checkpoint on chat data to repair turn-termination and
  repetition damage; re-run the instruct sanity + BPB gate. Alternates:
  64→32 + healing (~8.1 GiB), or int4 experts via the moe custom op
  once LiteRT#9930 lands to buy size headroom.
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

- 2026-09-15: M4 started on the M4 Mac: REAP-style router-guided expert
  pruning (64→24 and 64→16 variants), bits-per-byte quality eval vs the
  unpruned baseline and google/gemma-4-E2B-it, then convert+quantize the
  winner through the M3 pipeline; .litertlm bundling best-effort (no
  physical device available). LiteRT#9930 still blocked on CLA
  (cla/google=failure — needs the user's signature).
- 2026-09-15 (M4 done — **REJECT verdict**): REAP-style router-guided
  pruning executed end-to-end on the M4 Mac (no device lab available).
  Router stats over 196k mixed calib tokens show Moonlight's routing is
  deliberately flat (effective ~45/64 experts; top-24 hold only 69% of
  weight mass) — zero-shot expert dropping is therefore lossy. Bits/byte
  (wikitext-2 test, tokenizer-independent): unpruned 0.824, pruned-24
  0.967, pruned-16 2.313 vs Gemma 4 E2B bar 1.812. pruned-24 (6.96 B)
  converted+quantized in 32 min → 6.58 GiB int8 tflite, parity cos
  0.9998/argmax-exact, and — new — bundled to .litertlm (tiktoken →
  tokenizer.json workaround) and **runs in the litert-lm 0.17.0 desktop
  runtime on macOS** (~6–8 tok/s CPU decode). But pruned-24 instruct
  behavior is visibly broken (turn-end failures, repetition loops) while
  Gemma's is crisp → rejected for the registry as-is; next levers are
  post-prune healing (LoRA on chat data), 64→32 + healing, or int4
  experts via LiteRT#9930. Full numbers:
  ~/litert-torch-m3/artifacts/m4/M4-RESULTS.md; m4/ tooling pushed to
  the fork (63b7d27). Nothing uploaded to HF; no PRs opened.
- 2026-09-13 (M3 done): full Moonlight-16B converted, quantized and
  verified on the M4 Mac — see M3-results.md. The first attempt's
  supervising session stalled but the 4.8 h conversion itself succeeded;
  a follow-up session did quantize + parity + smoke. int8 artifact:
  15.09 GiB (kept locally at
  ~/litert-torch-m3/artifacts/full-export/model_quantized.tflite; NOT
  uploaded — exceeds phone RAM by design, it's the parity baseline for
  M4 pruning). m3/ verification tooling pushed to the fork. Remaining
  M3-deferred items: .litertlm bundling + on-device smoke (folds into
  M4, where the artifact is phone-sized). LiteRT#9930 blocked on
  Google CLA signature (user action).
- 2026-09-12: **Upstream SiLU PR opened:**
  [google-ai-edge/LiteRT#9930](https://github.com/google-ai-edge/LiteRT/pull/9930)
  (fork `internetoftim/LiteRT`, branch `moe-silu-activation`) — adds
  `activation='silu'` to the XNNPACK moe kernel, CPU path only (GPU
  parser deliberately untouched — can't validate its expert body from
  outside). Re-verified before patching: upstream still gelu-only, and
  the CPU kernel now also parses int4 weight_type (moved since the M2
  probe). M3 (full Moonlight convert) attempt started on the 32 GB M4
  Mac: 4-layer real-weight slice first, then full 27-layer with a
  memory strategy; results pending.
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
