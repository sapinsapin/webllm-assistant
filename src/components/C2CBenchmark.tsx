import { useState, useCallback } from "react";
import { Cloud, Cpu, Play, CheckCircle2, Loader2, BarChart3 } from "lucide-react";
import { BENCHMARK_PROMPTS, BENCHMARK_CATEGORIES, type BenchmarkPrompt } from "@/lib/models";
import type { InferenceEngine } from "@/lib/inference/types";

const APOLLO_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apollo-chat`;

interface RunResult {
  timeMs: number;
  tokensEstimate: number;
  tps: number;
  response: string;
}

interface BenchmarkRow {
  prompt: BenchmarkPrompt;
  cloud?: RunResult;
  local?: RunResult;
  status: "idle" | "running-cloud" | "running-local" | "done" | "error";
  error?: string;
}

interface C2CBenchmarkProps {
  engineRef: React.RefObject<InferenceEngine | null>;
  localReady: boolean;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.split(/\s+/).length * 1.3));
}

export function C2CBenchmark({ engineRef, localReady }: C2CBenchmarkProps) {
  // Only use simple single-prompt benchmarks (ttft, short, medium, long, reasoning)
  const prompts = BENCHMARK_PROMPTS.filter(
    (p) => !["long_context", "multi_turn", "concurrent"].includes(p.category)
  );

  const [rows, setRows] = useState<BenchmarkRow[]>(
    prompts.map((p) => ({ prompt: p, status: "idle" }))
  );
  const [running, setRunning] = useState(false);

  const runCloudPrompt = useCallback(async (prompt: string): Promise<RunResult> => {
    const start = performance.now();
    const resp = await fetch(APOLLO_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Cloud HTTP ${resp.status}`);

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
    return {
      timeMs,
      tokensEstimate,
      tps: tokensEstimate / (timeMs / 1000),
      response: content,
    };
  }, []);

  const runLocalPrompt = useCallback(async (prompt: string): Promise<RunResult> => {
    const engine = engineRef.current;
    if (!engine) throw new Error("No local engine");

    const formatted = engine.formatPrompt([{ role: "user", content: prompt }]);
    let fullResponse = "";
    const start = performance.now();

    await engine.generateStream(formatted, {
      onToken: (token) => { fullResponse += token; },
      onComplete: () => {},
    });

    const timeMs = performance.now() - start;
    const tokensEstimate = estimateTokens(fullResponse);
    return {
      timeMs,
      tokensEstimate,
      tps: tokensEstimate / (timeMs / 1000),
      response: fullResponse,
    };
  }, [engineRef]);

  const runAll = useCallback(async () => {
    setRunning(true);
    const updated: BenchmarkRow[] = prompts.map((p) => ({ prompt: p, status: "idle" }));
    setRows([...updated]);

    for (let i = 0; i < updated.length; i++) {
      const row = { ...updated[i] };

      // Cloud
      row.status = "running-cloud";
      updated[i] = row;
      setRows([...updated]);
      try {
        row.cloud = await runCloudPrompt(row.prompt.prompt);
      } catch (err) {
        row.error = `Cloud: ${err instanceof Error ? err.message : "failed"}`;
      }

      // Local (if ready)
      if (localReady && engineRef.current) {
        row.status = "running-local";
        updated[i] = row;
        setRows([...updated]);
        try {
          row.local = await runLocalPrompt(row.prompt.prompt);
        } catch (err) {
          row.error = (row.error ? row.error + " | " : "") + `Local: ${err instanceof Error ? err.message : "failed"}`;
        }
      }

      row.status = row.error ? "error" : "done";
      updated[i] = row;
      setRows([...updated]);
    }
    setRunning(false);
  }, [prompts, localReady, engineRef, runCloudPrompt, runLocalPrompt]);

  const doneRows = rows.filter((r) => r.status === "done");
  const avgCloud = doneRows.length > 0
    ? doneRows.reduce((s, r) => s + (r.cloud?.tps || 0), 0) / doneRows.length
    : 0;
  const avgLocal = doneRows.length > 0
    ? doneRows.reduce((s, r) => s + (r.local?.tps || 0), 0) / doneRows.filter(r => r.local).length || 0
    : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-mono font-medium">C2C Benchmark</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          Cloud vs Local — side by side
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

      {/* Summary */}
      {doneRows.length > 0 && (
        <div className="flex items-center gap-4 border-b border-border px-4 py-2 bg-secondary/20">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <Cloud className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Avg:</span>
            <span className="text-foreground font-medium">{avgCloud.toFixed(1)} tok/s</span>
          </div>
          {avgLocal > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <Cpu className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Avg:</span>
              <span className="text-foreground font-medium">{avgLocal.toFixed(1)} tok/s</span>
            </div>
          )}
          {avgLocal > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {avgLocal > avgCloud
                ? `Local ${((avgLocal / avgCloud - 1) * 100).toFixed(0)}% faster`
                : `Cloud ${((avgCloud / avgLocal - 1) * 100).toFixed(0)}% faster`}
            </span>
          )}
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
        {rows.map((row, i) => {
          const cat = BENCHMARK_CATEGORIES[row.prompt.category];
          return (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-3 space-y-2"
            >
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
                  {(row.status === "running-cloud" || row.status === "running-local") && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-primary">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {row.status === "running-cloud" ? "Cloud" : "Local"}
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

              {(row.cloud || row.local) && (
                <div className="grid grid-cols-2 gap-3">
                  {/* Cloud result */}
                  <div className="rounded-md bg-secondary/30 px-2.5 py-2 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <Cloud className="h-2.5 w-2.5" /> Cloud
                    </div>
                    {row.cloud ? (
                      <div className="space-y-0.5">
                        <div className="text-xs font-mono font-medium">{row.cloud.tps.toFixed(1)} tok/s</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {row.cloud.timeMs.toFixed(0)}ms · ~{row.cloud.tokensEstimate} tokens
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/50">—</span>
                    )}
                  </div>

                  {/* Local result */}
                  <div className="rounded-md bg-secondary/30 px-2.5 py-2 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <Cpu className="h-2.5 w-2.5" /> Local
                    </div>
                    {row.local ? (
                      <div className="space-y-0.5">
                        <div className="text-xs font-mono font-medium">{row.local.tps.toFixed(1)} tok/s</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {row.local.timeMs.toFixed(0)}ms · ~{row.local.tokensEstimate} tokens
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/50">
                        {localReady ? "—" : "Local not ready"}
                      </span>
                    )}
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
