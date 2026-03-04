import { useState, useEffect } from "react";
import { Loader2, Play, RotateCcw, Zap, Timer, Gauge } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/deviceInfo";
import { getBestQuickStartModel, BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, type BenchmarkCategory } from "@/lib/models";
import { useLlmInference } from "@/hooks/useLlmInference";
import type { BenchmarkResult } from "@/hooks/useLlmInference";

type Phase = "idle" | "downloading" | "benchmarking" | "done";

const RUNS_PER_PROMPT = 3;

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

const VERDICTS = [
  { min: 15, label: "Yes, you can AI!", emoji: "🚀", color: "text-primary", description: "Your device handles AI smoothly." },
  { min: 6, label: "Mostly, yes", emoji: "👍", color: "text-yellow-400", description: "Good enough for short tasks. Longer generation will feel sluggish." },
  { min: 1, label: "Barely…", emoji: "🐢", color: "text-orange-400", description: "It works, but expect noticeable latency." },
  { min: 0, label: "No, not yet", emoji: "⛔", color: "text-destructive", description: "Too slow for practical on-device AI right now." },
];

function getVerdict(avgTps: number) {
  return VERDICTS.find((v) => avgTps >= v.min) || VERDICTS[VERDICTS.length - 1];
}

interface BenchmarkSuiteProps {
  onComplete?: () => void;
  /** If provided, reuse an already-loaded model instead of downloading a new one */
  externalHook?: {
    status: string;
    statusMessage: string;
    downloadProgress: number;
    activeEngine: string | null;
    currentModelName: string;
    runBenchmarkPrompt: (prompt: string, category?: string) => Promise<BenchmarkResult | null>;
    runLongContextBenchmark: (prompt: string, context: string, category?: string) => Promise<BenchmarkResult | null>;
    runMultiTurnBenchmark: (turns: string[], category?: string) => Promise<BenchmarkResult | null>;
    runConcurrentBenchmark: (prompt: string, concurrency: number, category?: string) => Promise<BenchmarkResult | null>;
  };
}

const totalSteps = BENCHMARK_PROMPTS.length * RUNS_PER_PROMPT;

export function BenchmarkSuite({ onComplete, externalHook }: BenchmarkSuiteProps) {
  const internalHook = useLlmInference();

  // Use external (already-loaded) model if provided, otherwise internal
  const hasExternal = !!externalHook && externalHook.status === "ready";
  const {
    status, statusMessage, downloadProgress, activeEngine, capabilities,
    loadModel, runBenchmarkPrompt, runLongContextBenchmark, runMultiTurnBenchmark, runConcurrentBenchmark,
  } = hasExternal
    ? {
        status: externalHook!.status as any,
        statusMessage: externalHook!.statusMessage,
        downloadProgress: externalHook!.downloadProgress,
        activeEngine: externalHook!.activeEngine,
        capabilities: internalHook.capabilities,
        loadModel: internalHook.loadModel,
        runBenchmarkPrompt: externalHook!.runBenchmarkPrompt,
        runLongContextBenchmark: externalHook!.runLongContextBenchmark,
        runMultiTurnBenchmark: externalHook!.runMultiTurnBenchmark,
        runConcurrentBenchmark: externalHook!.runConcurrentBenchmark,
      }
    : internalHook;

  const model = getBestQuickStartModel(capabilities);
  const engine = model?.engine || activeEngine || "onnx";
  const externalModelName = hasExternal ? externalHook!.currentModelName : null;

  const [phase, setPhase] = useState<Phase>("idle");
  const [aggregated, setAggregated] = useState<AggregatedResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(-1);
  const [currentRun, setCurrentRun] = useState(0);

  const noEngine = capabilities.length > 0 && !capabilities.some((c) => c.available);

  // Model ready → start benchmarking
  useEffect(() => {
    if (status === "ready" && phase === "downloading") setPhase("benchmarking");
  }, [status, phase]);

  // Run prompts × RUNS_PER_PROMPT
  useEffect(() => {
    if (phase !== "benchmarking") return;
    let cancelled = false;

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

        const agg: AggregatedResult[] = [];
        for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
          const runs = allRuns.get(i) || [];
          if (runs.length > 0) {
            agg.push(buildAggregated(BENCHMARK_PROMPTS[i].prompt, BENCHMARK_PROMPTS[i].category, BENCHMARK_PROMPTS[i].label, runs));
          }
        }

        setAggregated(agg);
        setProgress(100);
        setCurrentPromptIdx(-1);
        setCurrentRun(0);
        setPhase("done");

        const avgTps = agg.length > 0 ? mean(agg.map(a => a.meanTps)) : 0;
        const avgTtft = agg.length > 0 ? mean(agg.map(a => a.meanTtft)) : 0;
        const v = getVerdict(avgTps);

        toast({ title: `${v.emoji} ${v.label} — ${avgTps.toFixed(1)} tok/s`, description: v.description });

        // Persist — flatten all runs for the results payload
        const allResults = agg.flatMap(a => a.runs);
        try {
          const device = await getDeviceInfo();
          const { error } = await supabase.from("benchmark_runs").insert({
            model_name: externalModelName || allResults[0]?.modelName || "Unknown",
            engine,
            avg_tps: avgTps,
            avg_ttft_ms: avgTtft,
            verdict: v.label,
            results: allResults.map((r) => ({
              prompt: r.prompt, category: r.category, tokensGenerated: r.tokensGenerated,
              timeMs: r.timeMs, tokensPerSecond: r.tokensPerSecond, ttftMs: r.ttftMs, tpotMs: r.tpotMs,
            })),
            browser: device.browser, os: device.os, cores: device.cores, ram_gb: device.ram,
            gpu: device.gpu, gpu_vendor: device.gpuVendor, screen_res: device.screenRes,
            pixel_ratio: device.pixelRatio, user_agent: device.userAgent,
            device_model: device.deviceModel, device_type: device.deviceType,
            country: device.country, city: device.city,
          });
          if (error) console.error("Failed to save benchmark:", error);
          else onComplete?.();
        } catch (saveErr) {
          console.error("Failed to persist benchmark:", saveErr);
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

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runBenchmarkPrompt, runLongContextBenchmark, runMultiTurnBenchmark, runConcurrentBenchmark, engine, onComplete]);

  const handleRun = () => {
    if (hasExternal) {
      // Model already loaded — skip download, go straight to benchmarking
      setAggregated([]);
      setProgress(0);
      setPhase("benchmarking");
      return;
    }
    if (!model || noEngine) return;
    setPhase("downloading");
    setAggregated([]);
    setProgress(0);
    loadModel(model.url, model.name, undefined, model.engine);
  };

  const handleRetry = () => {
    setPhase("idle");
    setAggregated([]);
    setProgress(0);
    setCurrentPromptIdx(-1);
    setCurrentRun(0);
  };

  const isActive = phase === "downloading" || phase === "benchmarking";
  const avgTps = aggregated.length > 0 ? mean(aggregated.map(a => a.meanTps)) : 0;
  const avgTtft = aggregated.length > 0 ? mean(aggregated.map(a => a.meanTtft)) : 0;
  const verdict = getVerdict(avgTps);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Zap className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-bold font-mono text-foreground">Can I AI? — Full Test Suite</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Runs {BENCHMARK_PROMPTS.length} prompts × {RUNS_PER_PROMPT} runs each ({totalSteps} total) to account for variance.
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
            <h3 className={`text-2xl font-bold font-mono ${verdict.color}`}>{verdict.label}</h3>
            <p className="text-sm text-muted-foreground max-w-sm">{verdict.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                <Zap className="h-3 w-3" /> tok/s
              </div>
              <p className="text-base font-bold font-mono text-foreground">{avgTps.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                <Timer className="h-3 w-3" /> TTFT
              </div>
              <p className="text-base font-bold font-mono text-foreground">{avgTtft.toFixed(0)}ms</p>
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

      {/* Progress bar when active */}
      {isActive && (
        <div className="border-b border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              {phase === "downloading"
                ? `Downloading ${model?.name} (${model?.size})…`
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
      {(model || hasExternal) && phase === "idle" && !noEngine && (
        <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>{hasExternal ? externalModelName : `${model!.name} · ${model!.size}`}</span>
          <span>{engine === "mediapipe" ? "MediaPipe · WebGPU" : engine === "webllm" ? "WebLLM · WebGPU" : "Transformers.js · WASM"}</span>
        </div>
      )}
    </div>
  );
}
