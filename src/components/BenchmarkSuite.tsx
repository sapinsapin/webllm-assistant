import { useState, useEffect } from "react";
import { Loader2, Play, RotateCcw, Zap, Timer, Gauge } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/deviceInfo";
import { getBestQuickStartModel, BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, type BenchmarkCategory } from "@/lib/models";
import { useLlmInference } from "@/hooks/useLlmInference";
import type { BenchmarkResult } from "@/hooks/useLlmInference";

type Phase = "idle" | "downloading" | "benchmarking" | "done";

const CATEGORY_COLORS: Record<string, string> = {
  ttft: "bg-primary/80",
  short: "bg-primary/60",
  medium: "bg-accent",
  long: "bg-yellow-500",
  reasoning: "bg-orange-400",
};

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
}

export function BenchmarkSuite({ onComplete }: BenchmarkSuiteProps) {
  const {
    status, statusMessage, downloadProgress, activeEngine, capabilities,
    loadModel, runBenchmarkPrompt,
  } = useLlmInference();

  const model = getBestQuickStartModel(capabilities);
  const engine = model?.engine || activeEngine || "onnx";

  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(-1);

  const noEngine = capabilities.length > 0 && !capabilities.some((c) => c.available);

  // Model ready → start benchmarking
  useEffect(() => {
    if (status === "ready" && phase === "downloading") setPhase("benchmarking");
  }, [status, phase]);

  // Run prompts
  useEffect(() => {
    if (phase !== "benchmarking") return;
    let cancelled = false;

    (async () => {
      const out: BenchmarkResult[] = [];
      for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
        if (cancelled) break;
        setCurrentPromptIdx(i);
        setProgress((i / BENCHMARK_PROMPTS.length) * 100);
        const r = await runBenchmarkPrompt(BENCHMARK_PROMPTS[i].prompt, BENCHMARK_PROMPTS[i].category);
        if (r) out.push(r);
      }
      if (cancelled) return;
      setResults(out);
      setProgress(100);
      setCurrentPromptIdx(-1);
      setPhase("done");

      const tps = out.length > 0 ? out.reduce((a, r) => a + r.tokensPerSecond, 0) / out.length : 0;
      const ttft = out.length > 0 ? out.reduce((a, r) => a + r.ttftMs, 0) / out.length : 0;
      const v = getVerdict(tps);

      toast({ title: `${v.emoji} ${v.label} — ${tps.toFixed(1)} tok/s`, description: v.description });

      // Persist
      getDeviceInfo().then((device) => {
        supabase.from("benchmark_runs").insert({
          model_name: out[0]?.modelName || "Unknown",
          engine,
          avg_tps: tps,
          avg_ttft_ms: ttft,
          verdict: v.label,
          results: out.map((r) => ({
            prompt: r.prompt, category: r.category, tokensGenerated: r.tokensGenerated,
            timeMs: r.timeMs, tokensPerSecond: r.tokensPerSecond, ttftMs: r.ttftMs, tpotMs: r.tpotMs,
          })),
          browser: device.browser, os: device.os, cores: device.cores, ram_gb: device.ram,
          gpu: device.gpu, gpu_vendor: device.gpuVendor, screen_res: device.screenRes,
          pixel_ratio: device.pixelRatio, user_agent: device.userAgent,
        }).then(({ error }) => {
          if (error) console.error("Failed to save benchmark:", error);
          else onComplete?.();
        });
      });
    })();

    return () => { cancelled = true; };
  }, [phase]);

  const handleRun = () => {
    if (!model || noEngine) return;
    setPhase("downloading");
    setResults([]);
    setProgress(0);
    loadModel(model.url, model.name, undefined, model.engine);
  };

  const handleRetry = () => {
    setPhase("idle");
    setResults([]);
    setProgress(0);
    setCurrentPromptIdx(-1);
  };

  const isActive = phase === "downloading" || phase === "benchmarking";
  const avgTps = results.length > 0 ? results.reduce((a, r) => a + r.tokensPerSecond, 0) / results.length : 0;
  const avgTtft = results.length > 0 ? results.reduce((a, r) => a + r.ttftMs, 0) / results.length : 0;
  const verdict = getVerdict(avgTps);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Zap className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-bold font-mono text-foreground">Can I AI? — Full Test Suite</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Runs {BENCHMARK_PROMPTS.length} prompts across {Object.keys(BENCHMARK_CATEGORIES).length} categories, then tells you if your device can handle on-device AI.
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
                <Gauge className="h-3 w-3" /> Runs
              </div>
              <p className="text-base font-bold font-mono text-foreground">{results.length}/{BENCHMARK_PROMPTS.length}</p>
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
              {phase === "downloading" ? `Downloading ${model?.name} (${model?.size})…` : `Running prompt ${currentPromptIdx + 1}/${BENCHMARK_PROMPTS.length}…`}
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
                    const result = phase === "done" ? results.find((r) => r.prompt === p.prompt) : undefined;
                    const isRunning = phase === "benchmarking" && currentPromptIdx === p.idx;
                    return (
                      <div
                        key={p.idx}
                        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-colors ${
                          isRunning ? "bg-primary/10 border border-primary/30" : result ? "bg-secondary/30" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isRunning && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                          {result && <span className="text-primary shrink-0">✓</span>}
                          {!isRunning && !result && <span className="text-muted-foreground/30 shrink-0">○</span>}
                          <span className="text-foreground font-medium">{p.label}</span>
                          <span className="text-muted-foreground truncate hidden sm:inline">— {p.description}</span>
                        </div>
                        {result && (
                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            <span className="text-primary font-semibold">{result.tokensPerSecond.toFixed(1)} tok/s</span>
                            <span className="text-muted-foreground">{result.ttftMs.toFixed(0)}ms</span>
                            <span className="text-muted-foreground">{result.tokensGenerated} tok</span>
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
          <span>{model.name} · {model.size}</span>
          <span>{engine === "mediapipe" ? "MediaPipe · WebGPU" : engine === "webllm" ? "WebLLM · WebGPU" : "Transformers.js · WASM"}</span>
        </div>
      )}
    </div>
  );
}