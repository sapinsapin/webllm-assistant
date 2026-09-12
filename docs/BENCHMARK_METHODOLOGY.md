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
| Base / Extended / Experimental | Only base components contribute to the official score; extended (e.g. 4K/8K prompts) may not run on every system | Base categories (ttft, short, medium, long, reasoning) score; extended (long_context, long_context_4k, multi_turn, concurrent) are reported only; prompts exceeding the engine's context window are **skipped with a reason**, not failed |
| LLM metrics | TTFT + TPS (excl. first token); TPOT/TTFT constraints: interactive 500/30 ms, conversational 2000/100 ms | Same metrics; every run gets a `latency_class` — interactive / conversational / batch — from TTFT p90 and TPOT p50 |
| Overall score | Per-category scores combined (MLPerf Client) | **Geometric mean** of base-category median tok/s (scale-robust, outlier-resistant) |
| LoadGen validity | Minimum query counts, sanity checks, **audit** | `validateRun`: ≥ 3 valid runs per base category, per-sample sanity (finite, TTFT ≤ total, ≥ 4 tokens), throttling detection → `result_tier`; **reproducibility audit** demotes implausible outliers (§10) |
| System description | Submitter, software, system, processor, accelerator, code | Device model / GPU / RAM / cores / OS / browser + `engine`, `model_id`, `spec_version`, run `conditions` |
| Test conditions (Mobile principle #4) | Ambient temperature, battery; energy per stream via power meter | `conditions`: battery level/charging at start and end, tab visibility, network type, suite duration; `thermal_decay` flags throttling; **energy proxy** = battery % per 1k generated tokens (§9) |
| Versioned rounds | v0.7 … v6.0; results comparable within a version; release notes | `spec_version` + fingerprint-pinned `ROUND_REGISTRY` (a test fails if round inputs change without a new round); [changelog](./METHODOLOGY_CHANGELOG.md); feed and leaderboard filter by round |
| Public results explorer | Filterable table, expandable columns | Community feed shows division, tier, score, latency class; per-model leaderboards (roadmap §5) |

## 2. Scoring rules

### 2.1 Run structure
- The suite runs the 17 prompts in `BENCHMARK_PROMPTS` sequentially, **3 runs each** (the 4K-context prompt runs once; 49 generations), followed by the **6-prompt quality smoke test** (6 generations).
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

- [x] **5.1 Per-device leaderboards** — aggregate certified runs by (spec_version, division, model_id, device fingerprint): median-of-N submissions with N shown as confidence. MLPerf has one number per vendor system; we show the distribution across thousands of real units. (Postgres view + `Leaderboard` component with React Query, error/empty states, tests.)
- [x] **5.2 Reference-model rounds** — bump `spec_version` when reference presets or prompts change; `docs/METHODOLOGY_CHANGELOG.md` like MLPerf release notes; feed filter by round.
- [x] **5.3 4K-context prompt** (MLPerf Client mandates 4K prompt lengths) as an extended category, with a prefill-throughput metric (prompt tokens/s).
- [x] **5.4 Energy proxy** — MLPerf reports energy per stream; browsers can't measure power, but battery-level delta over the suite on mobile gives a comparable "battery % per 1k tokens" (conditions already capture battery level).
- [x] **5.5 Reproducibility audit** — flag certified results whose device model has ≥ 5 runs and whose score is > 2× the device median (outlier demotion to `valid`).
- [ ] **5.6 Structured-output and code tasks** (MLPerf Client base categories) as scored base prompts once the eval judge can gate them.
- [x] **5.7 MCP parity for leaderboards** — `get_leaderboard` tool so external agents can query the same aggregates.

## 6. Leaderboards (implemented in 5.1 / 5.7)

- Postgres view `benchmark_leaderboard` (`security_invoker`, public SELECT) aggregates **certified** runs only, grouped by `(spec_version, division, model_id, engine, device_key)` where `device_key = device_model ?? "os · gpu" ?? "Unknown device"`.
- Per group: `runs` (N), `score_p50/p25/p75` (median and quartiles of `overall_score`), `ttft_p90_p50_ms` (median of per-run TTFT p90), `last_run_at`.
- The `Leaderboard` component (Benchmarks page) shows the current round, closed division by default, ranked by median score with ties broken by N; confidence = high (N ≥ 5), medium (2–4), single run; the ± figure is half the interquartile range as a share of the median.
- External agents get the same aggregates via the MCP tool `get_leaderboard`.
- Legacy, unranked (`valid`), `invalid`, and agent-`reported` rows never enter the leaderboard.

## 7. Rounds (implemented in 5.2)

- A round = `METHODOLOGY_VERSION` + a **fingerprint** of its defining inputs (prompt set, closed-division reference presets, quality smoke set, category tiers, thresholds), recorded in `ROUND_REGISTRY` (`src/lib/benchmark/round.ts`). `round.test.ts` recomputes the fingerprint and fails if any input changed without opening a new round, and checks every round has a [changelog](./METHODOLOGY_CHANGELOG.md) entry and is advertised by the MCP server.
- The community feed has a round picker (all / a round / legacy = pre-round rows); the leaderboard is always per round (default: current).
- MCP: `get_methodology` lists `rounds`; `get_community_benchmarks` accepts `spec_version` (or `legacy`).

## 8. 4K-context prompt & prefill throughput (implemented in 5.3)

- `long_context_4k` (extended tier, **1 run**): QA over a deterministic ~16,000-char (~4K-token) operations manual (`buildLongContext4k()` in `src/lib/models.ts`, mirrored in the MCP server). MLPerf Client mandates 4K prompt lengths; this is our equivalent.
- **Prefill throughput** `prefill_tps_p50` per category = estimated prompt tokens (chars ÷ 4 — engines don't expose tokenizers uniformly, so it's reported as an estimate) ÷ TTFT seconds. Every run now records `promptChars`.
- Engines declare `maxContextTokens` (MediaPipe 2048 — its `maxTokens` load option; WebLLM 4096; ONNX 2048 conservative). A prompt whose estimated tokens + 256 output headroom exceed it is **skipped** (shown as "skipped — needs ~N tokens…") rather than counted as a failure. Extended prompts never affect the score, validity, or the round fingerprint (base-tier prompts only).
- Consequence today: the 4K prompt runs on WebLLM; MediaPipe/ONNX skip it until their context is raised (raising MediaPipe `maxTokens` to 4096 grows the KV cache — a product/memory decision, so left as-is).
- MediaPipe's `generateFull` watchdog now scales with prompt length (prefill emits no partial tokens), so long prompts don't time out unnecessarily.

## 9. Energy proxy (implemented in 5.4)

- MLPerf measures energy per stream with a power meter; browsers can't. The Battery Status API (Chrome/Android — absent on iOS Safari and Firefox) reports the battery level, so the suite samples it at **start and end** and reports **battery percentage points per 1,000 generated tokens** in `conditions.energy` (`src/lib/benchmark/energy.ts`, pure and tested).
- The figure is **valid only** when: the API is present, the device was **not charging** at either sample, the level didn't rise, tokens were generated, and the drop exceeds the API's ~1 % reporting resolution. Otherwise `valid:false` with the reason — never a fabricated or zero energy figure.
- It's a proxy, not a measurement: it includes screen and background load, and only decode tokens are normalised (prefill energy is folded in). Compare only within the same device class and round.

## 10. Reproducibility audit (implemented in 5.5)

- MLPerf audits submissions and demotes results that don't hold up. At community scale the audit is statistical and deterministic: within a round, once a device × model × engine × division has **≥ 5 certified runs**, any certified run scoring **> 2× that device's median** is treated as `valid` — still listed, never ranked.
- Implemented as the Postgres view `benchmark_audit` (`flagged`, `effective_tier`, `device_median`, `device_runs`) over the shared `benchmark_device_key()` function; the leaderboard view excludes flagged rows. Computed at read time, so it self-heals as runs accumulate — no job, no mutation of submitted rows.
- Only implausibly **high** scores are demoted: low scores are usually real (throttling, background load) and already explained by `conditions`; a high outlier can only be a measurement or reporting fault, and it is the one that would corrupt a ranking.
- Mirror + tests: `src/lib/benchmark/audit.ts`; a parity test asserts the SQL carries the same thresholds. The feed shows an "⚠ outlier" badge (best effort — a missing view never breaks the feed).
