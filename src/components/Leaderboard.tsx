import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { AlertCircle, RotateCcw, Trophy, Smartphone, Monitor, Tablet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatch } from "@/lib/supabaseCompat";
import { METHODOLOGY_VERSION, type Division } from "@/lib/benchmark/spec";
import {
  CONFIDENCE_LABEL,
  confidenceFor,
  rankLeaderboard,
  spreadRatio,
  type LeaderboardRow,
} from "@/lib/benchmark/leaderboard";

const LIMIT = 50;

/** Fetch the per-device leaderboard for one round + division. Throws on
 * error so React Query surfaces a real error state — never an empty board. */
async function fetchLeaderboard(division: Division): Promise<{ unavailable: boolean; rows: LeaderboardRow[] }> {
  const { data, error } = await supabase
    .from("benchmark_leaderboard")
    .select("*")
    .eq("spec_version", METHODOLOGY_VERSION)
    .eq("division", division)
    .order("score_p50", { ascending: false })
    .limit(LIMIT);
  // The view arrives with the 2026.09 migration; until `supabase db push`
  // runs, report "not available yet" rather than a fetch error.
  if (error && isSchemaMismatch(error)) return { unavailable: true, rows: [] };
  if (error) throw new Error(error.message);
  return { unavailable: false, rows: (data as LeaderboardRow[]) ?? [] };
}

function DeviceIcon({ type }: { type: string | null }) {
  const cls = "h-3.5 w-3.5 text-muted-foreground shrink-0";
  if (type === "mobile") return <Smartphone className={cls} />;
  if (type === "tablet") return <Tablet className={cls} />;
  return <Monitor className={cls} />;
}

const CONFIDENCE_CLS: Record<string, string> = {
  high: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  medium: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  single: "text-muted-foreground border-border bg-secondary/30",
};

export function Leaderboard() {
  const [division, setDivision] = useState<Division>("closed");
  const [engineFilter, setEngineFilter] = useState<string | null>(null);

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["benchmark_leaderboard", METHODOLOGY_VERSION, division],
    queryFn: () => fetchLeaderboard(division),
    placeholderData: keepPreviousData,
    retry: 2,
    staleTime: 60_000,
  });

  const rows = rankLeaderboard(data?.rows ?? []);
  const unavailable = data?.unavailable ?? false;
  const engines = [...new Set(rows.map((r) => r.engine))].sort();
  const visible = engineFilter ? rows.filter((r) => r.engine === engineFilter) : rows;

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
        <Trophy className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <h2 className="text-sm font-bold font-mono text-foreground">Device Leaderboard</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Median of certified runs per device · round {METHODOLOGY_VERSION} · {division === "closed" ? "reference model per engine" : "any model"}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[11px] font-mono" role="tablist" aria-label="Division">
          {(["closed", "open"] as Division[]).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={division === d}
              onClick={() => { setDivision(d); setEngineFilter(null); }}
              className={`rounded-md border px-2.5 py-1 capitalize transition-colors ${
                division === d ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="p-4 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-secondary/30 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Couldn't load the leaderboard</p>
            <p className="text-xs text-muted-foreground mt-1">{error instanceof Error ? error.message : "Network or server error"}</p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-mono text-secondary-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <RotateCcw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Try again
          </button>
        </div>
      ) : unavailable ? (
        <p className="text-center text-sm text-muted-foreground py-8 px-4">
          Leaderboard not available yet — it appears once the {METHODOLOGY_VERSION} database migration is applied.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 px-4">
          No certified {division}-division runs in round {METHODOLOGY_VERSION} yet. Run the test suite to be first.
        </p>
      ) : (
        <>
          {engines.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b border-border text-[10px] font-mono">
              <span className="text-muted-foreground mr-1">Engine:</span>
              <button
                onClick={() => setEngineFilter(null)}
                className={`rounded border px-1.5 py-0.5 ${engineFilter === null ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}
              >
                all
              </button>
              {engines.map((e) => (
                <button
                  key={e}
                  onClick={() => setEngineFilter(e)}
                  className={`rounded border px-1.5 py-0.5 ${engineFilter === e ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-right">Score tok/s</th>
                  <th className="px-3 py-2 text-right hidden sm:table-cell">TTFT p90</th>
                  <th className="px-3 py-2 text-right">Runs</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const conf = confidenceFor(r.runs);
                  const spread = spreadRatio(r);
                  return (
                    <tr key={`${r.device_key}|${r.model_id}|${r.engine}`} className="border-b border-border/60 hover:bg-secondary/20">
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <DeviceIcon type={r.device_type} />
                          <span className="text-foreground font-medium truncate max-w-[14rem]">{r.device_key}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[10rem]">
                        {r.model_name ?? r.model_id ?? "—"} <span className="text-muted-foreground/60">· {r.engine}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-foreground font-semibold">{r.score_p50.toFixed(1)}</span>
                        {spread != null && (
                          <span className="text-muted-foreground/70 ml-1">±{(spread * 50).toFixed(0)}%</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                        {r.ttft_p90_p50_ms != null ? `${r.ttft_p90_p50_ms.toFixed(0)}ms` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">{r.runs}</td>
                      <td className="px-3 py-2 hidden md:table-cell">
                        <span className={`rounded border px-1.5 py-0.5 ${CONFIDENCE_CLS[conf]}`}>{CONFIDENCE_LABEL[conf]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
