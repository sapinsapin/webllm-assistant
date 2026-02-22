import { Cpu, Loader2, AlertCircle, Settings2 } from "lucide-react";
import type { ModelStatus } from "@/hooks/useLlmInference";
import type { EngineType, EngineCapability } from "@/lib/inference/types";
import { getSmallestModel } from "@/lib/models";

interface QuickStartProps {
  status: ModelStatus;
  statusMessage: string;
  downloadProgress: number;
  activeEngine: EngineType | null;
  capabilities: EngineCapability[];
  onLoadModel: (url: string, name?: string, hfToken?: string, engine?: EngineType) => void;
  onAdvancedMode: () => void;
}

const ENGINE_LABEL: Record<EngineType, string> = {
  mediapipe: "MediaPipe · WebGPU",
  webllm: "WebLLM · WebGPU",
  onnx: "ONNX · WASM",
};

export function QuickStart({
  status,
  statusMessage,
  downloadProgress,
  activeEngine,
  capabilities,
  onLoadModel,
  onAdvancedMode,
}: QuickStartProps) {
  const bestEngine = capabilities.find((c) => c.available)?.engine || "onnx";
  const engine = activeEngine || bestEngine;
  const model = getSmallestModel(engine);

  const handleGo = () => {
    if (!model) return;
    onLoadModel(model.url, model.name, undefined, model.engine);
  };

  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 select-none">
      {/* Logo */}
      <div className="text-center space-y-3">
        <h1 className="text-4xl font-bold tracking-tight font-mono">
          <span className="text-primary glow-text">Edge</span>
          <span className="text-foreground">LLM</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Run AI models entirely in your browser
        </p>
      </div>

      {/* GO button */}
      <button
        onClick={handleGo}
        disabled={isLoading || !model}
        className="group relative flex items-center justify-center"
      >
        {/* Outer ring */}
        <div
          className={`absolute h-44 w-44 rounded-full border-2 transition-all duration-500 ${
            isLoading
              ? "border-primary/30 animate-spin"
              : "border-border group-hover:border-primary/50"
          }`}
          style={
            isLoading
              ? {
                  borderTopColor: "hsl(var(--primary))",
                  animationDuration: "1.5s",
                }
              : undefined
          }
        />

        {/* Progress ring */}
        {isLoading && downloadProgress > 0 && (
          <svg className="absolute h-44 w-44 -rotate-90" viewBox="0 0 176 176">
            <circle
              cx="88"
              cy="88"
              r="86"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * 86}`}
              strokeDashoffset={`${2 * Math.PI * 86 * (1 - downloadProgress / 100)}`}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          </svg>
        )}

        {/* Inner circle */}
        <div
          className={`relative flex h-36 w-36 flex-col items-center justify-center rounded-full border transition-all duration-300 ${
            isLoading
              ? "border-primary/20 bg-primary/5"
              : isError
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:glow-primary cursor-pointer"
          }`}
        >
          {isLoading ? (
            <>
              <span className="text-2xl font-bold font-mono text-primary">
                {downloadProgress > 0 ? `${Math.round(downloadProgress)}%` : "..."}
              </span>
              <span className="mt-1 text-[10px] font-mono text-muted-foreground max-w-[100px] text-center truncate">
                {statusMessage}
              </span>
            </>
          ) : isError ? (
            <>
              <AlertCircle className="h-6 w-6 text-destructive mb-1" />
              <span className="text-xs font-mono text-destructive">Error</span>
            </>
          ) : (
            <>
              <span className="text-3xl font-bold font-mono text-foreground group-hover:text-primary transition-colors">
                GO
              </span>
            </>
          )}
        </div>
      </button>

      {/* Info below button */}
      <div className="text-center space-y-1.5">
        {model && !isLoading && (
          <>
            <p className="text-xs font-mono text-muted-foreground">
              {model.name} · {model.size}
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/60">
              {ENGINE_LABEL[engine]}
            </p>
          </>
        )}
        {isLoading && (
          <p className="text-xs font-mono text-muted-foreground animate-pulse">
            Loading {model?.name}...
          </p>
        )}
        {isError && (
          <p className="text-xs font-mono text-destructive/80 max-w-xs mx-auto">
            {statusMessage}
          </p>
        )}
      </div>

      {/* Advanced mode link */}
      <button
        onClick={onAdvancedMode}
        disabled={isLoading}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
      >
        <Settings2 className="h-3 w-3" />
        Advanced
      </button>
    </div>
  );
}
