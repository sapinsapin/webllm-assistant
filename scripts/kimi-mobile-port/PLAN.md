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

- **M0 — feasibility spike (cloud, ~days)**: map ai-edge-torch's
  `generative/layers` + `generative/examples` structure; confirm the
  authoring API can express low-rank attention projections and per-token
  expert dispatch (or identify converter ops that cannot lower to LiteRT);
  write up extension points and risks. Exit: go/no-go memo committed here.
- **M1 — MLA block (cloud, ~week)**: implement MLA in the authoring API;
  unit parity vs `transformers` DeepSeek-V3 attention on random weights
  (fp32 CPU, atol 1e-4). Exit: parity test green in the fork's CI.
- **M2 — MoE block (cloud, ~week)**: sigmoid/noaux_tc router + grouped
  expert FFN; same parity discipline. Watch: dynamic top-k dispatch must
  lower to LiteRT ops — if not, fall back to dense-gather masking (slower
  but convertible). Exit: single-layer parity + successful `.tflite` export
  of a 2-layer toy model.
- **M3 — full Moonlight-16B reauthor + convert (cloud, GPU box)**:
  checkpoint mapping, end-to-end logits parity on 32 prompts, then 4-bit
  quantized `.litertlm` export. Exit: artifact loads in LiteRT-LM runtime
  on a desktop host.
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

- 2026-08-08: Plan created. M0 kicked off in a cloud session. Related
  finding: mlc-llm already registers `deepseek_v3`, so the *web* tier of
  Kimi support needs no port at all — only an MLC compile (tracked in
  scripts/kimi-mlx/README.md Phase 2).
