import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Cpu, ArrowLeft, Zap, Timer, Gauge, Monitor, HardDrive,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { BenchmarkSuite } from "@/components/BenchmarkSuite";

interface PerPromptResult {
  prompt: string;
  category: string;
  tokensGenerated: number;
  timeMs: number;
  tokensPerSecond: number;
  ttftMs: number;
  tpotMs: number;
}

interface BenchmarkRun {
  id: string;
  created_at: string;
  model_name: string;
  engine: string;
  avg_tps: number;
  avg_ttft_ms: number;
  verdict: string;
  results: PerPromptResult[];
  browser: string | null;
  os: string | null;
  cores: number | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: string | null;
  screen_res: string | null;
}

const VERDICT_STYLE: Record<string, { color: string; emoji: string }> = {
  "Great": { color: "text-primary", emoji: "🚀" },
  "Passable": { color: "text-yellow-400", emoji: "👍" },
  "Mostly, yes": { color: "text-yellow-400", emoji: "👍" },
  "Slow": { color: "text-orange-400", emoji: "🐢" },
  "Barely…": { color: "text-orange-400", emoji: "🐢" },
  "Not viable": { color: "text-destructive", emoji: "⛔" },
  "No, not yet": { color: "text-destructive", emoji: "⛔" },
  "Yes, you can AI!": { color: "text-primary", emoji: "🚀" },
};

const CATEGORY_COLORS: Record<string, string> = {
  ttft: "bg-primary/80",
  short: "bg-primary/60",
  medium: "bg-accent",
  long: "bg-yellow-500",
  reasoning: "bg-orange-400",
};

function MetricBar({ value, max, label, unit, color = "bg-primary" }: {
  value: number; max: number; label: string; unit: string; color?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-semibold">{value.toFixed(1)} {unit}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RunCard({ run }: { run: BenchmarkRun }) {
  const [expanded, setExpanded] = useState(false);
  const v = VERDICT_STYLE[run.verdict] || { color: "text-foreground", emoji: "❓" };
  const results = (run.results || []) as PerPromptResult[];
  const maxTps = results.length > 0 ? Math.max(...results.map(r => r.tokensPerSecond)) : 1;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-secondary/20 transition-colors"
      >
        <span className="text-2xl">{v.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold font-mono ${v.color}`}>{run.verdict}</span>
            <span className="text-xs font-mono text-muted-foreground truncate">{run.model_name}</span>
            <span className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              {run.engine}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1 text-xs font-mono">
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-foreground font-semibold">{run.avg_tps.toFixed(1)}</span>
              <span className="text-muted-foreground">tok/s</span>
            </span>
            <span className="flex items-center gap-1 text-xs font-mono">
              <Timer className="h-3 w-3 text-muted-foreground" />
              <span className="text-foreground font-semibold">{run.avg_ttft_ms.toFixed(0)}</span>
              <span className="text-muted-foreground">ms</span>
            </span>
            <span className="flex items-center gap-1 text-xs font-mono">
              <Gauge className="h-3 w-3 text-muted-foreground" />
              <span className="text-foreground font-semibold">{results.length}</span>
              <span className="text-muted-foreground">tests</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] font-mono text-muted-foreground/60">
            {new Date(run.created_at).toLocaleDateString()}
          </span>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {results.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">Per-test Results</h4>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <MetricBar
                    key={i}
                    value={r.tokensPerSecond}
                    max={maxTps * 1.2}
                    label={`${r.category?.toUpperCase() || "?"} · ${r.prompt.slice(0, 50)}${r.prompt.length > 50 ? "…" : ""}`}
                    unit="tok/s"
                    color={CATEGORY_COLORS[r.category] || "bg-primary"}
                  />
                ))}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">Detailed Metrics</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 pr-3">Test</th>
                      <th className="text-right py-1.5 px-2">Tokens</th>
                      <th className="text-right py-1.5 px-2">Time</th>
                      <th className="text-right py-1.5 px-2">tok/s</th>
                      <th className="text-right py-1.5 px-2">TTFT</th>
                      <th className="text-right py-1.5 pl-2">TPOT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 text-foreground">
                        <td className="py-1.5 pr-3">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${CATEGORY_COLORS[r.category] || "bg-primary"}`} />
                          {r.prompt.slice(0, 35)}{r.prompt.length > 35 ? "…" : ""}
                        </td>
                        <td className="text-right py-1.5 px-2 text-muted-foreground">{r.tokensGenerated}</td>
                        <td className="text-right py-1.5 px-2 text-muted-foreground">{(r.timeMs / 1000).toFixed(2)}s</td>
                        <td className="text-right py-1.5 px-2 font-semibold text-primary">{r.tokensPerSecond.toFixed(1)}</td>
                        <td className="text-right py-1.5 px-2 text-muted-foreground">{r.ttftMs.toFixed(0)}ms</td>
                        <td className="text-right py-1.5 pl-2 text-muted-foreground">{r.tpotMs.toFixed(1)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">Device</h4>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-muted-foreground">
              {run.browser && <span className="flex items-center gap-1"><Monitor className="h-3 w-3" /> {run.browser}</span>}
              {run.os && <span>{run.os}</span>}
              {run.cores && <span>{run.cores} cores</span>}
              {run.ram_gb && <span>{run.ram_gb} GB RAM</span>}
              {run.gpu && <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {run.gpu}</span>}
              {run.screen_res && <span>{run.screen_res}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Benchmarks() {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = () => {
    supabase
      .from("benchmark_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRuns((data as unknown as BenchmarkRun[]) || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-6 py-3">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Cpu className="h-5 w-5 text-primary" />
          <span className="font-mono text-sm font-semibold">
            <span className="text-primary">Can I</span>
            <span className="text-foreground"> AI?</span>
          </span>
        </Link>
        <span className="ml-2 text-xs text-muted-foreground font-mono">/ benchmarks</span>
        <Link
          to="/"
          className="ml-auto flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:border-muted-foreground/40"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-8">
          <div>
            <h1 className="text-2xl font-bold font-mono text-foreground">Benchmarks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              QuickBench stress tests across different LLM workload scenarios
            </p>
          </div>

          {/* Runnable Test Suite */}
          <BenchmarkSuite onComplete={fetchRuns} />

          {/* Historical Runs */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold font-mono text-foreground">Latest Runs</h2>
              {runs.length > 0 && (
                <span className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {runs.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground font-mono animate-pulse">Loading...</p>
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-lg border border-dashed border-border">
                <p className="text-sm text-muted-foreground font-mono">No benchmark runs yet.</p>
                <p className="text-xs text-muted-foreground font-mono">Run the test suite above to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
