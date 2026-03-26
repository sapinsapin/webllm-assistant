import { useState } from "react";
import { Cpu, Loader2, CheckCircle2, AlertCircle, Zap, Globe, Server } from "lucide-react";
import type { ModelStatus } from "@/hooks/useLlmInference";
import type { EngineType, EngineCapability } from "@/lib/inference/types";
import { PRESET_MODELS, getModelsForEngine } from "@/lib/models";

interface ModelLoaderProps {
  status: ModelStatus;
  statusMessage: string;
  downloadProgress: number;
  activeEngine: EngineType | null;
  capabilities: EngineCapability[];
  onLoadModel: (url: string, name?: string, hfToken?: string, engine?: EngineType, vision?: boolean) => void;
  onBackToQuickStart?: () => void;
}

const ENGINE_ICONS: Record<EngineType, React.ReactNode> = {
  mediapipe: <Zap className="h-3.5 w-3.5" />,
  webllm: <Globe className="h-3.5 w-3.5" />,
  onnx: <Server className="h-3.5 w-3.5" />,
};

const ENGINE_LABELS: Record<EngineType, string> = {
  mediapipe: "MediaPipe",
  webllm: "WebLLM",
  onnx: "ONNX (WASM)",
};

export function ModelLoader({ status, statusMessage, downloadProgress, activeEngine, capabilities, onLoadModel, onBackToQuickStart }: ModelLoaderProps) {
  const [customUrl, setCustomUrl] = useState("");
  const bestAvailable = capabilities.find((c) => c.available)?.engine || "onnx";
  const [selectedEngine, setSelectedEngine] = useState<EngineType>(activeEngine || bestAvailable);
  const [selectedPreset, setSelectedPreset] = useState(0);

  // Update selected engine when capabilities arrive
  const engineModels = getModelsForEngine(selectedEngine);

  const handleLoad = () => {
    if (customUrl.trim()) {
      onLoadModel(customUrl.trim(), "Custom Model", undefined, selectedEngine);
    } else if (engineModels.length > 0) {
      const model = engineModels[selectedPreset] || engineModels[0];
      onLoadModel(model.url, model.name, undefined, model.engine, model.vision);
    }
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
          <span className="text-primary glow-text">Can I</span>
          <span className="text-foreground"> AI?</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Advanced mode — configure engine and model manually
        </p>
        {onBackToQuickStart && (
          <button
            onClick={onBackToQuickStart}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors font-mono mt-1"
          >
            ← Back to Quick Test
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        {/* Engine selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Inference Engine
          </label>
          <div className="grid grid-cols-3 gap-2">
            {capabilities.map((cap) => (
              <button
                key={cap.engine}
                onClick={() => {
                  setSelectedEngine(cap.engine);
                  setSelectedPreset(0);
                }}
                disabled={!cap.available || status === "loading"}
                className={`relative flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center transition-all ${
                  selectedEngine === cap.engine
                    ? "border-primary/50 bg-primary/10"
                    : cap.available
                    ? "border-border bg-secondary/50 hover:border-muted-foreground/30"
                    : "border-border/50 bg-secondary/20 opacity-50 cursor-not-allowed"
                }`}
              >
                <span className={selectedEngine === cap.engine ? "text-primary" : "text-muted-foreground"}>
                  {ENGINE_ICONS[cap.engine]}
                </span>
                <span className={`text-xs font-mono font-medium ${selectedEngine === cap.engine ? "text-foreground" : "text-muted-foreground"}`}>
                  {ENGINE_LABELS[cap.engine]}
                </span>
                {!cap.available && (
                  <span className="text-[9px] text-destructive font-mono">Unavailable</span>
                )}
                {cap.available && cap.engine === "onnx" && (
                  <span className="text-[9px] text-accent font-mono">iOS ✓</span>
                )}
              </button>
            ))}
          </div>
          {selectedEngine === "onnx" && (
            <p className="text-[10px] text-accent font-mono">
              ⚠ WASM inference is slower than WebGPU. Best for compatibility testing on iOS/Safari.
            </p>
          )}
        </div>

        {/* Model selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Select a model
          </label>
          {engineModels.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 font-mono py-2">
              No preset models for this engine. Paste a custom URL below.
            </p>
          ) : (
            <div className="space-y-2">
              {engineModels.map((model, i) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedPreset(i)}
                  disabled={status === "loading"}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                    selectedPreset === i
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-secondary/50 hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className={`font-mono text-sm ${selectedPreset === i ? "text-foreground" : "text-muted-foreground"}`}>
                      {model.name}
                    </span>
                    <span className="text-xs text-muted-foreground/60 font-mono">{model.size}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground/70">{model.description}</p>
                  {model.vision && (
                    <span className="mt-1 ml-2 inline-flex items-center gap-1 text-[10px] text-primary font-mono">
                      📷 Vision
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom URL */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Or paste a custom {selectedEngine === "webllm" ? "model ID" : "model URL"}
          </label>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder={selectedEngine === "webllm" ? "e.g. Llama-3.2-1B-Instruct-q4f16_1-MLC" : "https://huggingface.co/..."}
            disabled={status === "loading"}
            className="w-full rounded-lg border border-border bg-input px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {/* Progress */}
        {status === "loading" && downloadProgress > 0 && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleLoad}
          disabled={status === "loading" || (engineModels.length === 0 && !customUrl.trim())}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50 glow-primary"
        >
          {status === "loading" ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono text-xs">{statusMessage}</span>
            </span>
          ) : (
            `Load with ${ENGINE_LABELS[selectedEngine]}`
          )}
        </button>

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-mono text-xs">{statusMessage}</span>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground/60">
        {selectedEngine === "onnx"
          ? "ONNX WASM works on all browsers including iOS Safari. Models run 100% locally."
          : "Requires a WebGPU-compatible browser (Chrome 113+). Models run 100% locally."}
      </p>
    </div>
  );
}
