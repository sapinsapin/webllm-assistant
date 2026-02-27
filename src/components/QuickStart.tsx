import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Settings2, Loader2, Zap, Timer, Gauge, Download, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/deviceInfo";
import { runDiagnostics, type DiagnosticReport, type DiagnosticCheck } from "@/lib/diagnostics";
import type { ModelStatus, BenchmarkResult } from "@/hooks/useLlmInference";
import type { EngineType, EngineCapability } from "@/lib/inference/types";
import { getBestQuickStartModel } from "@/lib/models";
import { BENCHMARK_PROMPTS } from "@/lib/models";

type Phase = "idle" | "downloading" | "ready_to_bench" | "benchmarking" | "done";

interface Verdict {
  label: string;
  emoji: string;
  color: string;
  description: string;
}

function getVerdict(avgTps: number): Verdict {
  if (avgTps >= 15) return {
    label: "Great",
    emoji: "🚀",
    color: "text-primary",
    description: "Your device handles AI smoothly — real-time conversation, creative writing, and complex reasoning are all within reach.",
  };
  if (avgTps >= 6) return {
    label: "Passable",
    emoji: "👍",
    color: "text-yellow-400",
    description: "Good enough for short conversations and quick tasks. Longer generation will feel a bit sluggish.",
  };
  if (avgTps >= 1) return {
    label: "Slow",
    emoji: "🐢",
    color: "text-orange-400",
    description: "It works, but responses will take a while. Expect noticeable latency on anything beyond a sentence or two.",
  };
  return {
    label: "Not viable",
    emoji: "⛔",
    color: "text-destructive",
    description: "Too slow for practical use. Your device or browser doesn't have the horsepower for on-device AI right now.",
  };
}

interface QuickStartProps {
  status: ModelStatus;
  statusMessage: string;
  downloadProgress: number;
  activeEngine: EngineType | null;
  capabilities: EngineCapability[];
  onLoadModel: (url: string, name?: string, hfToken?: string, engine?: EngineType) => void;
  onAdvancedMode: () => void;
  onRunBenchmark: (prompt: string, category?: string) => Promise<BenchmarkResult | null>;
  onRunLongContext?: (prompt: string, context: string, category?: string) => Promise<BenchmarkResult | null>;
  onRunMultiTurn?: (turns: string[], category?: string) => Promise<BenchmarkResult | null>;
  onRunConcurrent?: (prompt: string, concurrency: number, category?: string) => Promise<BenchmarkResult | null>;
}

const ENGINE_LABEL: Record<EngineType, string> = {
  mediapipe: "MediaPipe · WebGPU",
  webllm: "WebLLM · WebGPU",
  onnx: "ONNX · WASM",
};

// Run all benchmark prompts for a comprehensive stress test
const QUICK_PROMPTS = BENCHMARK_PROMPTS;

export function QuickStart({
  status,
  statusMessage,
  downloadProgress,
  activeEngine,
  capabilities,
  onLoadModel,
  onAdvancedMode,
  onRunBenchmark,
  onRunLongContext,
  onRunMultiTurn,
  onRunConcurrent,
}: QuickStartProps) {
  const navigate = useNavigate();
  const model = getBestQuickStartModel(capabilities);
  const engine = model?.engine || activeEngine || "onnx";

  const [phase, setPhase] = useState<Phase>("idle");
  const [benchResults, setBenchResults] = useState<BenchmarkResult[]>([]);
  const [benchProgress, setBenchProgress] = useState(0);

  const noEngineAvailable = capabilities.length > 0 && !capabilities.some(c => c.available);

  // When model becomes ready after download, pause at ready_to_bench
  useEffect(() => {
    if (status === "ready" && phase === "downloading") {
      setPhase("ready_to_bench");
    }
  }, [status, phase]);

  // Run benchmark when phase switches to benchmarking
  useEffect(() => {
    if (phase !== "benchmarking") return;
    let cancelled = false;

    (async () => {
      try {
        const results: BenchmarkResult[] = [];
        for (let i = 0; i < QUICK_PROMPTS.length; i++) {
          if (cancelled) break;
          setBenchProgress(((i) / QUICK_PROMPTS.length) * 100);
          try {
            const bp = QUICK_PROMPTS[i];
            let r: BenchmarkResult | null = null;
            if (bp.category === "long_context" && bp.context && onRunLongContext) {
              r = await onRunLongContext(bp.prompt, bp.context, bp.category);
            } else if (bp.category === "multi_turn" && bp.turns && onRunMultiTurn) {
              r = await onRunMultiTurn(bp.turns, bp.category);
            } else if (bp.category === "concurrent" && bp.concurrency && onRunConcurrent) {
              r = await onRunConcurrent(bp.prompt, bp.concurrency, bp.category);
            } else {
              r = await onRunBenchmark(bp.prompt, bp.category);
            }
            if (r) results.push(r);
          } catch (promptErr) {
            console.warn(`QuickStart prompt ${i} failed:`, promptErr);
          }
        }
        if (cancelled) return;

        setBenchResults(results);
        setBenchProgress(100);
        setPhase("done");

        const tps = results.length > 0
          ? results.reduce((a, r) => a + r.tokensPerSecond, 0) / results.length
          : 0;
        const ttft = results.length > 0
          ? results.reduce((a, r) => a + r.ttftMs, 0) / results.length
          : 0;
        const v = getVerdict(tps);

        toast({
          title: `${v.emoji} ${v.label} — ${tps.toFixed(1)} tok/s`,
          description: v.description,
          action: (
            <ToastAction altText="View all benchmarks" onClick={() => navigate("/benchmarks")}>
              View All
            </ToastAction>
          ),
        });

        try {
          const device = await getDeviceInfo();
          await supabase.from("benchmark_runs").insert({
            model_name: results[0]?.modelName || "Unknown",
            engine: engine,
            avg_tps: tps,
            avg_ttft_ms: ttft,
            verdict: v.label,
            results: results.map(r => ({
              prompt: r.prompt, category: r.category, tokensGenerated: r.tokensGenerated,
              timeMs: r.timeMs, tokensPerSecond: r.tokensPerSecond, ttftMs: r.ttftMs, tpotMs: r.tpotMs,
            })),
            browser: device.browser, os: device.os, cores: device.cores, ram_gb: device.ram,
            gpu: device.gpu, gpu_vendor: device.gpuVendor, screen_res: device.screenRes,
            pixel_ratio: device.pixelRatio, user_agent: device.userAgent,
          });
        } catch (saveErr) {
          console.error("Failed to save benchmark:", saveErr);
        }
      } catch (err) {
        console.error("QuickStart benchmark error:", err);
        if (!cancelled) {
          toast({ title: "Benchmark failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
          setPhase("idle");
          setBenchProgress(0);
          setBenchResults([]);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [phase, onRunBenchmark]);

  const handleGo = () => {
    if (!model || noEngineAvailable) return;
    setPhase("downloading");
    onLoadModel(model.url, model.name, undefined, model.engine);
  };

  const handleStartBenchmark = () => {
    setPhase("benchmarking");
  };

  const handleRetry = () => {
    setPhase("ready_to_bench");
    setBenchResults([]);
    setBenchProgress(0);
  };

  const isActive = phase === "downloading" || phase === "benchmarking";

  // Compute verdict
  const avgTps = benchResults.length > 0
    ? benchResults.reduce((a, r) => a + r.tokensPerSecond, 0) / benchResults.length
    : 0;
  const avgTtft = benchResults.length > 0
    ? benchResults.reduce((a, r) => a + r.ttftMs, 0) / benchResults.length
    : 0;
  const verdict = getVerdict(avgTps);

  // --- DONE SCREEN ---
  if (phase === "done") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 select-none">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight font-mono">
            <span className="text-primary glow-text">Can I</span>
            <span className="text-foreground"> AI?</span>
          </h1>
        </div>

        {/* Verdict */}
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-5xl">{verdict.emoji}</p>
          <h2 className={`text-3xl font-bold font-mono ${verdict.color}`}>{verdict.label}</h2>
          <p className="text-sm text-muted-foreground">{verdict.description}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-1">
              <Zap className="h-3 w-3" /> tok/s
            </div>
            <p className="text-lg font-bold font-mono text-foreground">{avgTps.toFixed(1)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-1">
              <Timer className="h-3 w-3" /> TTFT
            </div>
            <p className="text-lg font-bold font-mono text-foreground">{avgTtft.toFixed(0)}ms</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-1">
              <Gauge className="h-3 w-3" /> Runs
            </div>
            <p className="text-lg font-bold font-mono text-foreground">{benchResults.length}</p>
          </div>
        </div>

        {/* Per-result breakdown */}
        <div className="w-full max-w-sm space-y-1.5">
          {benchResults.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs font-mono">
              <span className="text-muted-foreground truncate max-w-[140px]">{r.prompt.slice(0, 40)}…</span>
              <span className="text-foreground font-semibold">{r.tokensPerSecond.toFixed(1)} tok/s</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onAdvancedMode}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-xs font-mono text-primary-foreground font-semibold transition-all hover:bg-primary/90"
          >
            💬 Chat with the AI
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-xs font-mono text-secondary-foreground transition-all hover:bg-secondary"
            >
              Run Again
            </button>
            <button
              onClick={() => navigate("/benchmarks")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
            >
              📊 All Benchmarks
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- READY TO BENCHMARK SCREEN ---
  if (phase === "ready_to_bench") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 select-none">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight font-mono">
            <span className="text-primary glow-text">Can I</span>
            <span className="text-foreground"> AI?</span>
          </h1>
        </div>

        <div className="text-center space-y-3 max-w-xs">
          <p className="text-4xl">✅</p>
          <h2 className="text-xl font-bold font-mono text-primary">Model Ready</h2>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{model?.name}</span> is loaded and ready.
          </p>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            The benchmark will send <span className="text-foreground font-medium">{QUICK_PROMPTS.length} prompts</span> to the model — including reasoning, creative, long context, multi-turn, and concurrent tests — to measure your device's AI performance.
          </p>
        </div>

        <button
          onClick={handleStartBenchmark}
          className="group relative flex items-center justify-center"
        >
          <div className="absolute h-44 w-44 rounded-full border-2 border-border group-hover:border-primary/50 transition-all duration-500" />
          <div className="relative flex h-36 w-36 flex-col items-center justify-center rounded-full border border-border bg-card group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:glow-primary cursor-pointer transition-all duration-300">
            <Zap className="h-6 w-6 text-foreground group-hover:text-primary transition-colors mb-1" />
            <span className="text-lg font-bold font-mono text-foreground group-hover:text-primary transition-colors">
              BENCH
            </span>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={onAdvancedMode}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
          >
            💬 Skip to Chat
          </button>
          <button
            onClick={onAdvancedMode}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
          >
            <Settings2 className="h-3 w-3" />
            Advanced
          </button>
        </div>
      </div>
    );
  }

  // --- IDLE / DOWNLOADING / BENCHMARKING SCREEN ---
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 select-none">
      {/* Logo */}
      <div className="text-center space-y-3">
        <h1 className="text-4xl font-bold tracking-tight font-mono">
          <span className="text-primary glow-text">Can I</span>
          <span className="text-foreground"> AI?</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Test if your browser can run AI models locally
        </p>
      </div>

      {/* No engine available state */}
      {noEngineAvailable && phase === "idle" && (
        <div className="text-center space-y-3 max-w-xs">
          <p className="text-5xl">⛔</p>
          <h2 className="text-xl font-bold font-mono text-destructive">Not viable</h2>
          <p className="text-sm text-muted-foreground">
            Your browser doesn't support WebGPU or WASM for AI inference. Try Chrome, Edge, or a desktop browser.
          </p>
        </div>
      )}

      {/* GO button */}
      {!noEngineAvailable && (
        <button
          onClick={handleGo}
          disabled={isActive || !model}
          className="group relative flex items-center justify-center"
        >
          {/* Outer ring */}
          <div
            className={`absolute h-44 w-44 rounded-full border-2 transition-all duration-500 ${
              isActive
                ? "border-primary/30 animate-spin"
                : "border-border group-hover:border-primary/50"
            }`}
            style={
              isActive
                ? {
                    borderTopColor: "hsl(var(--primary))",
                    animationDuration: "1.5s",
                  }
                : undefined
            }
          />

          {/* Progress ring */}
          {isActive && downloadProgress > 0 && phase === "downloading" && (
            <svg className="absolute h-44 w-44 -rotate-90" viewBox="0 0 176 176">
              <circle
                cx="88"
                cy="88"
                r="86"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * 86}`}
                strokeDashoffset={`${2 * Math.PI * 86 * (1 - downloadProgress / 100)}`}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          )}

          {/* Benchmark progress ring */}
          {phase === "benchmarking" && (
            <svg className="absolute h-44 w-44 -rotate-90" viewBox="0 0 176 176">
              <circle
                cx="88"
                cy="88"
                r="86"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * 86}`}
                strokeDashoffset={`${2 * Math.PI * 86 * (1 - benchProgress / 100)}`}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          )}

          {/* Inner circle */}
          <div
            className={`relative flex h-36 w-36 flex-col items-center justify-center rounded-full border transition-all duration-300 ${
              isActive
                ? "border-primary/20 bg-primary/5"
                : status === "error"
                ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-card group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:glow-primary cursor-pointer"
            }`}
          >
            {phase === "benchmarking" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary mb-1" />
                <span className="text-xs font-bold font-mono text-primary">Testing</span>
                <span className="mt-0.5 text-[10px] font-mono text-muted-foreground">
                  {Math.round(benchProgress)}%
                </span>
              </>
            ) : isActive ? (
              <>
                <span className="text-2xl font-bold font-mono text-primary">
                  {downloadProgress > 0 ? `${Math.round(downloadProgress)}%` : "..."}
                </span>
                <span className="mt-1 text-[10px] font-mono text-muted-foreground max-w-[100px] text-center truncate">
                  {statusMessage}
                </span>
              </>
            ) : status === "error" ? (
              <>
                <AlertCircle className="h-6 w-6 text-destructive mb-1" />
                <span className="text-xs font-mono text-destructive">Error</span>
              </>
            ) : (
              <>
                <Download className="h-5 w-5 text-foreground group-hover:text-primary transition-colors mb-1" />
                <span className="text-2xl font-bold font-mono text-foreground group-hover:text-primary transition-colors">
                  GO
                </span>
              </>
            )}
          </div>
        </button>
      )}

      {/* Info below button */}
      <div className="text-center space-y-2 max-w-xs">
        {model && phase === "idle" && !noEngineAvailable && (
          <>
            <p className="text-xs font-mono text-muted-foreground">
              {model.name} · {model.size}
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/60">
              {ENGINE_LABEL[engine]}
            </p>
            <div className="space-y-1.5 mt-2">
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                <span className="text-foreground font-medium">Step 1:</span> Downloads a <span className="text-foreground font-medium">{model.size}</span> AI model to your browser.
              </p>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                <span className="text-foreground font-medium">Step 2:</span> Runs a quick benchmark by sending {QUICK_PROMPTS.length} test prompts to measure performance.
              </p>
            </div>
          </>
        )}
        {phase === "downloading" && (
          <div className="space-y-2 w-full max-w-xs">
            <p className="text-xs font-mono text-muted-foreground animate-pulse">
              Downloading {model?.name} ({model?.size})...
            </p>
            <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(downloadProgress, 2)}%` }}
              />
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/60">{statusMessage}</p>
          </div>
        )}
        {phase === "benchmarking" && (
          <div className="space-y-2 w-full max-w-xs">
            <p className="text-xs font-mono text-muted-foreground animate-pulse">
              Running benchmark — {QUICK_PROMPTS.length} quick tests...
            </p>
            <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(benchProgress, 5)}%` }}
              />
            </div>
          </div>
        )}
        {status === "error" && phase === "idle" && (
          <p className="text-xs font-mono text-destructive/80 max-w-xs mx-auto">
            {statusMessage}
          </p>
        )}
      </div>

      {/* Advanced mode link */}
      {!isActive && (
        <button
          onClick={onAdvancedMode}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
        >
          <Settings2 className="h-3 w-3" />
          Advanced
        </button>
      )}
    </div>
  );
}
