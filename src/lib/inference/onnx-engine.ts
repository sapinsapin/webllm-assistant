import * as ort from "onnxruntime-web";
import type { InferenceEngine, InferenceCallbacks, GenerationResult } from "./types";

/**
 * ONNX Runtime Web engine — WASM-based fallback for browsers without WebGPU.
 * 
 * This engine uses ONNX Runtime Web with the WASM execution provider,
 * which works on ALL browsers including iOS Safari.
 * 
 * Note: LLM inference on CPU/WASM is significantly slower than WebGPU.
 * This is a compatibility fallback, not a performance option.
 * 
 * Compatible with ONNX-exported transformer models (e.g. from Optimum).
 */
export class OnnxEngine implements InferenceEngine {
  readonly type = "onnx" as const;
  readonly label = "ONNX Runtime (WASM)";
  private session: ort.InferenceSession | null = null;
  private tokenizer: SimpleTokenizer | null = null;

  async load(
    modelUrl: string,
    onProgress: (pct: number, msg: string) => void
  ): Promise<void> {
    onProgress(0, "Configuring ONNX Runtime (WASM)...");

    // Force WASM backend for maximum compatibility
    ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 2, 4);

    onProgress(10, "Downloading ONNX model...");

    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Failed to download model: ${response.status}`);

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
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100);
        const mb = (downloaded / (1024 * 1024)).toFixed(1);
        const totalMb = (total / (1024 * 1024)).toFixed(1);
        onProgress(pct, `Downloading: ${mb} / ${totalMb} MB (${pct}%)`);
      }
    }

    const buffer = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    onProgress(90, "Initializing ONNX session...");
    this.session = await ort.InferenceSession.create(buffer.buffer, {
      executionProviders: ["wasm"],
    });

    // Initialize a basic tokenizer (word-level splitting as fallback)
    this.tokenizer = new SimpleTokenizer();

    onProgress(100, "ONNX model ready");
  }

  unload(): void {
    this.session?.release();
    this.session = null;
    this.tokenizer = null;
  }

  async generateStream(prompt: string, callbacks: InferenceCallbacks): Promise<void> {
    // ONNX models typically do single-pass inference, not streaming
    // We simulate streaming by yielding the full response
    const result = await this.generateFull(prompt);
    callbacks.onToken(result.response);
    callbacks.onComplete();
  }

  async generateFull(prompt: string): Promise<GenerationResult> {
    if (!this.session || !this.tokenizer) throw new Error("Model not loaded");

    const start = performance.now();

    // Tokenize input
    const inputIds = this.tokenizer.encode(prompt);
    const inputTensor = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
    const attentionMask = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(() => 1n)), [1, inputIds.length]);

    const feeds: Record<string, ort.Tensor> = {
      input_ids: inputTensor,
      attention_mask: attentionMask,
    };

    const firstTokenTime = performance.now();
    const results = await this.session.run(feeds);

    const end = performance.now();

    // Extract output — format depends on model architecture
    const outputKey = Object.keys(results)[0];
    const outputData = results[outputKey];
    
    // Attempt to decode logits into text
    let response = "";
    let tokenCount = 1;

    if (outputData) {
      const data = outputData.data as Float32Array;
      // For causal LM: take argmax of last token's logits
      const vocabSize = outputData.dims[outputData.dims.length - 1];
      const lastTokenLogits = data.slice(-vocabSize);
      const maxIdx = lastTokenLogits.indexOf(Math.max(...lastTokenLogits));
      response = this.tokenizer.decode([maxIdx]);
      tokenCount = 1;
    }

    const timeMs = end - start;
    const ttftMs = firstTokenTime - start;

    return {
      response,
      tokenCount,
      timeMs,
      ttftMs,
      tpotMs: 0,
    };
  }

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
    return messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
  }
}

/**
 * Minimal tokenizer fallback. For production use, load the model's
 * actual tokenizer.json alongside the ONNX model.
 */
class SimpleTokenizer {
  encode(text: string): number[] {
    // Very basic word-level encoding — real usage needs a proper tokenizer
    return text.split(/\s+/).map((_, i) => i + 1);
  }

  decode(ids: number[]): string {
    return `[token:${ids.join(",")}]`;
  }
}
