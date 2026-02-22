import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import type { InferenceEngine, InferenceCallbacks, GenerationResult } from "./types";
import { supabase } from "@/integrations/supabase/client";

async function fetchHfToken(): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke("get-hf-token");
    if (error) throw error;
    return data?.token || "";
  } catch {
    return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function downloadWithProgress(
  url: string,
  hfToken: string | null,
  onProgress: (pct: number, msg: string) => void
): Promise<Uint8Array> {
  const token = hfToken || await fetchHfToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Authentication required. This model is gated — you need a HuggingFace token with access."
      );
    }
    if (response.status === 403) {
      const body = await response.text();
      const match = body.match(/Visit (https:\/\/huggingface\.co\/[^\s]+)/);
      const visitUrl = match ? match[1] : url.split("/resolve/")[0];
      throw new Error(
        `Access denied. Visit ${visitUrl} and click "Agree and access repository".`
      );
    }
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const total = parseInt(response.headers.get("content-length") || "0", 10);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported");

  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    const pct = total > 0 ? Math.round((downloaded / total) * 100) : -1;
    const msg = total > 0
      ? `Downloading: ${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`
      : `Downloading: ${formatBytes(downloaded)}`;
    onProgress(Math.max(pct, 0), msg);
  }

  const result = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export class MediaPipeEngine implements InferenceEngine {
  readonly type = "mediapipe" as const;
  readonly label = "MediaPipe (WebGPU)";
  private llm: LlmInference | null = null;

  async load(
    modelUrl: string,
    onProgress: (pct: number, msg: string) => void,
    hfToken?: string
  ): Promise<void> {
    if (!(navigator as any).gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }

    onProgress(0, "Initializing WebGPU runtime...");
    const genai = await FilesetResolver.forGenAiTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
    );

    const buffer = await downloadWithProgress(modelUrl, hfToken || null, onProgress);

    onProgress(100, "Initializing model (may take a minute)...");
    this.llm = await LlmInference.createFromModelBuffer(genai, buffer);
  }

  unload(): void {
    this.llm = null;
  }

  async generateStream(prompt: string, callbacks: InferenceCallbacks): Promise<void> {
    if (!this.llm) throw new Error("Model not loaded");
    await this.llm.generateResponse(prompt, (partial: string, done: boolean) => {
      callbacks.onToken(partial);
      if (done) callbacks.onComplete();
    });
  }

  async generateFull(prompt: string): Promise<GenerationResult> {
    if (!this.llm) throw new Error("Model not loaded");

    const start = performance.now();
    let tokenCount = 0;
    let response = "";
    let firstTokenTime: number | null = null;

    await this.llm.generateResponse(prompt, (partial: string) => {
      if (firstTokenTime === null) firstTokenTime = performance.now();
      response += partial;
      tokenCount++;
    });

    const end = performance.now();
    const timeMs = end - start;
    const ttftMs = firstTokenTime !== null ? firstTokenTime - start : timeMs;
    const tpotMs = tokenCount > 1 ? (timeMs - ttftMs) / (tokenCount - 1) : 0;

    return { response, tokenCount, timeMs, ttftMs, tpotMs };
  }

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
    return (
      messages
        .map((m) =>
          m.role === "user"
            ? `<start_of_turn>user\n${m.content}<end_of_turn>`
            : `<start_of_turn>model\n${m.content}<end_of_turn>`
        )
        .join("\n") + "\n<start_of_turn>model\n"
    );
  }
}
