# Can I AI? Benchmark Methodology — round 2026.09

**Goal:** the reference benchmark for consumer on-device AI, at community scale.
MLCommons' [MLPerf Inference: Mobile](https://mlcommons.org/benchmarks/inference-mobile/)
and [MLPerf Client](https://mlcommons.org/benchmarks/client/) set the bar for
rigor — but they are vendor-submitted, twice a year, require a 200 GB install,
and publish dozens of results per round. Can I AI? runs in any browser with
zero install and already captures more devices per week than MLPerf Mobile
publishes per round. This document adopts MLPerf's rigor so those results are
*comparable and authoritative*, not just numerous.

The implementation of everything below is `src/lib/benchmark/spec.ts`
(pure, unit-tested); the MCP server mirrors the constants (parity-tested).

## 1. What we learned from MLPerf, and what we adopted

| MLPerf principle | How MLPerf does it | Can I AI? 2026.09 |
| --- | --- | --- |
| Standard scenarios | Single-stream (sequential, **90th-percentile latency**), Offline (throughput), 1024 queries / 60 s min | Single-stream suite: prompts sequential × 3 runs; **TTFT p90**, **TPS p50 (median)** per category. Concurrent category ≈ offline (extended) |
| Accuracy gate | Every perf result must hit a quality target (e.g. TinyMMLU ≥ 61 %, IFEval-33) or it's invalid | **Quality smoke test**: 6 objective eval-suite prompts, keyword-scored; mean ≥ 0.5 required for `certified` |
| Closed vs Open division | Closed = same reference model, apples-to-apples; Open = any model | `closed` = the engine's reference preset (`gemma-1b` / `webllm-llama-1b` / `onnx-smollm2-135m`); `open` = anything else |
| Base / Extended / Experimental | Only base components contribute to the official score | Base categories (ttft, short, medium, long, reasoning) score; extended (long_context, multi_turn, concurrent) are reported only |
| LLM metrics | TTFT + TPS (excl. first token); TPOT/TTFT constraints: interactive 500/30 ms, conversational 2000/100 ms | Same metrics; every run gets a `latency_class` — interactive / conversational / batch — from TTFT p90 and TPOT p50 |
| Overall score | Per-category scores combined (MLPerf Client) | **Geometric mean** of base-category median tok/s (scale-robust, outlier-resistant) |
| LoadGen validity | Minimum query counts, sanity checks, audit | `validateRun`: ≥ 3 valid runs per base category, per-sample sanity (finite, TTFT ≤ total, ≥ 4 tokens), throttling detection → `result_tier` |
| System description | Submitter, software, system, processor, accelerator, code | Device model / GPU / RAM / cores / OS / browser + `engine`, `model_id`, `spec_version`, run `conditions` |
| Test conditions (Mobile principle #4) | Ambient temperature, battery | `conditions`: battery charging/level, tab visibility, network type, suite duration; `thermal_decay` ratio flags throttling |
| Versioned rounds | v0.7 … v6.0; results comparable within a version | `spec_version` (this doc = `2026.09`); leaderboards are per round |
| Public results explorer | Filterable table, expandable columns | Community feed shows division, tier, score, latency class; per-model leaderboards (roadmap §5) |

## 2. Scoring rules

### 2.1 Run structure
- The suite runs the 16 prompts in `BENCHMARK_PROMPTS` sequentially, **3 runs each** (48 generations), followed by the **6-prompt quality smoke test** (6 generations).
- No warm-up run is discarded; instead medians are used so a cold first run cannot dominate.

### 2.2 Per-run metrics
- `tokens_per_second` = decoded tokens ÷ wall-clock generation seconds.
- `ttft_ms` = time to first token (prefill latency).
- `tpot_ms` = mean inter-token latency during decode.

### 2.3 Per-run validity (`sampleProblem`)
A run is dropped from statistics, with the reason recorded, if any metric is non-finite or negative, duration is zero, TTFT exceeds total time, or (outside the `ttft` category) fewer than 4 tokens were generated.

### 2.4 Aggregation (`aggregateRun`)
- Per category: `tps_p50`, `ttft_p50_ms`, `ttft_p90_ms`, `tpot_p50_ms`, `tokens_mean` (nearest-rank percentiles, as LoadGen reports).
- `overall_score` = geometric mean of `tps_p50` over base categories with ≥ 3 valid runs.
- `ttft_p90_ms` over all base runs; `tpot_p50_ms` over base decode runs.
- `latency_class` per MLPerf LLM constraints (interactive ≤ 500 ms / 30 ms; conversational ≤ 2000 ms / 100 ms; else batch).
- `thermal_decay` = median tok/s of the last third of base decode runs ÷ first third; < 0.7 is flagged.

### 2.5 Result tiers
| Tier | Meaning | Rankable |
| --- | --- | --- |
| `certified` | all base categories valid **and** quality ≥ 0.5 | ✅ |
| `valid` | stats valid, quality unknown or failed | listed, not ranked |
| `invalid` | insufficient/malformed runs | diagnostics only |
| `reported` | submitted via MCP by an external agent (not run by the in-app suite) | listed as open, not ranked |

### 2.6 Verdict
On `overall_score`: **≥ 15** "Yes, you can AI!", **≥ 6** "Mostly, yes", **≥ 1** "Barely…", else "No, not yet". One definition, used by the UI, the feed, and the MCP server.

## 3. Divisions
- **Closed**: the engine's reference preset. Because engines are model-format-specific (MediaPipe runs only Gemma `.task`), there is one reference per engine; closed results are apples-to-apples *within an engine class* and clearly labelled.
- **Open**: any preset. Reported with `model_id` so leaderboards can group by model.

## 4. Submission record
Every row carries: `spec_version`, `division`, `model_id`, `overall_score`, `ttft_p90_ms`, `tpot_p50_ms`, `latency_class`, `quality_score`, `result_tier`, `validity {valid, reasons[]}`, `stats` (per-category), `conditions`, raw per-run `results`, plus the device description. Legacy rows (pre-2026.09) have NULL methodology columns and fall back to `avg_tps` / `verdict` in the UI.

## 5. Roadmap to authority (beyond MLPerf)

Status is tracked here (checked items are merged on the working branch). An
autonomous cloud routine works through unchecked items in order.

- [ ] **5.1 Per-device leaderboards** — aggregate certified runs by (spec_version, division, model_id, device fingerprint): median-of-N submissions with N shown as confidence. MLPerf has one number per vendor system; we show the distribution across thousands of real units. (Postgres view + `Leaderboard` component with React Query, error/empty states, tests.)
- [ ] **5.2 Reference-model rounds** — bump `spec_version` when reference presets or prompts change; `docs/METHODOLOGY_CHANGELOG.md` like MLPerf release notes; feed filter by round.
- [ ] **5.3 4K-context prompt** (MLPerf Client mandates 4K prompt lengths) as an extended category, with a prefill-throughput metric (prompt tokens/s).
- [ ] **5.4 Energy proxy** — MLPerf reports energy per stream; browsers can't measure power, but battery-level delta over the suite on mobile gives a comparable "battery % per 1k tokens" (conditions already capture battery level).
- [ ] **5.5 Reproducibility audit** — flag certified results whose device model has ≥ 5 runs and whose score is > 2× the device median (outlier demotion to `valid`).
- [ ] **5.6 Structured-output and code tasks** (MLPerf Client base categories) as scored base prompts once the eval judge can gate them.
- [ ] **5.7 MCP parity for leaderboards** — `get_leaderboard` tool so external agents can query the same aggregates.
