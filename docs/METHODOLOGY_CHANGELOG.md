# Methodology changelog

Release notes for each benchmark round, in the spirit of MLPerf version notes.
Results are comparable **within** a round; the leaderboard is per round. A
round is pinned by a fingerprint of its defining inputs (prompt set, closed-
division reference presets, quality smoke set, category tiers, thresholds);
`src/lib/benchmark/round.test.ts` fails if those change without a new round.

## How to open a new round
1. Change the prompts / references / thresholds in code.
2. Run `npm test` — the round test prints the new fingerprint.
3. Bump `METHODOLOGY_VERSION` in `src/lib/benchmark/spec.ts` and the mirror in
   `supabase/functions/mcp/index.ts`; append a `ROUND_REGISTRY` entry in
   `src/lib/benchmark/round.ts` with that fingerprint.
4. Add a section below. Never edit a past round's entry or fingerprint.

## 2026.09 — opened 2026-09-07 · fingerprint `5c5aa622`
First MLPerf-style round.
- **Scenario**: single-stream; 16 prompts × 3 runs; nearest-rank percentiles (TTFT p90, TPS p50 per category).
- **Score**: geometric mean of base-category median tok/s (base = ttft, short, medium, long, reasoning; extended = long_context, multi_turn, concurrent, reported only).
- **Divisions**: closed = engine reference preset (`gemma-1b` / `webllm-llama-1b` / `onnx-smollm2-135m`); open = any preset.
- **Quality gate**: 6-prompt keyword smoke test (`fact-1, fact-2, math-1, math-2, inst-1, inst-2`), mean ≥ 0.5 for `certified`.
- **Validity**: ≥ 3 runs per base category; per-sample sanity; throttling flag at < 0.7 late/early ratio.
- **Latency classes**: interactive 500/30 ms, conversational 2000/100 ms, else batch.
- **Verdicts**: ≥ 15 / ≥ 6 / ≥ 1 tok/s.
- **Leaderboards**: median-of-N certified runs per device × model × engine (`benchmark_leaderboard` view, MCP `get_leaderboard`).
