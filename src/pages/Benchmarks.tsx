import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Cpu, ArrowLeft, Zap, Timer, Gauge, Monitor, HardDrive } from "lucide-react";
import { Link } from "react-router-dom";

interface BenchmarkRun {
  id: string;
  created_at: string;
  model_name: string;
  engine: string;
  avg_tps: number;
  avg_ttft_ms: number;
  verdict: string;
  results: any[];
  browser: string | null;
  os: string | null;
  cores: number | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: string | null;
  screen_res: string | null;
}

const VERDICT_STYLE: Record<string, string> = {
  Great: "text-primary",
  Passable: "text-yellow-400",
  Slow: "text-orange-400",
  "Not viable": "text-destructive",
};

export default function Benchmarks() {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("benchmark_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRuns((data as BenchmarkRun[]) || []);
        setLoading(false);
      });
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
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold font-mono text-foreground">Latest Benchmarks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Community benchmark results across different devices and browsers
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-muted-foreground font-mono animate-pulse">Loading...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-sm text-muted-foreground font-mono">No benchmark runs yet.</p>
              <Link
                to="/"
                className="text-xs text-primary hover:underline font-mono"
              >
                Run your first benchmark →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  {/* Top row: verdict + model + time */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg font-bold font-mono ${VERDICT_STYLE[run.verdict] || "text-foreground"}`}>
                        {run.verdict}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {run.model_name}
                      </span>
                      <span className="rounded-md border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {run.engine}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-xs font-mono">
                      <Zap className="h-3 w-3 text-primary" />
                      <span className="text-foreground font-semibold">{run.avg_tps.toFixed(1)}</span>
                      <span className="text-muted-foreground">tok/s</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono">
                      <Timer className="h-3 w-3 text-muted-foreground" />
                      <span className="text-foreground font-semibold">{run.avg_ttft_ms.toFixed(0)}</span>
                      <span className="text-muted-foreground">ms TTFT</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono">
                      <Gauge className="h-3 w-3 text-muted-foreground" />
                      <span className="text-foreground font-semibold">{run.results?.length || 0}</span>
                      <span className="text-muted-foreground">runs</span>
                    </div>
                  </div>

                  {/* Device info row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground/70">
                    {run.browser && (
                      <span className="flex items-center gap-1">
                        <Monitor className="h-2.5 w-2.5" /> {run.browser}
                      </span>
                    )}
                    {run.os && <span>{run.os}</span>}
                    {run.cores && <span>{run.cores} cores</span>}
                    {run.ram_gb && <span>{run.ram_gb} GB RAM</span>}
                    {run.gpu && (
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-2.5 w-2.5" /> {run.gpu}
                      </span>
                    )}
                    {run.screen_res && <span>{run.screen_res}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
