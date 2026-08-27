import { useState } from "react";
import { AudioLines, Mic, Volume2, Play, Loader2, AlertCircle, Search, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  ASR_MODELS, TTS_MODELS, ASR_SAMPLES, TTS_SENTENCES,
  runAsrBenchmark, runTtsBenchmark, checkRuntimeSupport, speechVerdict,
  type AsrBenchmarkResult, type TtsBenchmarkResult, type RuntimeSupport,
} from "@/lib/speech";

const TONE_CLASS: Record<string, string> = {
  good: "text-primary",
  ok: "text-orange-400",
  bad: "text-destructive",
};

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold text-foreground">
        {value}
        {unit && <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

export function SpeechBench() {
  const [tab, setTab] = useState<"asr" | "tts">("asr");

  const [asrModel, setAsrModel] = useState(ASR_MODELS[0].id);
  const [asrSample, setAsrSample] = useState(ASR_SAMPLES[0].id);
  const [ttsModel, setTtsModel] = useState(TTS_MODELS[0].id);
  const [ttsSentence, setTtsSentence] = useState(TTS_SENTENCES[0]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asrResult, setAsrResult] = useState<AsrBenchmarkResult | null>(null);
  const [ttsResult, setTtsResult] = useState<TtsBenchmarkResult | null>(null);

  const [repoInput, setRepoInput] = useState("internetoftim/whisper-small-pld-fil-ONNX");
  const [checking, setChecking] = useState(false);
  const [support, setSupport] = useState<RuntimeSupport | null>(null);

  const onProgress = (pct: number, msg: string) => {
    setProgress(pct);
    setStatusMsg(msg);
  };

  const runAsr = async () => {
    const model = ASR_MODELS.find((m) => m.id === asrModel)!;
    const sample = ASR_SAMPLES.find((s) => s.id === asrSample)!;
    setRunning(true); setError(null); setAsrResult(null); setProgress(0);
    try {
      setAsrResult(await runAsrBenchmark(model, sample, onProgress));
      toast.success("ASR benchmark complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast.error(`ASR benchmark failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  };

  const runTts = async () => {
    const model = TTS_MODELS.find((m) => m.id === ttsModel)!;
    setRunning(true); setError(null); setTtsResult(null); setProgress(0);
    try {
      setTtsResult(await runTtsBenchmark(model, ttsSentence, onProgress));
      toast.success("TTS benchmark complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast.error(`TTS benchmark failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  };

  const checkRepo = async () => {
    setChecking(true); setSupport(null);
    try {
      setSupport(await checkRuntimeSupport(repoInput));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Compatibility check failed");
    } finally {
      setChecking(false);
    }
  };

  const activeResult = tab === "asr" ? asrResult : ttsResult;
  const verdict = activeResult ? speechVerdict(activeResult.rtf) : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <AudioLines className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-sm font-bold text-foreground">Speech Benchmarks — ASR &amp; TTS</h2>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Runs speech-to-text and text-to-speech entirely on device via Transformers.js. Scored by
        real-time factor (RTF): seconds of compute per second of audio — lower is better.
      </p>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-md border border-border bg-secondary/20 p-1">
          {([["asr", "Speech → Text", Mic], ["tts", "Text → Speech", Volume2]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              disabled={running}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 font-mono text-xs transition-colors disabled:opacity-50 ${
                tab === key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>

        {tab === "asr" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">ASR model</label>
              <select className={selectClass} value={asrModel} onChange={(e) => setAsrModel(e.target.value)} disabled={running}>
                {ASR_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.size}</option>
                ))}
              </select>
              <p className="font-mono text-[10px] text-muted-foreground">
                {ASR_MODELS.find((m) => m.id === asrModel)?.description}
              </p>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Audio sample</label>
              <select className={selectClass} value={asrSample} onChange={(e) => setAsrSample(e.target.value)} disabled={running}>
                {ASR_SAMPLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">TTS model</label>
              <select className={selectClass} value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} disabled={running}>
                {TTS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.size}</option>
                ))}
              </select>
              <p className="font-mono text-[10px] text-muted-foreground">
                {TTS_MODELS.find((m) => m.id === ttsModel)?.description}
              </p>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Sentence</label>
              <select className={selectClass} value={ttsSentence} onChange={(e) => setTtsSentence(e.target.value)} disabled={running}>
                {TTS_SENTENCES.map((s) => (
                  <option key={s} value={s}>{s.slice(0, 45)}…</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button
          onClick={tab === "asr" ? runAsr : runTts}
          disabled={running}
          className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Running…" : `Run ${tab === "asr" ? "ASR" : "TTS"} benchmark`}
        </button>

        {running && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">{statusMsg}</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="font-mono text-xs text-destructive">{error}</p>
          </div>
        )}

        {activeResult && verdict && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{verdict.emoji}</span>
              <span className={`font-mono text-sm font-bold ${TONE_CLASS[verdict.tone]}`}>{verdict.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {activeResult.modelName} · {activeResult.device}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="RTF" value={activeResult.rtf.toFixed(2)} unit="× audio" />
              <Metric label="Speed" value={`${activeResult.xRealtime.toFixed(1)}×`} unit="realtime" />
              <Metric label="Inference" value={(activeResult.inferMs / 1000).toFixed(2)} unit="s" />
              <Metric label="Load" value={(activeResult.loadMs / 1000).toFixed(1)} unit="s" />
              <Metric label="Audio" value={activeResult.audioSeconds.toFixed(1)} unit="s" />
              {tab === "tts" && ttsResult && (
                <Metric label="Chars/s" value={ttsResult.charsPerSecond.toFixed(1)} />
              )}
            </div>
            {tab === "asr" && asrResult && (
              <div className="rounded-md border border-border bg-secondary/20 p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Transcript</div>
                <p className="font-mono text-xs text-foreground">{asrResult.transcript || "(empty)"}</p>
              </div>
            )}
            {tab === "tts" && ttsResult && (
              <audio controls src={ttsResult.audioUrl} className="w-full" />
            )}
          </div>
        )}
      </div>

      {/* Runtime compatibility checker */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-mono text-xs font-bold text-foreground">Can this Hugging Face model run in the browser?</h3>
        </div>
        <div className="flex gap-2">
          <input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="owner/model-name"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={checkRepo}
            disabled={checking || !repoInput.trim()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Check
          </button>
        </div>
        {support && (
          <div className={`rounded-md border p-3 space-y-1 ${support.supported ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2 font-mono text-xs font-semibold">
              {support.supported
                ? <CheckCircle2 className="h-4 w-4 text-primary" />
                : <XCircle className="h-4 w-4 text-destructive" />}
              <span className={support.supported ? "text-primary" : "text-destructive"}>
                {support.supported ? "Supported" : "Not runnable locally"}
              </span>
              <span className="text-muted-foreground">{support.repo}</span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{support.reason}</p>
            {support.pipelineTag && (
              <p className="font-mono text-[10px] text-muted-foreground">
                task: {support.pipelineTag}{support.library ? ` · library: ${support.library}` : ""}
              </p>
            )}
            {support.hint && <p className="font-mono text-[11px] text-orange-400">{support.hint}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
