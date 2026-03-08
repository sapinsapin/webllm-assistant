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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    supabase
      .from("benchmark_runs")
      .select("id,created_at,device_model,device_type,avg_tps,avg_ttft_ms,verdict,model_name,engine,browser,os,country,city,cores,ram_gb,gpu,gpu_vendor,screen_res", { count: "exact" })
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
          const isExpanded = expandedId === run.id;
          return (
            <div
              key={run.id}
              className="rounded-lg border border-border bg-card/50 overflow-hidden transition-colors"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : run.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-card/80 transition-colors"
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
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-3 bg-secondary/10">
                  <h4 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">Device Details</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[11px] font-mono">
                    {run.device_model && (
                      <div className="flex items-center gap-1.5">
                        <Smartphone className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Device:</span>
                        <span className="text-foreground font-medium">{run.device_model}</span>
                      </div>
                    )}
                    {run.device_type && (
                      <div className="flex items-center gap-1.5">
                        <Monitor className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Type:</span>
                        <span className="text-foreground font-medium capitalize">{run.device_type}</span>
                      </div>
                    )}
                    {run.os && (
                      <div className="flex items-center gap-1.5">
                        <Monitor className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">OS:</span>
                        <span className="text-foreground font-medium">{run.os}</span>
                      </div>
                    )}
                    {run.browser && (
                      <div className="flex items-center gap-1.5">
                        <Monitor className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Browser:</span>
                        <span className="text-foreground font-medium">{run.browser}</span>
                      </div>
                    )}
                    {run.cores && (
                      <div className="flex items-center gap-1.5">
                        <Cpu className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Cores:</span>
                        <span className="text-foreground font-medium">{run.cores}</span>
                      </div>
                    )}
                    {run.ram_gb && (
                      <div className="flex items-center gap-1.5">
                        <MemoryStick className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">RAM:</span>
                        <span className="text-foreground font-medium">{run.ram_gb} GB</span>
                      </div>
                    )}
                    {run.gpu && (
                      <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">GPU:</span>
                        <span className="text-foreground font-medium truncate">{run.gpu}</span>
                      </div>
                    )}
                    {run.gpu_vendor && (
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Vendor:</span>
                        <span className="text-foreground font-medium">{run.gpu_vendor}</span>
                      </div>
                    )}
                    {run.screen_res && (
                      <div className="flex items-center gap-1.5">
                        <Monitor className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Screen:</span>
                        <span className="text-foreground font-medium">{run.screen_res}</span>
                      </div>
                    )}
                  </div>
                  
                  <h4 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-2">Benchmark Info</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[11px] font-mono">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Model:</span>
                      <span className="text-foreground font-medium truncate">{run.model_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Engine:</span>
                      <span className="text-foreground font-medium">{run.engine}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-primary" />
                      <span className="text-muted-foreground">Avg TPS:</span>
                      <span className="text-foreground font-medium">{run.avg_tps.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Avg TTFT:</span>
                      <span className="text-foreground font-medium">{run.avg_ttft_ms.toFixed(0)} ms</span>
                    </div>
                    {(run.city || run.country) && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Location:</span>
                        <span className="text-foreground font-medium">{[run.city, run.country].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
