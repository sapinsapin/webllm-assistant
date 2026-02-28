import type { EngineType, InferenceEngine, GenerationResult, InferenceCallbacks } from "./types";
import { createEngine } from "./index";

interface CloudConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  authHeader?: string;
}

export interface HandoffLoadOptions {
  modelUrl: string;
  engineType: EngineType;
  hfToken?: string;
  onProgress: (pct: number, msg: string) => void;
  onBackendChange?: (backend: "cloud" | "local") => void;
}

export class WebGPUHandoffPlugin {
  private localEngine: InferenceEngine | null = null;
  private localReady = false;
  private readonly cloudConfig: CloudConfig | null;

  constructor(cloudConfig?: CloudConfig | null) {
    this.cloudConfig = cloudConfig ?? null;
  }

  get isCloudEnabled(): boolean {
    return !!this.cloudConfig;
  }

  get backend(): "cloud" | "local" {
    if (this.localReady) return "local";
    return this.cloudConfig ? "cloud" : "local";
  }

  async load(options: HandoffLoadOptions): Promise<void> {
    this.localEngine?.unload();
    this.localReady = false;
    this.localEngine = createEngine(options.engineType);

    if (this.cloudConfig) {
      options.onProgress(2, "Cloud fallback ready. Downloading local WebGPU model in background...");
      options.onBackendChange?.("cloud");
      this.loadLocalInBackground(options);
      return;
    }

    await this.loadLocal(options);
    options.onBackendChange?.("local");
  }

  unload(): void {
    this.localEngine?.unload();
    this.localEngine = null;
    this.localReady = false;
  }

  async generateStream(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: InferenceCallbacks,
  ): Promise<void> {
    if (this.backend === "cloud") {
      const response = await this.generateCloud(messages);
      for (const token of response.split(/(\s+)/)) {
        if (token) callbacks.onToken(token);
      }
      callbacks.onComplete();
      return;
    }

    if (!this.localEngine) throw new Error("Local model is not initialized");
    const prompt = this.buildTranscriptPrompt(messages);
    await this.localEngine.generateStream(prompt, callbacks);
  }

  async generateFull(messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<GenerationResult> {
    if (this.backend === "cloud") {
      const start = performance.now();
      const response = await this.generateCloud(messages);
      const end = performance.now();
      const tokenCount = response.split(/\s+/).filter(Boolean).length;
      return {
        response,
        tokenCount,
        timeMs: end - start,
        ttftMs: 0,
        tpotMs: 0,
      };
    }

    if (!this.localEngine) throw new Error("Local model is not initialized");
    const prompt = this.buildTranscriptPrompt(messages);
    return this.localEngine.generateFull(prompt);
  }

  private async loadLocal(options: HandoffLoadOptions): Promise<void> {
    if (!this.localEngine) throw new Error("Local engine is not initialized");
    await this.localEngine.load(options.modelUrl, options.onProgress, options.hfToken);
    this.localReady = true;
    options.onProgress(100, `${this.localEngine.label} ready. Handoff to local inference complete.`);
  }

  private loadLocalInBackground(options: HandoffLoadOptions): void {
    void this.loadLocal(options)
      .then(() => {
        options.onBackendChange?.("local");
      })
      .catch((err) => {
        console.error("Background local model load failed; staying on cloud backend:", err);
        options.onProgress(0, "Local model preload failed; continuing with cloud endpoint.");
      });
  }

  private buildTranscriptPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
    return messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
  }

  private async generateCloud(messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<string> {
    if (!this.cloudConfig) {
      throw new Error("Cloud endpoint is not configured");
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.cloudConfig.apiKey) {
      const authHeader = this.cloudConfig.authHeader ?? "Authorization";
      headers[authHeader] = authHeader.toLowerCase() === "authorization"
        ? `Bearer ${this.cloudConfig.apiKey}`
        : this.cloudConfig.apiKey;
    }

    const response = await fetch(this.cloudConfig.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.cloudConfig.model,
        messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cloud API request failed (${response.status}): ${body}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      output_text?: string;
      response?: string;
    };

    return payload.choices?.[0]?.message?.content ?? payload.output_text ?? payload.response ?? "";
  }
}

export function cloudConfigFromEnv(): CloudConfig | null {
  const endpoint = import.meta.env.VITE_CLOUD_LLM_ENDPOINT as string | undefined;
  const model = import.meta.env.VITE_CLOUD_LLM_MODEL as string | undefined;

  if (!endpoint || !model) return null;

  return {
    endpoint,
    model,
    apiKey: import.meta.env.VITE_CLOUD_LLM_API_KEY as string | undefined,
    authHeader: import.meta.env.VITE_CLOUD_LLM_AUTH_HEADER as string | undefined,
  };
}
