import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Cpu, Smartphone, Monitor, Tablet, Zap, Clock, MapPin, HardDrive, MemoryStick } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BenchRun {
  id: string;
  created_at: string;
  device_model: string | null;
  device_type: string | null;
  avg_tps: number;
  avg_ttft_ms: number;
  verdict: string;
  model_name: string;
  engine: string;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  cores: number | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: string | null;
  screen_res: string | null;
}

const VERDICT_STYLE: Record<string, string> = {
  Great: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  Passable: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  Slow: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  "Not Viable": "text-red-400 bg-red-400/10 border-red-400/20",
  "Did not finish": "text-muted-foreground bg-secondary/30 border-border",
  Crashed: "text-red-400 bg-red-400/10 border-red-400/20",
  "Yes, you can AI!": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

const VERDICT_EMOJI: Record<string, string> = {
  Great: "🚀",
  Passable: "👍",
  Slow: "🐢",
  "Not Viable": "❌",
  "Did not finish": "⏳",
  Crashed: "💥",
  "Yes, you can AI!": "🚀",
};

function DeviceIcon({ type }: { type: string | null }) {
  const cls = "h-4 w-4 text-muted-foreground";
  if (type === "mobile") return <Smartphone className={cls} />;
  if (type === "tablet") return <Tablet className={cls} />;
  return <Monitor className={cls} />;
}

function deviceLabel(run: BenchRun): string {
  if (run.device_model) return run.device_model;
  const parts: string[] = [];
  if (run.os) parts.push(run.os);
  if (run.browser) parts.push(run.browser);
  return parts.join(" · ") || "Unknown device";
}

const PAGE_SIZE = 10;

export function CommunityBenchmarks() {
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    supabase
      .from("benchmark_runs")
      .select("id,created_at,device_model,device_type,avg_tps,avg_ttft_ms,verdict,model_name,engine,browser,os,country,city,cores,ram_gb,gpu", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setRuns((data as BenchRun[]) ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [page]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-secondary/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-8">
        No benchmark runs yet. Be the first!
      </p>
    );
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {runs.map((run) => {
          const verdictClass = VERDICT_STYLE[run.verdict] ?? "text-muted-foreground bg-secondary/30 border-border";
          const emoji = VERDICT_EMOJI[run.verdict] ?? "⚡";
          return (
            <div
              key={run.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 transition-colors hover:bg-card/80"
            >
              <DeviceIcon type={run.device_type} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium text-foreground truncate">
                    {deviceLabel(run)}
                  </span>
                  {run.gpu && (
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
                      {run.gpu}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  {(run.city || run.country) && (
                    <span className="flex items-center gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />
                      {[run.city, run.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {run.avg_tps.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-1">tok/s</span>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${verdictClass}`}>
                  {emoji} {run.verdict}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-3 w-3" /> Prev
          </button>
          <span className="text-xs font-mono text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none"
          >
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
