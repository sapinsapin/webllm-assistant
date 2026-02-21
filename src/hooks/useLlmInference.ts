import { useState, useRef, useCallback } from "react";
import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BenchmarkResult {
  modelName: string;
  prompt: string;
  category: string;
  tokensGenerated: number;
  timeMs: number;
  tokensPerSecond: number;
  ttftMs: number;          // Time to first token
  tpotMs: number;          // Time per output token (excluding first)
  response: string;
}

async function downloadModelWithProgress(
  url: string,
  hfToken: string | null,
  onProgress: (pct: number, downloaded: number, total: number) => void
): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (hfToken) {
    headers["Authorization"] = `Bearer ${hfToken}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Authentication required. This model is gated — you need a HuggingFace token with access. " +
        "Go to huggingface.co, accept the model's terms, then create a read token at huggingface.co/settings/tokens."
      );
    }
    if (response.status === 403) {
      const body = await response.text();
      const match = body.match(/Visit (https:\/\/huggingface\.co\/[^\s]+)/);
      const visitUrl = match ? match[1] : url.split("/resolve/")[0];
      throw new Error(
        `Access denied. You need to request access to this model first.\n\n` +
        `1. Visit: ${visitUrl}\n` +
        `2. Click "Agree and access repository"\n` +
        `3. Wait for approval, then try again.`
      );
    }
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
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
      onProgress(Math.round((downloaded / total) * 100), downloaded, total);
    } else {
      onProgress(-1, downloaded, 0);
    }
  }

  const result = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function useLlmInference() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentModelName, setCurrentModelName] = useState("");
  const llmRef = useRef<LlmInference | null>(null);

  const loadModel = useCallback(async (modelUrl: string, modelName?: string, hfToken?: string) => {
    try {
      setStatus("loading");
      setDownloadProgress(0);
      setStatusMessage("Initializing WebGPU runtime...");
      setCurrentModelName(modelName || modelUrl.split("/").pop() || "Unknown");

      if (!(navigator as any).gpu) {
        throw new Error("WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.");
      }

      const genai = await FilesetResolver.forGenAiTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
      );

      setStatusMessage("Downloading model...");

      const modelBuffer = await downloadModelWithProgress(
        modelUrl,
        hfToken || null,
        (pct, downloaded, total) => {
          setDownloadProgress(Math.max(pct, 0));
          if (total > 0) {
            setStatusMessage(`Downloading model: ${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`);
          } else {
            setStatusMessage(`Downloading model: ${formatBytes(downloaded)}`);
          }
        }
      );

      setStatusMessage("Initializing model (may take a minute)...");
      setDownloadProgress(100);

      llmRef.current = await LlmInference.createFromModelBuffer(genai, modelBuffer);

      setStatus("ready");
      setStatusMessage("Model loaded successfully");
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to load model";
      setStatusMessage(msg);
      setDownloadProgress(0);
      console.error("LLM load error:", err);
    }
  }, []);

  const unloadModel = useCallback(() => {
    llmRef.current = null;
    setStatus("idle");
    setStatusMessage("");
    setMessages([]);
    setCurrentModelName("");
    setDownloadProgress(0);
  }, []);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!llmRef.current || isGenerating) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);
    setIsGenerating(true);

    const prompt = newMessages
      .map((m) =>
        m.role === "user"
          ? `<start_of_turn>user\n${m.content}<end_of_turn>`
          : `<start_of_turn>model\n${m.content}<end_of_turn>`
      )
      .join("\n") + "\n<start_of_turn>model\n";

    try {
      let fullResponse = "";
      setMessages([...newMessages, { role: "assistant", content: "" }]);

      await llmRef.current.generateResponse(
        prompt,
        (partialResult: string, done: boolean) => {
          fullResponse += partialResult;
          setMessages([
            ...newMessages,
            { role: "assistant", content: fullResponse },
          ]);
          if (done) {
            setIsGenerating(false);
          }
        }
      );
    } catch (err: unknown) {
      console.error("Generation error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Error generating response: " + msg },
      ]);
      setIsGenerating(false);
    }
  }, [messages, isGenerating]);

  const runBenchmarkPrompt = useCallback(async (promptText: string, category: string = "general"): Promise<BenchmarkResult | null> => {
    if (!llmRef.current) return null;

    const fullPrompt = `<start_of_turn>user\n${promptText}<end_of_turn>\n<start_of_turn>model\n`;
    const startTime = performance.now();
    let tokenCount = 0;
    let fullResponse = "";
    let firstTokenTime: number | null = null;

    try {
      await llmRef.current.generateResponse(
        fullPrompt,
        (partialResult: string, done: boolean) => {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
          }
          fullResponse += partialResult;
          tokenCount++;
        }
      );

      const endTime = performance.now();
      const timeMs = endTime - startTime;
      const ttftMs = firstTokenTime !== null ? firstTokenTime - startTime : timeMs;
      const decodingTimeMs = timeMs - ttftMs;
      const tpotMs = tokenCount > 1 ? decodingTimeMs / (tokenCount - 1) : 0;

      return {
        modelName: currentModelName,
        prompt: promptText,
        category,
        tokensGenerated: tokenCount,
        timeMs,
        tokensPerSecond: tokenCount / (timeMs / 1000),
        ttftMs,
        tpotMs,
        response: fullResponse,
      };
    } catch (err) {
      console.error("Benchmark error:", err);
      return null;
    }
  }, [currentModelName]);

  return {
    status, statusMessage, downloadProgress, messages, isGenerating, currentModelName,
    loadModel, unloadModel, sendMessage, runBenchmarkPrompt,
  };
}
