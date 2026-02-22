export type EngineType = "mediapipe" | "webllm" | "onnx";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineCapability {
  engine: EngineType;
  label: string;
  available: boolean;
  reason?: string;
  priority: number; // lower = preferred
}

export interface InferenceCallbacks {
  onToken: (token: string) => void;
  onComplete: () => void;
}

export interface GenerationResult {
  response: string;
  tokenCount: number;
  timeMs: number;
  ttftMs: number;
  tpotMs: number;
}

export interface InferenceEngine {
  readonly type: EngineType;
  readonly label: string;

  load(
    modelId: string,
    onProgress: (pct: number, msg: string) => void,
    hfToken?: string
  ): Promise<void>;

  unload(): void;

  generateStream(
    prompt: string,
    callbacks: InferenceCallbacks
  ): Promise<void>;

  generateFull(prompt: string): Promise<GenerationResult>;

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string;
}
