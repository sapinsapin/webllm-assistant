import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Cpu, Zap, Server, TrendingUp, DollarSign } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  estimateDeviceTflops,
  deviceFingerprint,
  formatTflops,
  DATACENTER,
  type DeviceLike,
} from "@/lib/deviceFlops";

interface RunRow extends DeviceLike {
  screen_res: string | null;
  pixel_ratio: number | null;
}

const H100_PRICE_USD = 30_000;

export function FrugalFlops() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeAll, setIncludeAll] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull just what we need to fingerprint devices. Exclude pure cloud runs.
      let query = supabase
        .from("benchmark_runs")
        .select("device_model,device_type,gpu,gpu_vendor,ram_gb,cores,screen_res,pixel_ratio,engine,verdict")
        .not("engine", "in", "(cloud,c2c-cloud)")
        .limit(5000);
      if (!includeAll) {
        query = query.neq("verdict", "Did not finish").neq("verdict", "Crashed");
      }
      const { data } = await query;
      if (cancelled) return;
      setRows((data as RunRow[]) || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [includeAll]);

  const stats = useMemo(() => {
    const seen = new Map<string, RunRow>();
    for (const r of rows) {
      const fp = deviceFingerprint(r);
      if (!seen.has(fp)) seen.set(fp, r);
    }
    const unique = Array.from(seen.values());
    let totalTflops = 0;
    const breakdown = new Map<string, { count: number; tflops: number }>();
    for (const d of unique) {
      const est = estimateDeviceTflops(d);
      totalTflops += est.tflops;
      const b = breakdown.get(est.label) || { count: 0, tflops: 0 };
      b.count += 1;
      b.tflops += est.tflops;
      breakdown.set(est.label, b);
    }
    const sorted = Array.from(breakdown.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.tflops - a.tflops);
    return {
      uniqueDevices: unique.length,
      totalRuns: rows.length,
      totalTflops,
      h100s: totalTflops / DATACENTER.H100,
      a100s: totalTflops / DATACENTER.A100,
      gb200s: totalTflops / DATACENTER.GB200,
      breakdown: sorted,
    };
  }, [rows]);

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm font-mono text-muted-foreground animate-pulse">Tallying dark compute…</p>
      </section>
    );
  }

  const dollars = stats.h100s * H100_PRICE_USD;
  const dollarsLabel =
    dollars >= 1_000_000 ? `$${(dollars / 1_000_000).toFixed(2)}M` : `$${Math.round(dollars).toLocaleString()}`;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold font-mono text-foreground">Frugal FLOPs</h2>
        <span className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          dark compute index
        </span>
        <label className="ml-auto flex items-center gap-2 text-[10px] font-mono text-muted-foreground cursor-pointer">
          <span>include failed attempts</span>
          <Switch checked={includeAll} onCheckedChange={setIncludeAll} />
        </label>
      </div>

      <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-5 space-y-5">
        {/* Hero numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="unique devices"
            value={stats.uniqueDevices.toLocaleString()}
            sub={`${stats.totalRuns.toLocaleString()} runs`}
          />
          <Stat
            icon={<Zap className="h-3.5 w-3.5 text-primary" />}
            label="combined FP16"
            value={formatTflops(stats.totalTflops)}
            sub="dense, idle"
            highlight
          />
          <Stat
            icon={<Server className="h-3.5 w-3.5" />}
            label="≈ NVIDIA H100s"
            value={stats.h100s.toFixed(2)}
            sub={`${stats.gb200s.toFixed(2)} GB200 · ${stats.a100s.toFixed(1)} A100`}
          />
          <Stat
            icon={<DollarSign className="h-3.5 w-3.5" />}
            label="datacenter equiv."
            value={dollarsLabel}
            sub="@ $30k / H100 node"
          />
        </div>

        {/* Pitch */}
        <p className="text-xs md:text-sm font-mono text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
          <span className="text-foreground">{stats.uniqueDevices.toLocaleString()} edge devices</span> have run
          on-device AI through this platform — a combined{" "}
          <span className="text-primary font-semibold">{formatTflops(stats.totalTflops)}</span> of dense FP16
          inference capacity. That's the equivalent of{" "}
          <span className="text-foreground font-semibold">{stats.h100s.toFixed(2)} NVIDIA H100s</span> — roughly{" "}
          <span className="text-foreground font-semibold">{dollarsLabel}</span> in datacenter hardware sitting in
          people's pockets and on their desks. The hardware is already distributed; the software is just broken.
        </p>

        {/* Breakdown */}
        {stats.breakdown.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Breakdown by device class
            </h3>
            <div className="space-y-1.5">
              {stats.breakdown.slice(0, 8).map((b) => {
                const pct = stats.totalTflops > 0 ? (b.tflops / stats.totalTflops) * 100 : 0;
                return (
                  <div key={b.label} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-foreground truncate pr-2">{b.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {b.count}× · {formatTflops(b.tflops)}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-secondary/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[10px] font-mono text-muted-foreground/60 italic">
          Estimates use vendor-published dense FP16 throughput per detected GPU architecture. Real-world inference
          throughput depends on memory bandwidth, batch size, and quantization.
        </p>
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/20"
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 font-mono font-bold ${highlight ? "text-primary" : "text-foreground"} text-lg md:text-xl`}>
        {value}
      </div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}