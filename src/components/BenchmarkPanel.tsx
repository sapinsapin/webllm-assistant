import { useState } from "react";
import { Play, Loader2, BarChart3, Clock, Zap, FileText } from "lucide-react";
import { BENCHMARK_PROMPTS } from "@/lib/models";
import type { BenchmarkResult } from "@/hooks/useLlmInference";

interface BenchmarkPanelProps {
  modelName: string;
  onRunPrompt: (prompt: string) => Promise<BenchmarkResult | null>;
}

export function BenchmarkPanel({ modelName, onRunPrompt }: BenchmarkPanelProps) {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);

  const runSingle = async (index: number) => {
    setRunningIndex(index);
    const result = await onRunPrompt(BENCHMARK_PROMPTS[index].prompt);
    if (result) {
      setResults((prev) => [...prev, result]);
    }
    setRunningIndex(null);
  };

  const runAll = async () => {
    setIsRunningAll(true);
    for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
      setRunningIndex(i);
      const result = await onRunPrompt(BENCHMARK_PROMPTS[i].prompt);
      if (result) {
        setResults((prev) => [...prev, result]);
      }
    }
    setRunningIndex(null);
    setIsRunningAll(false);
  };

  const avgTps = results.length > 0
    ? results.reduce((a, r) => a + r.tokensPerSecond, 0) / results.length
    : 0;
  const avgTime = results.length > 0
    ? results.reduce((a, r) => a + r.timeMs, 0) / results.length
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header stats */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground font-mono">Benchmark</h2>
            <p className="text-xs text-muted-foreground font-mono">{modelName}</p>
          </div>
          <button
            onClick={runAll}
            disabled={isRunningAll || runningIndex !== null}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
          >
            {isRunningAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run All
          </button>
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <BarChart3 className="h-3 w-3" /> Runs
              </div>
              <p className="text-lg font-bold font-mono text-foreground">{results.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Zap className="h-3 w-3" /> Avg tok/s
              </div>
              <p className="text-lg font-bold font-mono text-primary">{avgTps.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Clock className="h-3 w-3" /> Avg time
              </div>
              <p className="text-lg font-bold font-mono text-foreground">{(avgTime / 1000).toFixed(1)}s</p>
            </div>
          </div>
        )}
      </div>

      {/* Prompts */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prompts</p>
          {BENCHMARK_PROMPTS.map((bp, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground font-mono">{bp.label}</span>
                <button
                  onClick={() => runSingle(i)}
                  disabled={runningIndex !== null}
                  className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-all hover:bg-secondary/80 disabled:opacity-50"
                >
                  {runningIndex === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run
                </button>
              </div>
              <p className="text-xs text-foreground/80 font-mono">{bp.prompt}</p>
            </div>
          ))}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Results</p>
            {results.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary font-mono">{r.modelName}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{r.tokensPerSecond.toFixed(1)} tok/s</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(r.timeMs / 1000).toFixed(2)}s</span>
                    <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{r.tokensGenerated} tokens</span>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono truncate">Q: {r.prompt}</p>
                <p className="text-xs text-foreground/70 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto scrollbar-thin">
                  {r.response}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
