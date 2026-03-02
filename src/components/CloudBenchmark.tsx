import { useState, useCallback } from "react";
import { Cloud, Play, CheckCircle2, Loader2, BarChart3 } from "lucide-react";
import { BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, type BenchmarkPrompt } from "@/lib/models";

const SAPINSAPINAI_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apollo-chat`;

interface RunResult {
  timeMs: number;
  tokensEstimate: number;
  tps: number;
  response: string;
}

interface BenchmarkRow {
  prompt: BenchmarkPrompt;
  result?: RunResult;
  status: "idle" | "running" | "done" | "error";
  error?: string;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.split(/\s+/).length * 1.3));
}

export function CloudBenchmark() {
  const prompts = BENCHMARK_PROMPTS.filter(
    (p) => !["long_context", "multi_turn", "concurrent"].includes(p.category)
  );

  const [rows, setRows] = useState<BenchmarkRow[]>(
    prompts.map((p) => ({ prompt: p, status: "idle" }))
  );
  const [running, setRunning] = useState(false);

  const runCloudPrompt = useCallback(async (prompt: string): Promise<RunResult> => {
    const start = performance.now();
    const resp = await fetch(SAPINSAPINAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        try {
          const parsed = JSON.parse(payload);
          const c = parsed.choices?.[0]?.delta?.content;
          if (c) content += c;
        } catch { break; }
      }
    }

    const timeMs = performance.now() - start;
    const tokensEstimate = estimateTokens(content);
    return { timeMs, tokensEstimate, tps: tokensEstimate / (timeMs / 1000), response: content };
  }, []);

  const runAll = useCallback(async () => {
    setRunning(true);
    const updated: BenchmarkRow[] = prompts.map((p) => ({ prompt: p, status: "idle" }));
    setRows([...updated]);

    for (let i = 0; i < updated.length; i++) {
      const row = { ...updated[i] };
      row.status = "running";
      updated[i] = row;
      setRows([...updated]);

      try {
        row.result = await runCloudPrompt(row.prompt.prompt);
        row.status = "done";
      } catch (err) {
        row.error = err instanceof Error ? err.message : "failed";
        row.status = "error";
      }
      updated[i] = row;
      setRows([...updated]);
    }
    setRunning(false);
  }, [prompts, runCloudPrompt]);

  const doneRows = rows.filter((r) => r.status === "done");
  const avgTps = doneRows.length > 0
    ? doneRows.reduce((s, r) => s + (r.result?.tps || 0), 0) / doneRows.length
    : 0;
  const avgLatency = doneRows.length > 0
    ? doneRows.reduce((s, r) => s + (r.result?.timeMs || 0), 0) / doneRows.length
    : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-mono font-medium">Cloud Benchmark</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          SapinSapinAI inference latency
        </span>
        <div className="ml-auto">
          <button
            onClick={runAll}
            disabled={running}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {running ? "Running…" : "Run All"}
          </button>
        </div>
      </div>

      {doneRows.length > 0 && (
        <div className="flex items-center gap-4 border-b border-border px-4 py-2 bg-secondary/20">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <Cloud className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Avg:</span>
            <span className="text-foreground font-medium">{avgTps.toFixed(1)} tok/s</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-muted-foreground">Latency:</span>
            <span className="text-foreground font-medium">{avgLatency.toFixed(0)}ms</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
        {rows.map((row, i) => {
          const cat = BENCHMARK_CATEGORIES[row.prompt.category];
          return (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {cat?.label || row.prompt.category}
                </span>
                <span className="text-xs font-mono font-medium text-foreground">
                  {row.prompt.label}
                </span>
                <div className="ml-auto">
                  {row.status === "idle" && (
                    <span className="text-[10px] text-muted-foreground/50">—</span>
                  )}
                  {row.status === "running" && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-primary">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Running
                    </span>
                  )}
                  {row.status === "done" && (
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                  )}
                  {row.status === "error" && (
                    <span className="text-[10px] text-destructive">{row.error}</span>
                  )}
                </div>
              </div>

              {row.result && (
                <div className="rounded-md bg-secondary/30 px-2.5 py-2 space-y-1">
                  <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                    <Cloud className="h-2.5 w-2.5" /> Cloud
                  </div>
                  <div className="text-xs font-mono font-medium">{row.result.tps.toFixed(1)} tok/s</div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {row.result.timeMs.toFixed(0)}ms · ~{row.result.tokensEstimate} tokens
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
