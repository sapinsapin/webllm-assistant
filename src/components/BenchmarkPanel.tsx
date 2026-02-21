import { useState } from "react";
import { Play, Loader2, BarChart3, Clock, Zap, FileText, Timer, Gauge } from "lucide-react";
import { BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, type BenchmarkCategory } from "@/lib/models";
import type { BenchmarkResult } from "@/hooks/useLlmInference";

interface BenchmarkPanelProps {
  modelName: string;
  onRunPrompt: (prompt: string, category?: string) => Promise<BenchmarkResult | null>;
}

export function BenchmarkPanel({ modelName, onRunPrompt }: BenchmarkPanelProps) {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [activeCategory, setActiveCategory] = useState<BenchmarkCategory | "all">("all");

  const runSingle = async (index: number) => {
    setRunningIndex(index);
    const bp = BENCHMARK_PROMPTS[index];
    const result = await onRunPrompt(bp.prompt, bp.category);
    if (result) {
      setResults((prev) => [...prev, result]);
    }
    setRunningIndex(null);
  };

  const runAll = async () => {
    setIsRunningAll(true);
    const prompts = activeCategory === "all"
      ? BENCHMARK_PROMPTS
      : BENCHMARK_PROMPTS.filter((bp) => bp.category === activeCategory);
    
    for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
      if (activeCategory !== "all" && BENCHMARK_PROMPTS[i].category !== activeCategory) continue;
      setRunningIndex(i);
      const bp = BENCHMARK_PROMPTS[i];
      const result = await onRunPrompt(bp.prompt, bp.category);
      if (result) {
        setResults((prev) => [...prev, result]);
      }
    }
    setRunningIndex(null);
    setIsRunningAll(false);
  };

  const filteredPrompts = activeCategory === "all"
    ? BENCHMARK_PROMPTS
    : BENCHMARK_PROMPTS.filter((bp) => bp.category === activeCategory);

  const filteredResults = activeCategory === "all"
    ? results
    : results.filter((r) => r.category === activeCategory);

  const avgTps = filteredResults.length > 0
    ? filteredResults.reduce((a, r) => a + r.tokensPerSecond, 0) / filteredResults.length
    : 0;
  const avgTtft = filteredResults.length > 0
    ? filteredResults.reduce((a, r) => a + r.ttftMs, 0) / filteredResults.length
    : 0;
  const avgTpot = filteredResults.filter((r) => r.tpotMs > 0).length > 0
    ? filteredResults.filter((r) => r.tpotMs > 0).reduce((a, r) => a + r.tpotMs, 0) / filteredResults.filter((r) => r.tpotMs > 0).length
    : 0;
  const avgTime = filteredResults.length > 0
    ? filteredResults.reduce((a, r) => a + r.timeMs, 0) / filteredResults.length
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
            Run {activeCategory === "all" ? "All" : BENCHMARK_CATEGORIES[activeCategory].label}
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button
            onClick={() => setActiveCategory("all")}
            className={`rounded-md px-2.5 py-1 text-xs font-mono transition-all ${activeCategory === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
          >
            All
          </button>
          {(Object.entries(BENCHMARK_CATEGORIES) as [BenchmarkCategory, { label: string }][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-mono transition-all ${activeCategory === key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
            >
              {val.label}
            </button>
          ))}
        </div>

        {filteredResults.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                <Timer className="h-3 w-3" /> Avg TTFT
              </div>
              <p className="text-base font-bold font-mono text-primary">{avgTtft.toFixed(0)}ms</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                <Gauge className="h-3 w-3" /> Avg TPOT
              </div>
              <p className="text-base font-bold font-mono text-primary">{avgTpot.toFixed(1)}ms</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                <Zap className="h-3 w-3" /> Avg tok/s
              </div>
              <p className="text-base font-bold font-mono text-foreground">{avgTps.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                <BarChart3 className="h-3 w-3" /> Runs
              </div>
              <p className="text-base font-bold font-mono text-foreground">{filteredResults.length}</p>
            </div>
          </div>
        )}
      </div>

      {/* Prompts & Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prompts</p>
          {filteredPrompts.map((bp, _) => {
            const globalIndex = BENCHMARK_PROMPTS.indexOf(bp);
            return (
              <div key={globalIndex} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground font-mono">{bp.label}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {BENCHMARK_CATEGORIES[bp.category].label}
                    </span>
                  </div>
                  <button
                    onClick={() => runSingle(globalIndex)}
                    disabled={runningIndex !== null}
                    className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-all hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {runningIndex === globalIndex ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono mb-1">{bp.description}</p>
                <p className="text-xs text-foreground/80 font-mono">{bp.prompt}</p>
              </div>
            );
          })}
        </div>

        {/* Results */}
        {filteredResults.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Results</p>
            {filteredResults.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-primary font-mono">{r.modelName}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {r.category}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3 text-primary" />TTFT: {r.ttftMs.toFixed(0)}ms</span>
                  <span className="flex items-center gap-1"><Gauge className="h-3 w-3 text-primary" />TPOT: {r.tpotMs.toFixed(1)}ms</span>
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{r.tokensPerSecond.toFixed(1)} tok/s</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(r.timeMs / 1000).toFixed(2)}s total</span>
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{r.tokensGenerated} tokens</span>
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
