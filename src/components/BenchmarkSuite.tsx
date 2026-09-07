import { useState, useEffect, useRef } from "react";
import { Loader2, Play, RotateCcw, Zap, Timer, Gauge, Pencil, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo, type DeviceInfo } from "@/lib/deviceInfo";
import { getBestQuickStartModel, BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, PRESET_MODELS, type BenchmarkCategory } from "@/lib/models";
import { useLlmInference } from "@/hooks/useLlmInference";
import type { BenchmarkResult } from "@/hooks/useLlmInference";
import {
  METHODOLOGY_VERSION,
  QUALITY_SMOKE_PROMPT_IDS,
  aggregateRun,
  divisionFor,
  getVerdict,
  qualityScoreFrom,
  resultTierFor,
  type ResultTier,
  type RunStats,
} from "@/lib/benchmark/spec";
import { captureRunConditions, type RunConditions } from "@/lib/benchmark/conditions";
import { EVAL_PROMPTS, computeScore, scoreResponse } from "@/lib/evals";

type Phase = "idle" | "downloading" | "benchmarking" | "done";

const RUNS_PER_PROMPT = 3;

// Quality smoke test (MLPerf-style accuracy gate): objective eval prompts run
// once each after the performance prompts; their keyword score gates the
// "certified" tier so a fast-but-broken model can't top the leaderboard.
const QUALITY_PROMPTS = QUALITY_SMOKE_PROMPT_IDS
  .map((id) => EVAL_PROMPTS.find((e) => e.id === id))
  .filter((p): p is NonNullable<typeof p> => p != null);

const VERDICT_COLORS: Record<string, string> = {
  "Yes, you can AI!": "text-primary",
  "Mostly, yes": "text-yellow-400",
  "Barely…": "text-orange-400",
  "No, not yet": "text-destructive",
};

const TIER_BADGE: Record<ResultTier, { label: string; cls: string }> = {
  certified: { label: "✓ Certified", cls: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" },
  valid: { label: "Valid · unranked", cls: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
  invalid: { label: "Invalid run", cls: "text-red-400 border-red-400/30 bg-red-400/10" },
};

const CATEGORY_COLORS: Record<string, string> = {
  ttft: "bg-primary/80",
  short: "bg-primary/60",
  medium: "bg-accent",
  long: "bg-yellow-500",
  reasoning: "bg-orange-400",
  long_context: "bg-purple-500",
  multi_turn: "bg-cyan-500",
  concurrent: "bg-rose-500",
};

interface AggregatedResult {
  prompt: string;
  category: string;
  label: string;
  runs: BenchmarkResult[];
  meanTps: number;
  stdTps: number;
  meanTtft: number;
  stdTtft: number;
  meanTokens: number;
}

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[], m: number) {
  return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
}

function buildAggregated(prompt: string, category: string, label: string, runs: BenchmarkResult[]): AggregatedResult {
  const meanTps = mean(runs.map(r => r.tokensPerSecond));
  const meanTtft = mean(runs.map(r => r.ttftMs));
  return {
    prompt, category, label, runs, meanTps,
    stdTps: std(runs.map(r => r.tokensPerSecond), meanTps),
    meanTtft,
    stdTtft: std(runs.map(r => r.ttftMs), meanTtft),
    meanTokens: mean(runs.map(r => r.tokensGenerated)),
  };
}

interface BenchmarkSuiteProps {
  onComplete?: () => void;
}

const perfSteps = BENCHMARK_PROMPTS.length * RUNS_PER_PROMPT;
const totalSteps = perfSteps + QUALITY_PROMPTS.length;

export function BenchmarkSuite({ onComplete }: BenchmarkSuiteProps) {
  const {
    status, statusMessage, downloadProgress, activeEngine, capabilities, currentModelName, lastBenchmarkError,
    loadModel, runBenchmarkPrompt, runLongContextBenchmark, runMultiTurnBenchmark, runConcurrentBenchmark,
  } = useLlmInference();

  // Mirror the latest benchmark error into a ref so the long-running async
  // benchmark loop below can read it without a stale closure.
  const lastErrRef = useRef<string | null>(lastBenchmarkError);
  useEffect(() => { lastErrRef.current = lastBenchmarkError; }, [lastBenchmarkError]);

  // Use currently loaded model if ready, otherwise pick best model for capabilities
  const loadedModel = status === "ready" && currentModelName
    ? PRESET_MODELS.find(m => m.name === currentModelName)
    : null;
  const model = loadedModel || getBestQuickStartModel(capabilities);
  const engine = model?.engine || activeEngine || "onnx";

  const [phase, setPhase] = useState<Phase>("idle");
  const [aggregated, setAggregated] = useState<AggregatedResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(-1);
  const [currentRun, setCurrentRun] = useState(0);
  const [pendingDevice, setPendingDevice] = useState<DeviceInfo | null>(null);
  const [overrideModel, setOverrideModel] = useState("");
  const [overrideGpu, setOverrideGpu] = useState("");
  const [overrideRam, setOverrideRam] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [resultTier, setResultTier] = useState<ResultTier | null>(null);
  const [qualityIdx, setQualityIdx] = useState(-1);
  const autoSubmittedRef = useRef(false);
  // Run conditions: MLPerf Mobile's "test conditions" principle — record
  // whether the tab was backgrounded (browsers throttle hidden tabs).
  const hiddenDuringRunRef = useRef(false);

  const noEngine = capabilities.length > 0 && !capabilities.some((c) => c.available);

  // Model ready → start benchmarking
  useEffect(() => {
    if (status === "ready" && phase === "downloading") setPhase("benchmarking");
  }, [status, phase]);

  // Run prompts × RUNS_PER_PROMPT
  useEffect(() => {
    if (phase !== "benchmarking") return;
    let cancelled = false;

    const suiteStart = performance.now();
    hiddenDuringRunRef.current = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenDuringRunRef.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    (async () => {
      try {
        const allRuns: Map<number, BenchmarkResult[]> = new Map();
        let step = 0;

        for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
          allRuns.set(i, []);
          for (let run = 0; run < RUNS_PER_PROMPT; run++) {
            if (cancelled) break;
            setCurrentPromptIdx(i);
            setCurrentRun(run + 1);
            setProgress((step / totalSteps) * 100);
            try {
              const bp = BENCHMARK_PROMPTS[i];
              let r: BenchmarkResult | null = null;
              if (bp.category === "long_context" && bp.context) {
                r = await runLongContextBenchmark(bp.prompt, bp.context, bp.category);
              } else if (bp.category === "multi_turn" && bp.turns) {
                r = await runMultiTurnBenchmark(bp.turns, bp.category);
              } else if (bp.category === "concurrent" && bp.concurrency) {
                r = await runConcurrentBenchmark(bp.prompt, bp.concurrency, bp.category);
              } else {
                r = await runBenchmarkPrompt(bp.prompt, bp.category);
              }
              if (r) allRuns.get(i)!.push(r);
            } catch (promptErr) {
              console.warn(`Benchmark prompt ${i} run ${run} failed:`, promptErr);
            }
            step++;
          }
          if (cancelled) break;
        }

        if (cancelled) return;

        // Quality smoke test — one generation per eval prompt, keyword-scored.
        setCurrentPromptIdx(-1);
        setCurrentRun(0);
        const qualityScores: number[] = [];
        for (let qi = 0; qi < QUALITY_PROMPTS.length; qi++) {
          if (cancelled) break;
          setQualityIdx(qi);
          setProgress((step / totalSteps) * 100);
          try {
            const ep = QUALITY_PROMPTS[qi];
            const r = await runBenchmarkPrompt(ep.prompt, "quality");
            if (r) qualityScores.push(computeScore(scoreResponse(ep, r.response)));
          } catch (qErr) {
            console.warn(`Quality prompt ${qi} failed:`, qErr);
          }
          step++;
        }
        setQualityIdx(-1);
        if (cancelled) return;

        const agg: AggregatedResult[] = [];
        let succeededRuns = 0;
        for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
          const runs = allRuns.get(i) || [];
          succeededRuns += runs.length;
          if (runs.length > 0) {
            agg.push(buildAggregated(BENCHMARK_PROMPTS[i].prompt, BENCHMARK_PROMPTS[i].category, BENCHMARK_PROMPTS[i].label, runs));
          }
        }

        // Every single run failed: this is an error, not a result. Do NOT
        // compute a bogus 0 tok/s verdict and do NOT submit it to the feed.
        if (agg.length === 0) {
          toast({
            title: "Benchmark failed",
            description: lastErrRef.current || "All benchmark prompts failed to run.",
            variant: "destructive",
          });
          setPhase("idle");
          setProgress(0);
          setCurrentPromptIdx(-1);
          setCurrentRun(0);
          return;
        }

        const failedRuns = perfSteps - succeededRuns;
        if (failedRuns > 0) {
          toast({
            title: `${failedRuns} of ${perfSteps} runs failed`,
            description: lastErrRef.current
              ? `Last error: ${lastErrRef.current}. The verdict is based on the ${succeededRuns} runs that completed.`
              : `The verdict is based on the ${succeededRuns} runs that completed.`,
            variant: "destructive",
          });
        }

        // Methodology 2026.09: percentiles, geomean score, validity, tier.
        const runStats = aggregateRun(agg.flatMap((a) => a.runs));
        const quality = qualityScoreFrom(qualityScores);
        const tier = resultTierFor(runStats, quality);
        setStats(runStats);
        setQualityScore(quality);
        setResultTier(tier);

        setAggregated(agg);
        setProgress(100);
        setCurrentPromptIdx(-1);
        setCurrentRun(0);
        setPhase("done");

        const avgTps = agg.length > 0 ? mean(agg.map(a => a.meanTps)) : 0;
        const avgTtft = agg.length > 0 ? mean(agg.map(a => a.meanTtft)) : 0;
        const v = getVerdict(runStats.overall_score);

        toast({ title: `${v.emoji} ${v.label} — ${runStats.overall_score.toFixed(1)} tok/s`, description: v.description });
        if (tier !== "certified") {
          toast({
            title: tier === "invalid" ? "Result not certifiable" : "Result valid but unranked",
            description:
              runStats.validity.reasons[0] ??
              (quality == null ? "Quality check didn't complete." : `Quality ${(quality * 100).toFixed(0)}% is below the ${(50).toFixed(0)}% gate.`),
          });
        }

        const conditions = await captureRunConditions({
          pageHiddenDuringRun: hiddenDuringRunRef.current,
          suiteDurationMs: performance.now() - suiteStart,
        });

        // Detect device, then auto-submit immediately so no result is lost.
        // Users can refine device/GPU/RAM afterwards via the "Edit details" button.
        try {
          const device = await getDeviceInfo();
          if (cancelled) return;
          setPendingDevice(device);
          setOverrideModel(device.deviceModel ?? "");
          setOverrideGpu(device.gpu ?? "");
          setOverrideRam(device.ram != null ? String(device.ram) : "");
          if (!autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            void autoSubmit(device, agg, avgTps, avgTtft, v.label, runStats, quality, tier, conditions);
          }
        } catch (detectErr) {
          console.error("Device detection failed:", detectErr);
        }
      } catch (err) {
        console.error("Benchmark suite error:", err);
        toast({ title: "Benchmark failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
        setPhase("idle");
        setProgress(0);
        setCurrentPromptIdx(-1);
        setCurrentRun(0);
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runBenchmarkPrompt, runLongContextBenchmark, runMultiTurnBenchmark, runConcurrentBenchmark, engine, onComplete]);

  const handleRun = () => {
    if (!model || noEngine) return;
    setAggregated([]);
    setProgress(0);
    if (status === "ready") {
      // Model already loaded — skip download, go straight to benchmarking
      setPhase("benchmarking");
    } else {
      setPhase("downloading");
      loadModel(model.url, model.name, undefined, model.engine);
    }
  };

  const handleRetry = () => {
    setPhase("idle");
    setAggregated([]);
    setProgress(0);
    setCurrentPromptIdx(-1);
    setCurrentRun(0);
    setPendingDevice(null);
    setSubmitted(false);
    setInsertedId(null);
    setEditing(false);
    setStats(null);
    setQualityScore(null);
    setResultTier(null);
    setQualityIdx(-1);
    autoSubmittedRef.current = false;
  };

  // Auto-submit the detected result so nothing is lost if the user navigates away.
  const autoSubmit = async (
    device: DeviceInfo,
    agg: AggregatedResult[],
    avgTpsVal: number,
    avgTtftVal: number,
    verdictLabel: string,
    runStats: RunStats,
    quality: number | null,
    tier: ResultTier,
    conditions: RunConditions,
  ) => {
    setSubmitting(true);
    const allResults = agg.flatMap(a => a.runs);
    try {
      const { data, error } = await supabase
        .from("benchmark_runs")
        .insert({
          model_name: allResults[0]?.modelName || "Unknown",
          engine,
          avg_tps: avgTpsVal,
          avg_ttft_ms: avgTtftVal,
          verdict: verdictLabel,
          // Methodology 2026.09 fields (see docs/BENCHMARK_METHODOLOGY.md)
          spec_version: METHODOLOGY_VERSION,
          division: divisionFor(engine, model?.id),
          model_id: model?.id ?? null,
          overall_score: runStats.overall_score,
          ttft_p90_ms: Number.isFinite(runStats.ttft_p90_ms) ? runStats.ttft_p90_ms : null,
          tpot_p50_ms: Number.isFinite(runStats.tpot_p50_ms) ? runStats.tpot_p50_ms : null,
          latency_class: runStats.latency_class,
          quality_score: quality,
          result_tier: tier,
          validity: runStats.validity,
          stats: { categories: runStats.categories, thermal_decay: runStats.thermal_decay },
          conditions: { ...conditions },
          results: allResults.map((r) => ({
            prompt: r.prompt, category: r.category, tokensGenerated: r.tokensGenerated,
            timeMs: r.timeMs, tokensPerSecond: r.tokensPerSecond, ttftMs: r.ttftMs, tpotMs: r.tpotMs,
          })),
          browser: device.browser, os: device.os, cores: device.cores,
          ram_gb: device.ram,
          gpu: device.gpu,
          gpu_vendor: device.gpuVendor,
          screen_res: device.screenRes,
          pixel_ratio: device.pixelRatio,
          user_agent: device.userAgent,
          device_model: device.deviceModel,
          device_type: device.deviceType,
          country: device.country, city: device.city,
          latitude: device.latitude, longitude: device.longitude,
        })
        .select("id")
        .single();
      if (error) {
        console.error("Failed to save benchmark:", error);
        toast({ title: "Couldn't save result", description: error.message, variant: "destructive" });
      } else {
        setInsertedId(data?.id ?? null);
        setSubmitted(true);
        toast({ title: "Submitted to community feed", description: "You can still edit your device info below." });
        onComplete?.();
      }
    } catch (saveErr) {
      console.error("Failed to persist benchmark:", saveErr);
      toast({ title: "Couldn't save result", description: saveErr instanceof Error ? saveErr.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Update the already-submitted row with the user's manual corrections.
  const handleUpdateDetails = async () => {
    if (!insertedId || submitting) return;
    setSubmitting(true);
    const ramParsed = overrideRam.trim() === "" ? null : Number(overrideRam);
    try {
      const { error } = await supabase
        .from("benchmark_runs")
        .update({
          device_model: overrideModel.trim() || null,
          gpu: overrideGpu.trim() || null,
          ram_gb: Number.isFinite(ramParsed as number) ? ramParsed : null,
        })
        .eq("id", insertedId);
      if (error) {
        console.error("Failed to update benchmark:", error);
        toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      } else {
        setEditing(false);
        toast({ title: "Updated", description: "Your hardware details have been refined." });
      }
    } catch (updateErr) {
      console.error("Failed to update benchmark:", updateErr);
      toast({ title: "Couldn't update", description: updateErr instanceof Error ? updateErr.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = phase === "downloading" || phase === "benchmarking";
  const score = stats?.overall_score ?? 0;
  const ttftP90 = stats && Number.isFinite(stats.ttft_p90_ms) ? stats.ttft_p90_ms : 0;
  const verdict = getVerdict(score);
  const verdictColor = VERDICT_COLORS[verdict.label] ?? "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Zap className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-bold font-mono text-foreground">Can I AI? — Full Test Suite</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {BENCHMARK_PROMPTS.length} prompts × {RUNS_PER_PROMPT} runs + {QUALITY_PROMPTS.length}-prompt quality check · methodology {METHODOLOGY_VERSION} (MLPerf-style percentiles &amp; accuracy gate)
          </p>
        </div>
        {phase === "idle" && (
          <button
            onClick={handleRun}
            disabled={!model || noEngine}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-mono font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" /> Run Test
          </button>
        )}
        {phase === "done" && (
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs font-mono text-secondary-foreground transition-all hover:bg-secondary"
          >
            <RotateCcw className="h-3 w-3" /> Run Again
          </button>
        )}
      </div>

      {/* Done: Verdict */}
      {phase === "done" && (
        <div className="border-b border-border p-6 flex flex-col items-center gap-4">
          <div className="text-center space-y-2">
            <p className="text-5xl">{verdict.emoji}</p>
            <h3 className={`text-2xl font-bold font-mono ${verdictColor}`}>{verdict.label}</h3>
            <p className="text-sm text-muted-foreground max-w-sm">{verdict.description}</p>
          </div>
          {stats && resultTier && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono">
              <span className={`rounded-md border px-2 py-0.5 ${TIER_BADGE[resultTier].cls}`}>{TIER_BADGE[resultTier].label}</span>
              <span className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-muted-foreground capitalize">
                {divisionFor(engine, model?.id)} division
              </span>
              <span className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-muted-foreground capitalize">
                {stats.latency_class}
              </span>
              {qualityScore != null && (
                <span className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-muted-foreground">
                  quality {(qualityScore * 100).toFixed(0)}%
                </span>
              )}
              {stats.thermal_decay < 0.7 && (
                <span className="rounded-md border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-orange-400">throttled</span>
              )}
            </div>
          )}
          {stats && !stats.validity.valid && stats.validity.reasons.length > 0 && (
            <p className="text-[10px] font-mono text-muted-foreground text-center max-w-sm">{stats.validity.reasons[0]}</p>
          )}
          <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                <Zap className="h-3 w-3" /> score tok/s
              </div>
              <p className="text-base font-bold font-mono text-foreground">{score.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                <Timer className="h-3 w-3" /> TTFT p90
              </div>
              <p className="text-base font-bold font-mono text-foreground">{ttftP90.toFixed(0)}ms</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                <Gauge className="h-3 w-3" /> Prompts
              </div>
              <p className="text-base font-bold font-mono text-foreground">{aggregated.length}/{BENCHMARK_PROMPTS.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Review & Submit */}
      {phase === "done" && pendingDevice && (
        <div className="border-b border-border px-4 py-4 space-y-3 bg-secondary/10">
          <div>
            <h4 className="text-xs font-bold font-mono text-foreground">
              {submitted ? "Result published — refine your hardware details (optional)" : "Publishing your result…"}
            </h4>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              Browsers hide most hardware info, so auto-detection may be off (e.g. RAM is capped at 8 GB).
              Click <span className="font-semibold">Edit details</span> to correct the device, GPU, or RAM.
            </p>
          </div>

          {/* Read-only summary */}
          {!editing && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Device</div>
                <div className="text-foreground truncate">{overrideModel || "—"}</div>
              </div>
              <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">GPU / Chipset</div>
                <div className="text-foreground truncate">{overrideGpu || "—"}</div>
              </div>
              <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">RAM (GB)</div>
                <div className="text-foreground">{overrideRam || "—"}</div>
              </div>
            </div>
          )}

          {/* Edit form */}
          {editing && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Device</span>
              <input
                type="text"
                value={overrideModel}
                onChange={(e) => setOverrideModel(e.target.value)}
                placeholder="e.g. MacBook Pro M4 Max"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">GPU / Chipset</span>
              <input
                type="text"
                value={overrideGpu}
                onChange={(e) => setOverrideGpu(e.target.value)}
                placeholder="e.g. Apple M4 Max"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">RAM (GB)</span>
              <input
                type="number"
                min={1}
                step={1}
                value={overrideRam}
                onChange={(e) => setOverrideRam(e.target.value)}
                placeholder="e.g. 64"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
            </label>
          </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {!submitted && (
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving result…
              </span>
            )}
            {submitted && !editing && (
              <>
                <span className="text-[11px] font-mono text-primary">✓ Saved to community feed</span>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-mono text-secondary-foreground transition-all hover:bg-secondary"
                >
                  <Pencil className="h-3 w-3" /> Edit details
                </button>
              </>
            )}
            {submitted && editing && (
              <>
                <button
                  onClick={() => setEditing(false)}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-mono text-secondary-foreground transition-all hover:bg-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateDetails}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-mono font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {submitting ? "Updating…" : "Save changes"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Progress bar when active */}
      {isActive && (
        <div className="border-b border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              {phase === "downloading"
                ? `Downloading ${model?.name} (${model?.size})…`
                : qualityIdx >= 0
                  ? `Quality check ${qualityIdx + 1}/${QUALITY_PROMPTS.length}`
                  : `Prompt ${currentPromptIdx + 1}/${BENCHMARK_PROMPTS.length} · run ${currentRun}/${RUNS_PER_PROMPT}`}
            </span>
            <span className="text-foreground font-semibold">{Math.round(phase === "downloading" ? downloadProgress : progress)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.max(phase === "downloading" ? downloadProgress : progress, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* No engine warning */}
      {noEngine && phase === "idle" && (
        <div className="px-4 py-6 text-center">
          <p className="text-3xl mb-2">⛔</p>
          <p className="text-sm font-mono text-destructive font-semibold">Not supported</p>
          <p className="text-xs text-muted-foreground mt-1">Your browser doesn't support WebGPU or WASM for AI inference.</p>
        </div>
      )}

      {/* Prompt list */}
      <div className="divide-y divide-border">
        {(Object.entries(BENCHMARK_CATEGORIES) as [BenchmarkCategory, { label: string; description: string }][]).map(
          ([cat, meta]) => {
            const prompts = BENCHMARK_PROMPTS.map((p, idx) => ({ ...p, idx })).filter((p) => p.category === cat);
            return (
              <div key={cat} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${CATEGORY_COLORS[cat]}`} />
                  <span className="text-xs font-bold font-mono text-foreground">{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground">— {meta.description}</span>
                </div>
                <div className="space-y-1">
                  {prompts.map((p) => {
                    const agg = phase === "done" ? aggregated.find((a) => a.prompt === p.prompt) : undefined;
                    const isRunning = phase === "benchmarking" && currentPromptIdx === p.idx;
                    return (
                      <div
                        key={p.idx}
                        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-colors ${
                          isRunning ? "bg-primary/10 border border-primary/30" : agg ? "bg-secondary/30" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isRunning && (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                              <span className="text-muted-foreground shrink-0">run {currentRun}/{RUNS_PER_PROMPT}</span>
                            </>
                          )}
                          {agg && <span className="text-primary shrink-0">✓</span>}
                          {!isRunning && !agg && <span className="text-muted-foreground/30 shrink-0">○</span>}
                          <span className="text-foreground font-medium">{p.label}</span>
                          <span className="text-muted-foreground truncate hidden sm:inline">— {p.description}</span>
                        </div>
                        {agg && (
                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            <span className="text-primary font-semibold">{agg.meanTps.toFixed(1)} <span className="text-muted-foreground font-normal">±{agg.stdTps.toFixed(1)}</span> tok/s</span>
                            <span className="text-muted-foreground">{agg.meanTtft.toFixed(0)}±{agg.stdTtft.toFixed(0)}ms</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* Model info footer */}
      {model && phase === "idle" && !noEngine && (
        <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>
            {model.name} · {model.size}
            {loadedModel && <span className="ml-1 text-primary">(loaded)</span>}
          </span>
          <span>{engine === "mediapipe" ? "MediaPipe · WebGPU" : engine === "webllm" ? "WebLLM · WebGPU" : "Transformers.js · WASM"}</span>
        </div>
      )}
    </div>
  );
}
