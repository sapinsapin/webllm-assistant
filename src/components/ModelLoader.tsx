import { useState } from "react";
import { Cpu, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { ModelStatus } from "@/hooks/useLlmInference";

interface ModelLoaderProps {
  status: ModelStatus;
  statusMessage: string;
  onLoadModel: (url: string) => void;
}

const PRESET_MODELS = [
  {
    name: "Gemma 3n E2B (smallest, ~1.5GB)",
    url: "https://huggingface.co/google/gemma-3n-E2B-it-litert-lm/resolve/main/gemma-3n-E2B-it-int4-Web.litertlm",
  },
  {
    name: "Gemma 3n E4B (~3GB)",
    url: "https://huggingface.co/google/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4-Web.litertlm",
  },
];

export function ModelLoader({ status, statusMessage, onLoadModel }: ModelLoaderProps) {
  const [customUrl, setCustomUrl] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);

  const handleLoad = () => {
    const url = customUrl.trim() || PRESET_MODELS[selectedPreset].url;
    onLoadModel(url);
  };

  if (status === "ready") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-mono">{statusMessage}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center rounded-full border border-primary/20 bg-primary/5 p-4 glow-primary">
          <Cpu className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight font-mono">
          <span className="text-primary glow-text">Edge</span>
          <span className="text-foreground">LLM</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Run AI models entirely in your browser — no server required
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Select a model
          </label>
          <div className="space-y-2">
            {PRESET_MODELS.map((model, i) => (
              <button
                key={i}
                onClick={() => setSelectedPreset(i)}
                disabled={status === "loading"}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-all ${
                  selectedPreset === i
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-muted-foreground/30"
                }`}
              >
                <span className="font-mono">{model.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Or paste a custom model URL
          </label>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://huggingface.co/..."
            disabled={status === "loading"}
            className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <button
          onClick={handleLoad}
          disabled={status === "loading"}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50 glow-primary"
        >
          {status === "loading" ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono">{statusMessage}</span>
            </span>
          ) : (
            "Load Model"
          )}
        </button>

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-mono">{statusMessage}</span>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground/60">
        Requires a WebGPU-compatible browser (Chrome 113+). Models run 100% locally.
      </p>
    </div>
  );
}
