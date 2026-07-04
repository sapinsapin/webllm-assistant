import * as webllm from "@mlc-ai/web-llm";
import type { InferenceEngine, InferenceCallbacks, GenerationResult } from "./types";

export class WebLLMEngine implements InferenceEngine {
  readonly type = "webllm" as const;
  readonly label = "WebLLM (WebGPU)";
  private engine: webllm.MLCEngineInterface | null = null;

  async load(
    modelId: string,
    onProgress: (pct: number, msg: string) => void
  ): Promise<void> {
    const initCallback = (report: webllm.InitProgressReport) => {
      const pct = Math.round((report.progress ?? 0) * 100);
      onProgress(pct, report.text);
    };

    this.engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initCallback,
    });
  }

  unload(): void {
    this.engine = null;
  }

  async generateStream(prompt: string, callbacks: InferenceCallbacks): Promise<void> {
    if (!this.engine) throw new Error("Model not loaded");

    const chunks = await this.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) callbacks.onToken(delta);
    }
    callbacks.onComplete();
  }

  async generateFull(prompt: string): Promise<GenerationResult> {
    if (!this.engine) throw new Error("Model not loaded");

    const start = performance.now();
    let firstTokenTime: number | null = null;
    let response = "";
    let tokenCount = 0;

    const chunks = await this.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for await (const chunk of chunks) {
      if (firstTokenTime === null) firstTokenTime = performance.now();
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        response += delta;
        tokenCount++;
      }
    }

    const end = performance.now();
    const timeMs = end - start;
    const ttftMs = firstTokenTime !== null ? firstTokenTime - start : timeMs;
    const tpotMs = tokenCount > 1 ? (timeMs - ttftMs) / (tokenCount - 1) : 0;

    return { response, tokenCount, timeMs, ttftMs, tpotMs };
  }

  formatPrompt(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
    // The MLC engine does NOT retain history between chat.completions.create
    // calls (each call sends a fresh messages array), so the full conversation
    // must be serialized into the single user turn we send.
    if (messages.length <= 1) return messages[0]?.content ?? "";
    const transcript = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    return `Continue this conversation as the Assistant. Reply with the Assistant's next message only.\n\n${transcript}\n\nAssistant:`;
  }
}
