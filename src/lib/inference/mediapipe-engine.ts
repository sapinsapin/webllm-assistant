import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import type { InferenceEngine, InferenceCallbacks, GenerationResult, ImageAttachment } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Browsers typically cannot allocate extremely large contiguous ArrayBuffers (often ~2GB-ish).
// For models below this limit, we download into a buffer for progress tracking.
// For models above it, we use modelAssetPath to let MediaPipe's WASM stream directly to GPU.
const MAX_MODEL_ARRAYBUFFER_BYTES = Math.floor(1.9 * 1024 * 1024 * 1024);

const FORCE_STREAMING_MODEL_HINTS = [".litertlm", "-4b-", "gemma-3n-e2b", "gemma-3n-e4b"];

function shouldForceStreamingLoader(modelUrl: string): boolean {
  const lower = modelUrl.toLowerCase();
  return FORCE_STREAMING_MODEL_HINTS.some((hint) => lower.includes(hint));
}

/** Send the HF token to the service worker so it can inject auth headers on fetch */
async function sendTokenToServiceWorker(token: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const sendWithAck = (worker: ServiceWorker | null | undefined): Promise<void> => {
    if (!worker) return Promise.resolve();

    return new Promise((resolve) => {
      const channel = new MessageChannel();
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 800);

      channel.port1.onmessage = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
      };

      try {
        worker.postMessage({ type: "SET_HF_TOKEN", token }, [channel.port2]);
      } catch {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  };

  const registration = await navigator.serviceWorker.ready;
  await Promise.all([
    sendWithAck(navigator.serviceWorker.controller),
    sendWithAck(registration.active),
    sendWithAck(registration.waiting),
    sendWithAck(registration.installing),
  ]);
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
      throw new Error(
        "Access denied — this model requires license acceptance. The server account may not have accepted the model's EULA yet. Please contact the site administrator."
      );
    }
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const total = parseInt(response.headers.get("content-length") || "0", 10);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported");

  if (total > MAX_MODEL_ARRAYBUFFER_BYTES) {
    onProgress(
      0,
      `Model file is ${formatBytes(total)} — too large to hold in a single browser buffer.`
    );
    throw new Error(
      `Model file (${formatBytes(total)}) is too large for in-browser loading (ArrayBuffer allocation limit). Please choose a smaller model.`
    );
  }

  // Pre-allocate a single buffer if we know the size, avoiding chunk array + copy duplication
  if (total > 0) {
    const result = new Uint8Array(total);
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result.set(value, downloaded);
      downloaded += value.length;
      const pct = Math.round((downloaded / total) * 100);
      onProgress(pct, `Downloading: ${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`);
    }

    return result;
  }

  // Fallback for unknown size: collect chunks then merge
  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (downloaded > MAX_MODEL_ARRAYBUFFER_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(
        `Model download exceeded ${formatBytes(MAX_MODEL_ARRAYBUFFER_BYTES)} — too large for in-browser loading. Please choose a smaller model.`
      );
    }
    onProgress(0, `Downloading: ${formatBytes(downloaded)}`);
  }

  const result = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  // Release chunk references immediately
  chunks.length = 0;

  return result;
}

export class MediaPipeEngine implements InferenceEngine {
  readonly type = "mediapipe" as const;
  readonly label = "MediaPipe (WebGPU)";
  private llm: LlmInference | null = null;
  supportsVision = false;

  /** Mutex: ensures only one generateResponse runs at a time */
  private pending: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.pending.then(() => fn(), () => fn());
    this.pending = next.catch(() => {});
    return next;
  }

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

    const isVision = options?.vision === true;

    // Determine if the model is too large for JS ArrayBuffer download
    // by doing a HEAD request first to check Content-Length
    let usePath = false;
    const token = hfToken || (await fetchServerHfToken());

    try {
      const headHeaders: Record<string, string> = {};
      if (token) headHeaders.Authorization = `Bearer ${token}`;

      // Send token to service worker for auth injection on modelAssetPath fetches.
      // Do this before we decide the loading path so streaming fetches are always authorized.
      if (token) {
        await sendTokenToServiceWorker(token);
      }

      const headRes = await fetch(modelUrl, { method: "HEAD", headers: headHeaders });
      if (headRes.ok) {
        const contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_MODEL_ARRAYBUFFER_BYTES) {
          usePath = true;
          onProgress(0, `Model is ${formatBytes(contentLength)} — using streaming loader to avoid memory limits...`);
        }
      }
    } catch {
      // HEAD failed — fall through to buffer download
    }

    // Some hosts/models don't return content-length on HEAD; avoid risky buffer downloads
    // for known large formats/models.
    if (!usePath && shouldForceStreamingLoader(modelUrl)) {
      usePath = true;
      onProgress(0, "Using streaming loader for large model format...");
    }

    if (usePath) {
      // Use modelAssetPath: MediaPipe WASM streams the model directly to GPU
      // without allocating a single contiguous JS ArrayBuffer
      onProgress(50, "Loading model via streaming path (no progress available)...");
      try {
        // Re-send token immediately before streaming load to avoid first-load SW races.
        if (token) {
          await sendTokenToServiceWorker(token);
        }

        this.llm = await (LlmInference as any).createFromOptions(genai, {
          baseOptions: {
            modelAssetPath: modelUrl,
          },
          ...(isVision
            ? { maxTokens: 2048, maxNumImages: 5, topK: 40, temperature: 0.8, randomSeed: 101 }
            : {}),
        });
        this.supportsVision = isVision;
      } catch (err: any) {
        throw new Error(`Failed to load model via streaming path: ${err?.message || err}`);
      }
    } else {
      // Standard buffer download with progress tracking
      let buffer: Uint8Array | null = await downloadWithProgress(modelUrl, token || null, onProgress);
      onProgress(100, "Initializing model (may take a minute)...");

      try {
        if (isVision) {
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
      } finally {
        buffer = null;
      }
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
      // Convert data-URL images to blob object URLs that MediaPipe can fetch
      const blobUrls: string[] = [];
      const toObjectUrl = (dataUrl: string): string => {
        const [header, b64] = dataUrl.split(",");
        const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        blobUrls.push(url);
        return url;
      };

      // Build multimodal prompt array for vision models
      const multimodalInput: any[] = [];
      multimodalInput.push("<start_of_turn>user\n");
      for (const img of images) {
        const objectUrl = toObjectUrl(img.dataUrl);
        multimodalInput.push({ imageSource: objectUrl });
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

      try {
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
      } finally {
        // Release blob URLs to free memory
        blobUrls.forEach((u) => URL.revokeObjectURL(u));
      }
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
