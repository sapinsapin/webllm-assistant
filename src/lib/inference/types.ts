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

/** An image attachment for multimodal prompts */
export interface ImageAttachment {
  /** Data URL (base64) or object URL */
  dataUrl: string;
}

/** An audio attachment for multimodal prompts */
export interface AudioAttachment {
  /** Data URL (base64) */
  dataUrl: string;
}

export interface InferenceEngine {
  readonly type: EngineType;
  readonly label: string;
  /** Whether the loaded model supports vision/image input */
  supportsVision?: boolean;

  load(
    modelId: string,
    onProgress: (pct: number, msg: string) => void,
    hfToken?: string,
    options?: { vision?: boolean }
  ): Promise<void>;

  unload(): void;

  generateStream(
    prompt: string,
    callbacks: InferenceCallbacks,
    images?: ImageAttachment[],
    audios?: AudioAttachment[]
  ): Promise<void>;

  generateFull(prompt: string): Promise<GenerationResult>;

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string;
}
