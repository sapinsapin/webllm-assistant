import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import type { InferenceEngine, InferenceCallbacks, GenerationResult, ImageAttachment } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function fetchServerHfToken(): Promise<string | null> {
  try {
    const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-hf-token`;
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!res.ok) return null;
    const { token } = await res.json();
    return token || null;
  } catch {
    return null;
  }
}

async function downloadWithProgress(
  url: string,
  hfToken: string | null,
  onProgress: (pct: number, msg: string) => void
): Promise<Uint8Array> {
  let token = hfToken;
  if (!token) {
    token = await fetchServerHfToken();
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

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
  supportsVision = false;

  async load(
    modelUrl: string,
    onProgress: (pct: number, msg: string) => void,
    hfToken?: string,
    options?: { vision?: boolean }
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

    const isVision = options?.vision === true;

    if (isVision) {
      // Use createFromOptions for vision models with maxNumImages
      this.llm = await (LlmInference as any).createFromOptions(genai, {
        baseOptions: {
          modelAssetBuffer: buffer,
        },
        maxTokens: 2048,
        maxNumImages: 5,
        topK: 40,
        temperature: 0.8,
        randomSeed: 101,
      });
      this.supportsVision = true;
    } else {
      this.llm = await LlmInference.createFromModelBuffer(genai, buffer);
      this.supportsVision = false;
    }
  }

  unload(): void {
    this.llm = null;
    this.supportsVision = false;
  }

  async generateStream(
    prompt: string,
    callbacks: InferenceCallbacks,
    images?: ImageAttachment[]
  ): Promise<void> {
    if (!this.llm) throw new Error("Model not loaded");

    if (this.supportsVision && images && images.length > 0) {
      // Build multimodal prompt array for vision models
      const multimodalInput: any[] = [];
      multimodalInput.push("<start_of_turn>user\n");
      for (const img of images) {
        multimodalInput.push({ imageSource: img.dataUrl });
        multimodalInput.push("\n");
      }
      // Extract the user text from the formatted prompt (after the last user turn marker)
      const userTextMatch = prompt.match(/<start_of_turn>user\n([\s\S]*?)<end_of_turn>/g);
      const lastUserText = userTextMatch
        ? userTextMatch[userTextMatch.length - 1]
            .replace("<start_of_turn>user\n", "")
            .replace("<end_of_turn>", "")
        : prompt;
      multimodalInput.push(lastUserText);
      multimodalInput.push("<end_of_turn>\n<start_of_turn>model\n");

      await new Promise<void>((resolve, reject) => {
        try {
          (this.llm as any).generateResponse(multimodalInput, (partial: string, done: boolean) => {
            callbacks.onToken(partial);
            if (done) {
              callbacks.onComplete();
              resolve();
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        try {
          this.llm!.generateResponse(prompt, (partial: string, done: boolean) => {
            callbacks.onToken(partial);
            if (done) {
              callbacks.onComplete();
              resolve();
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    }
  }

  async generateFull(prompt: string): Promise<GenerationResult> {
    if (!this.llm) throw new Error("Model not loaded");

    const start = performance.now();
    let tokenCount = 0;
    let response = "";
    let firstTokenTime: number | null = null;

    await new Promise<void>((resolve, reject) => {
      try {
        this.llm!.generateResponse(prompt, (partial: string, done: boolean) => {
          if (firstTokenTime === null) firstTokenTime = performance.now();
          response += partial;
          tokenCount++;
          if (done) resolve();
        });
      } catch (err) {
        reject(err);
      }
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
