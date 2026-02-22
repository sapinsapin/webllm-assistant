import { pipeline, TextStreamer, env } from "@huggingface/transformers";
import type { InferenceEngine, InferenceCallbacks, GenerationResult } from "./types";

/**
 * Transformers.js engine — WASM-based fallback for browsers without WebGPU.
 *
 * Uses @huggingface/transformers with ONNX models (e.g. onnx-community/Qwen3-0.6B-ONNX).
 * Works on ALL browsers including iOS Safari via WASM backend.
 */
export class OnnxEngine implements InferenceEngine {
  readonly type = "onnx" as const;
  readonly label = "Transformers.js (WASM)";
  private generator: any = null;

  async load(
    modelId: string,
    onProgress: (pct: number, msg: string) => void
  ): Promise<void> {
    onProgress(0, "Configuring Transformers.js...");

    // Disable local model caching to avoid issues in some browsers
    env.allowLocalModels = false;

    onProgress(5, "Downloading model files...");

    this.generator = await pipeline("text-generation", modelId, {
      dtype: "q4",
      device: "wasm",
      progress_callback: (progress: any) => {
        if (progress.status === "download" || progress.status === "progress") {
          const pct = Math.round((progress.progress || 0));
          const file = progress.file || "";
          onProgress(Math.min(5 + pct * 0.9, 95), `Downloading ${file}: ${pct}%`);
        } else if (progress.status === "done") {
          onProgress(95, "Initializing model...");
        } else if (progress.status === "ready") {
          onProgress(100, "Model ready");
        }
      },
    });

    onProgress(100, "Model ready");
  }

  unload(): void {
    if (this.generator) {
      this.generator.dispose?.();
      this.generator = null;
    }
  }

  async generateStream(prompt: string, callbacks: InferenceCallbacks): Promise<void> {
    if (!this.generator) throw new Error("Model not loaded");

    const streamer = new TextStreamer(this.generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        callbacks.onToken(text);
      },
    });

    await this.generator(prompt, {
      max_new_tokens: 512,
      temperature: 0.7,
      do_sample: true,
      streamer,
    });

    callbacks.onComplete();
  }

  async generateFull(prompt: string): Promise<GenerationResult> {
    if (!this.generator) throw new Error("Model not loaded");

    const start = performance.now();
    let firstTokenTime: number | null = null;
    let tokenCount = 0;

    const streamer = new TextStreamer(this.generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: () => {
        if (firstTokenTime === null) firstTokenTime = performance.now();
        tokenCount++;
      },
    });

    const output = await this.generator(prompt, {
      max_new_tokens: 512,
      temperature: 0.7,
      do_sample: true,
      streamer,
    });

    const end = performance.now();
    const timeMs = end - start;
    const ttftMs = firstTokenTime ? firstTokenTime - start : timeMs;

    // Extract generated text (remove the prompt)
    const fullText = output?.[0]?.generated_text || "";
    const response = typeof fullText === "string"
      ? fullText.slice(prompt.length).trim()
      : String(fullText);

    return {
      response,
      tokenCount: Math.max(tokenCount, 1),
      timeMs,
      ttftMs,
      tpotMs: tokenCount > 1 ? (timeMs - ttftMs) / (tokenCount - 1) : 0,
    };
  }

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
    // Use ChatML format for Qwen3
    return messages
      .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`)
      .join("\n") + "\n<|im_start|>assistant\n";
  }
}
