import { useState, useCallback, useRef } from "react";
import { useLlmInference } from "@/hooks/useLlmInference";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  EVAL_PROMPTS,
  EVAL_CATEGORIES,
  type EvalCategory,
  type EvalScore,
  type EvalRunSummary,
  scoreResponse,
  computeScore,
  computeHybridScore,
  computeCategoryAccuracy,
} from "@/lib/evals";
import { supabase } from "@/integrations/supabase/client";
import { Play, CheckCircle2, XCircle, Loader2, Download, Gavel } from "lucide-react";
import { toast } from "sonner";

type EvalStatus = "idle" | "running" | "judging" | "done" | "error";

interface RowState {
  status: "idle" | "running" | "done" | "error";
  score?: EvalScore;
  error?: string;
}

export function EvalsPanel() {
  const { engineRef, currentModelName, activeEngine } = useLlmInference();
  const [rows, setRows] = useState<RowState[]>(() => EVAL_PROMPTS.map(() => ({ status: "idle" })));
  const [overallStatus, setOverallStatus] = useState<EvalStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<EvalRunSummary | null>(null);
  const [filterCat, setFilterCat] = useState<EvalCategory | "all">("all");
  const [useJudge, setUseJudge] = useState(true);
  const abortRef = useRef(false);

  const runAll = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    abortRef.current = false;
    setOverallStatus("running");
    setSummary(null);
    const newRows: RowState[] = EVAL_PROMPTS.map(() => ({ status: "idle" }));
    setRows([...newRows]);

    const scores: EvalScore[] = [];

    for (let i = 0; i < EVAL_PROMPTS.length; i++) {
      if (abortRef.current) break;
      const ep = EVAL_PROMPTS[i];
      newRows[i] = { status: "running" };
      setRows([...newRows]);
      setProgress(((i) / EVAL_PROMPTS.length) * 100);

      try {
        const prompt = engine.formatPrompt([{ role: "user", content: ep.prompt }]);
        const start = performance.now();
        const result = await engine.generateFull(prompt);
        const timeMs = performance.now() - start;

        const breakdown = scoreResponse(ep, result.response);
        const score = computeScore(breakdown);
        const evalScore: EvalScore = {
          evalId: ep.id,
          score,
          maxScore: 1,
          response: result.response,
          timeMs,
          tokensGenerated: result.tokenCount,
          breakdown,
        };
        scores.push(evalScore);
        newRows[i] = { status: "done", score: evalScore };
      } catch (err) {
        newRows[i] = { status: "error", error: err instanceof Error ? err.message : "Failed" };
      }
      setRows([...newRows]);
    }

    setProgress(100);

    // LLM-as-Judge pass
    if (useJudge && scores.length > 0 && !abortRef.current) {
      setOverallStatus("judging");
      try {
        const items = scores.map((s) => {
          const ep = EVAL_PROMPTS.find((e) => e.id === s.evalId)!;
          return {
            prompt: ep.prompt,
            expectedAnswer: ep.expectedAnswer,
            modelResponse: s.response,
            category: ep.category,
          };
        });

        const { data, error } = await supabase.functions.invoke("eval-judge", {
          body: { items },
        });

        if (error) throw error;

        const results: { index: number; score: number; reasoning: string }[] = data?.results || [];
        for (const r of results) {
          const idx = r.index - 1;
          if (idx >= 0 && idx < scores.length) {
            scores[idx].judgeScore = r.score;
            scores[idx].judgeReasoning = r.reasoning;
            scores[idx].score = computeHybridScore(computeScore(scores[idx].breakdown), r.score);
          }
        }

        // Update rows with judge data
        for (let i = 0; i < EVAL_PROMPTS.length; i++) {
          const s = scores.find((sc) => sc.evalId === EVAL_PROMPTS[i].id);
          if (s && newRows[i].status === "done") {
            newRows[i] = { ...newRows[i], score: s };
          }
        }
        setRows([...newRows]);
        toast.success("LLM judge scoring complete");
      } catch (err) {
        console.error("Judge error:", err);
        toast.error("LLM judge failed, using keyword scores only");
      }
    }

    const catAcc = computeCategoryAccuracy(scores);
    const overall = scores.length > 0 ? scores.reduce((a, s) => a + s.score, 0) / scores.length : 0;
    const run: EvalRunSummary = {
      modelName: currentModelName,
      engine: activeEngine || "unknown",
      timestamp: new Date().toISOString(),
      scores,
      overallAccuracy: Math.round(overall * 100) / 100,
      categoryAccuracy: catAcc,
      usedJudge: useJudge,
    };
    setSummary(run);
    setOverallStatus("done");
  }, [engineRef, currentModelName, activeEngine, useJudge]);

  const exportResults = useCallback(() => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evals-${summary.modelName}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [summary]);

  const filteredIndices = EVAL_PROMPTS
    .map((ep, i) => ({ ep, i }))
    .filter(({ ep }) => filterCat === "all" || ep.category === filterCat);

  const scoreColor = (s: number) =>
    s >= 0.85 ? "text-green-400" : s >= 0.5 ? "text-yellow-400" : "text-red-400";

  const scoreBg = (s: number) =>
    s >= 0.85 ? "bg-green-400/10 border-green-400/20" : s >= 0.5 ? "bg-yellow-400/10 border-yellow-400/20" : "bg-red-400/10 border-red-400/20";

  const judgeColor = (s: number) =>
    s >= 4 ? "text-green-400" : s >= 3 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Accuracy Evals</h2>
            <p className="text-xs text-muted-foreground">{EVAL_PROMPTS.length} prompts across {Object.keys(EVAL_CATEGORIES).length} categories</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="judge-toggle" checked={useJudge} onCheckedChange={setUseJudge} disabled={overallStatus === "running" || overallStatus === "judging"} />
              <Label htmlFor="judge-toggle" className="text-xs text-muted-foreground flex items-center gap-1">
                <Gavel className="h-3 w-3" /> LLM Judge
              </Label>
            </div>
            {summary && (
              <Button variant="outline" size="sm" onClick={exportResults}>
                <Download className="h-3 w-3 mr-1" /> Export
              </Button>
            )}
            <Button
              size="sm"
              onClick={overallStatus === "running" || overallStatus === "judging" ? () => { abortRef.current = true; } : runAll}
              disabled={!engineRef.current}
            >
              {overallStatus === "running" ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Running...</>
              ) : overallStatus === "judging" ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Judging...</>
              ) : (
                <><Play className="h-3 w-3 mr-1" /> Run Evals</>
              )}
            </Button>
          </div>
        </div>

        {(overallStatus === "running" || overallStatus === "judging") && (
          <div className="space-y-1">
            <Progress value={progress} className="h-1.5" />
            {overallStatus === "judging" && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Gavel className="h-3 w-3" /> Cloud LLM is judging responses...
              </p>
            )}
          </div>
        )}

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`rounded-lg border px-3 py-1.5 ${scoreBg(summary.overallAccuracy)}`}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Overall</span>
              <p className={`text-lg font-bold font-mono ${scoreColor(summary.overallAccuracy)}`}>
                {Math.round(summary.overallAccuracy * 100)}%
              </p>
            </div>
            {(Object.entries(summary.categoryAccuracy) as [EvalCategory, number][]).map(([cat, acc]) => (
              <div key={cat} className="text-center">
                <span className="text-[10px] text-muted-foreground">{EVAL_CATEGORIES[cat].icon} {EVAL_CATEGORIES[cat].label}</span>
                <p className={`text-sm font-mono font-semibold ${scoreColor(acc)}`}>{Math.round(acc * 100)}%</p>
              </div>
            ))}
            {summary.usedJudge && (
              <div className="text-center">
                <span className="text-[10px] text-primary flex items-center gap-1"><Gavel className="h-2.5 w-2.5" /> Judge enabled</span>
              </div>
            )}
          </div>
        )}

        {/* Category filter */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setFilterCat("all")}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              filterCat === "all" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {(Object.entries(EVAL_CATEGORIES) as [EvalCategory, typeof EVAL_CATEGORIES[EvalCategory]][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setFilterCat(key)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                filterCat === key ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {val.icon} {val.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredIndices.map(({ ep, i }) => {
          const row = rows[i];
          return (
            <Card key={ep.id} className="p-3 bg-card border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5 text-muted-foreground font-mono">
                      {EVAL_CATEGORIES[ep.category].icon} {ep.category}
                    </span>
                    <span className="text-xs font-medium text-foreground truncate">{ep.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate">{ep.prompt}</p>
                  {row.status === "done" && row.score && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-muted-foreground">
                        <span className="text-foreground/60">Response:</span>{" "}
                        <span className="font-mono">{row.score.response.slice(0, 200)}{row.score.response.length > 200 ? "…" : ""}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Expected: <span className="font-mono text-foreground/50">{ep.expectedAnswer}</span>
                        {" · "}Keywords: {row.score.breakdown.requiredHits}/{row.score.breakdown.requiredTotal}
                        {row.score.breakdown.bonusTotal > 0 && ` · Bonus: ${row.score.breakdown.bonusHits}/${row.score.breakdown.bonusTotal}`}
                        {row.score.breakdown.patternMatch !== null && ` · Pattern: ${row.score.breakdown.patternMatch ? "✓" : "✗"}`}
                        {" · "}{row.score.tokensGenerated} tok · {Math.round(row.score.timeMs)}ms
                      </p>
                      {row.score.judgeScore !== undefined && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Gavel className="h-2.5 w-2.5 text-primary" />
                          Judge: <span className={`font-mono font-semibold ${judgeColor(row.score.judgeScore)}`}>{row.score.judgeScore}/5</span>
                          {row.score.judgeReasoning && (
                            <span className="text-foreground/40 ml-1">— {row.score.judgeReasoning}</span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {row.status === "error" && (
                    <p className="text-[11px] text-destructive mt-1">{row.error}</p>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5">
                  {row.status === "idle" && <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />}
                  {row.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  {row.status === "done" && row.score && (
                    <span className={`text-sm font-bold font-mono ${scoreColor(row.score.score)}`}>
                      {Math.round(row.score.score * 100)}%
                    </span>
                  )}
                  {row.status === "done" && row.score && (
                    row.score.score >= 0.7
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      : <XCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
