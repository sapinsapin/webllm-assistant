import type { InferenceEngine } from "@/lib/inference";

export type ConversationRole = "system" | "user" | "assistant";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export interface StreamHandlers {
  onToken?: (token: string) => void;
  onComplete?: (fullResponse: string) => void;
}

export interface LocalModelProgress {
  progress: number;
  message: string;
}

export interface LlmProvider {
  generateStream(
    messages: ConversationMessage[],
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<string>;
}

export interface HandoffLocalProvider extends LlmProvider {
  load(modelId: string, onProgress: (progress: LocalModelProgress) => void): Promise<void>;
  unload?(): void;
}

export interface HandoffConfig {
  localModelId: string;
  autoSwitchToLocal?: boolean;
  onStatusChange?: (status: HandoffStatus) => void;
  onLocalModelProgress?: (progress: LocalModelProgress) => void;
}

export type HandoffMode = "cloud" | "local";

export interface HandoffStatus {
  mode: HandoffMode;
  localModelState: "idle" | "loading" | "ready" | "error";
  cloudRequests: number;
  localRequests: number;
  error?: string;
}

const defaultStatus: HandoffStatus = {
  mode: "cloud",
  localModelState: "idle",
  cloudRequests: 0,
  localRequests: 0,
};

/**
 * Keeps one shared message history while routing generation to cloud first and
 * moving to WebGPU/local once the checkpoint finishes downloading.
 */
export class HybridLlmHandoff {
  private readonly cloudProvider: LlmProvider;
  private readonly localProvider: HandoffLocalProvider;
  private readonly config: Required<Omit<HandoffConfig, "localModelId">> & Pick<HandoffConfig, "localModelId">;

  private status: HandoffStatus = { ...defaultStatus };
  private history: ConversationMessage[] = [];
  private localLoadTask: Promise<void> | null = null;

  constructor(cloudProvider: LlmProvider, localProvider: HandoffLocalProvider, config: HandoffConfig) {
    this.cloudProvider = cloudProvider;
    this.localProvider = localProvider;
    this.config = {
      localModelId: config.localModelId,
      autoSwitchToLocal: config.autoSwitchToLocal ?? true,
      onStatusChange: config.onStatusChange ?? (() => undefined),
      onLocalModelProgress: config.onLocalModelProgress ?? (() => undefined),
    };
  }

  getStatus(): HandoffStatus {
    return { ...this.status };
  }

  getHistory(): ConversationMessage[] {
    return [...this.history];
  }

  setHistory(messages: ConversationMessage[]): void {
    this.history = [...messages];
  }

  async start(): Promise<void> {
    if (this.localLoadTask) {
      await this.localLoadTask;
      return;
    }

    this.patchStatus({ localModelState: "loading" });

    this.localLoadTask = this.localProvider
      .load(this.config.localModelId, (progress) => {
        this.config.onLocalModelProgress(progress);
      })
      .then(() => {
        this.patchStatus({
          localModelState: "ready",
          mode: this.config.autoSwitchToLocal ? "local" : this.status.mode,
          error: undefined,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown local model load error";
        this.patchStatus({ localModelState: "error", error: message, mode: "cloud" });
      });

    await this.localLoadTask;
  }

  startBackgroundLoad(): void {
    void this.start();
  }

  async sendUserMessage(content: string, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<string> {
    const userMessage: ConversationMessage = { role: "user", content };
    this.history = [...this.history, userMessage];

    const provider = this.status.mode === "local" ? this.localProvider : this.cloudProvider;
    const currentMessages = [...this.history];

    const response = await provider.generateStream(
      currentMessages,
      {
        onToken: handlers.onToken,
        onComplete: handlers.onComplete,
      },
      signal
    );

    this.history = [...this.history, { role: "assistant", content: response }];

    this.patchStatus({
      cloudRequests: this.status.cloudRequests + (provider === this.cloudProvider ? 1 : 0),
      localRequests: this.status.localRequests + (provider === this.localProvider ? 1 : 0),
    });

    return response;
  }

  forceLocalMode(): void {
    if (this.status.localModelState !== "ready") {
      throw new Error("Local model is not ready yet");
    }
    this.patchStatus({ mode: "local" });
  }

  forceCloudMode(): void {
    this.patchStatus({ mode: "cloud" });
  }

  dispose(): void {
    this.localProvider.unload?.();
  }

  private patchStatus(partial: Partial<HandoffStatus>): void {
    this.status = {
      ...this.status,
      ...partial,
    };
    this.config.onStatusChange(this.getStatus());
  }
}

export interface CloudEndpointConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
}

/**
 * OpenAI-compatible cloud endpoint adapter.
 */
export function createCloudEndpointProvider(config: CloudEndpointConfig): LlmProvider {
  return {
    async generateStream(messages, handlers, signal) {
      const response = await fetch(config.endpoint, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          ...config.headers,
        },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          messages,
        }),
      });

      if (!response.ok) {
        throw new Error(`Cloud request failed (${response.status})`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const text = payload.choices?.[0]?.message?.content ?? "";
      handlers.onToken?.(text);
      handlers.onComplete?.(text);
      return text;
    },
  };
}

/**
 * Wraps an existing local inference engine (e.g. WebLLM WebGPU engine).
 */
export function createLocalEngineProvider(engine: InferenceEngine): HandoffLocalProvider {
  return {
    async load(modelId, onProgress) {
      await engine.load(modelId, (progress, message) => {
        onProgress({ progress, message });
      });
    },
    unload() {
      engine.unload();
    },
    async generateStream(messages, handlers) {
      const prompt = engine.formatPrompt(
        messages.filter((msg): msg is { role: "user" | "assistant"; content: string } => msg.role !== "system")
      );

      let output = "";
      await engine.generateStream(prompt, {
        onToken: (token) => {
          output += token;
          handlers.onToken?.(token);
        },
        onComplete: () => {
          handlers.onComplete?.(output);
        },
      });

      return output;
    },
  };
}
