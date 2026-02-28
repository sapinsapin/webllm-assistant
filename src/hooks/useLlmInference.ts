import { useState, useRef, useCallback, useEffect } from "react";
import {
  type EngineType,
  type EngineCapability,
  detectCapabilities,
  getBestEngine,
} from "@/lib/inference";
import { WebGPUHandoffPlugin, cloudConfigFromEnv } from "@/lib/inference/webgpu-handoff-plugin";

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
  ttftMs: number;
  tpotMs: number;
  response: string;
}

export function useLlmInference() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentModelName, setCurrentModelName] = useState("");
  const [activeEngine, setActiveEngine] = useState<EngineType | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapability[]>([]);
  const [activeBackend, setActiveBackend] = useState<"cloud" | "local">("local");

  const pluginRef = useRef<WebGPUHandoffPlugin>(new WebGPUHandoffPlugin(cloudConfigFromEnv()));

  // Detect capabilities on mount
  useEffect(() => {
    detectCapabilities().then((caps) => {
      setCapabilities(caps);
      const best = getBestEngine(caps);
      setActiveEngine(best);
    });
  }, []);

  const loadModel = useCallback(
    async (modelUrl: string, modelName?: string, hfToken?: string, engineOverride?: EngineType) => {
      try {
        const engineType = engineOverride || activeEngine || "mediapipe";
        setStatus("loading");
        setDownloadProgress(0);
        setCurrentModelName(modelName || modelUrl.split("/").pop() || "Unknown");

        setActiveEngine(engineType);
        setActiveBackend("local");

        setStatusMessage("Preparing handoff plugin...");
        await pluginRef.current.load({
          modelUrl,
          engineType,
          hfToken,
          onProgress: (pct, msg) => {
          setDownloadProgress(Math.max(pct, 0));
          setStatusMessage(msg);
          },
          onBackendChange: setActiveBackend,
        });

        setStatus("ready");
        setStatusMessage(pluginRef.current.isCloudEnabled
          ? "Cloud backend active while WebGPU model preloads in background"
          : "Local model loaded");
      } catch (err: unknown) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : "Failed to load model";
        setStatusMessage(msg);
        setDownloadProgress(0);
        console.error("LLM load error:", err);
      }
    },
    [activeEngine]
  );

  const unloadModel = useCallback(() => {
    pluginRef.current.unload();
    setStatus("idle");
    setStatusMessage("");
    setMessages([]);
    setCurrentModelName("");
    setDownloadProgress(0);
    setActiveBackend("local");
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (isGenerating) return;

      const newMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: userMessage },
      ];
      setMessages(newMessages);
      setIsGenerating(true);

      try {
        let fullResponse = "";
        setMessages([...newMessages, { role: "assistant", content: "" }]);

        await pluginRef.current.generateStream(newMessages, {
          onToken: (token) => {
            fullResponse += token;
            setMessages([
              ...newMessages,
              { role: "assistant", content: fullResponse },
            ]);
          },
          onComplete: () => {
            setIsGenerating(false);
          },
        });
      } catch (err: unknown) {
        console.error("Generation error:", err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages([
          ...newMessages,
          { role: "assistant", content: "Error generating response: " + msg },
        ]);
        setIsGenerating(false);
      }
    },
    [messages, isGenerating]
  );

  const runBenchmarkPrompt = useCallback(
    async (promptText: string, category: string = "general"): Promise<BenchmarkResult | null> => {
      const benchmarkMessages: ChatMessage[] = [{ role: "user", content: promptText }];

      try {
        const result = await pluginRef.current.generateFull(benchmarkMessages);

        return {
          modelName: currentModelName,
          prompt: promptText,
          category,
          tokensGenerated: result.tokenCount,
          timeMs: result.timeMs,
          tokensPerSecond: result.tokenCount / (result.timeMs / 1000),
          ttftMs: result.ttftMs,
          tpotMs: result.tpotMs,
          response: result.response,
        };
      } catch (err) {
        console.error("Benchmark error:", err);
        return null;
      }
    },
    [currentModelName]
  );

  /** Run a prompt with prepended context (long context benchmark) */
  const runLongContextBenchmark = useCallback(
    async (promptText: string, context: string, category: string = "long_context"): Promise<BenchmarkResult | null> => {
      const combinedPrompt = `${context}\n\n${promptText}`;
      const benchmarkMessages: ChatMessage[] = [{ role: "user", content: combinedPrompt }];

      try {
        const result = await pluginRef.current.generateFull(benchmarkMessages);
        return {
          modelName: currentModelName,
          prompt: promptText,
          category,
          tokensGenerated: result.tokenCount,
          timeMs: result.timeMs,
          tokensPerSecond: result.tokenCount / (result.timeMs / 1000),
          ttftMs: result.ttftMs,
          tpotMs: result.tpotMs,
          response: result.response,
        };
      } catch (err) {
        console.error("Long context benchmark error:", err);
        return null;
      }
    },
    [currentModelName]
  );

  /** Run a multi-turn conversation and return aggregate result */
  const runMultiTurnBenchmark = useCallback(
    async (turns: string[], category: string = "multi_turn"): Promise<BenchmarkResult | null> => {
      try {
        const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
        let totalTokens = 0;
        let totalTimeMs = 0;
        let firstTtft = 0;
        const tpots: number[] = [];
        let lastResponse = "";

        for (let i = 0; i < turns.length; i++) {
          conversation.push({ role: "user", content: turns[i] });
          const result = await pluginRef.current.generateFull(conversation);

          conversation.push({ role: "assistant", content: result.response });
          totalTokens += result.tokenCount;
          totalTimeMs += result.timeMs;
          if (i === 0) firstTtft = result.ttftMs;
          if (result.tpotMs > 0) tpots.push(result.tpotMs);
          lastResponse = result.response;
        }

        const avgTpot = tpots.length > 0 ? tpots.reduce((a, b) => a + b, 0) / tpots.length : 0;

        return {
          modelName: currentModelName,
          prompt: turns.join(" → "),
          category,
          tokensGenerated: totalTokens,
          timeMs: totalTimeMs,
          tokensPerSecond: totalTokens / (totalTimeMs / 1000),
          ttftMs: firstTtft,
          tpotMs: avgTpot,
          response: lastResponse,
        };
      } catch (err) {
        console.error("Multi-turn benchmark error:", err);
        return null;
      }
    },
    [currentModelName]
  );

  /** Fire N concurrent requests and return aggregate result */
  const runConcurrentBenchmark = useCallback(
    async (promptText: string, concurrency: number, category: string = "concurrent"): Promise<BenchmarkResult | null> => {
      const benchmarkMessages: ChatMessage[] = [{ role: "user", content: promptText }];

      try {
        const start = performance.now();
        // Fire all requests concurrently (engine may serialize internally, which is what we're measuring)
        const promises = Array.from({ length: concurrency }, () => pluginRef.current.generateFull(benchmarkMessages));
        const results = await Promise.allSettled(promises);
        const end = performance.now();

        const fulfilled = results
          .filter((r): r is PromiseFulfilledResult<import("@/lib/inference/types").GenerationResult> => r.status === "fulfilled")
          .map(r => r.value);

        if (fulfilled.length === 0) return null;

        const totalTokens = fulfilled.reduce((a, r) => a + r.tokenCount, 0);
        const wallTimeMs = end - start;
        const avgTtft = fulfilled.reduce((a, r) => a + r.ttftMs, 0) / fulfilled.length;
        const avgTpot = fulfilled.reduce((a, r) => a + r.tpotMs, 0) / fulfilled.length;

        return {
          modelName: currentModelName,
          prompt: `${concurrency}× ${promptText}`,
          category,
          tokensGenerated: totalTokens,
          timeMs: wallTimeMs,
          tokensPerSecond: totalTokens / (wallTimeMs / 1000),
          ttftMs: avgTtft,
          tpotMs: avgTpot,
          response: `${fulfilled.length}/${concurrency} completed`,
        };
      } catch (err) {
        console.error("Concurrent benchmark error:", err);
        return null;
      }
    },
    [currentModelName]
  );

  return {
    status,
    statusMessage,
    downloadProgress,
    messages,
    isGenerating,
    currentModelName,
    activeEngine,
    activeBackend,
    capabilities,
    loadModel,
    unloadModel,
    sendMessage,
    runBenchmarkPrompt,
    runLongContextBenchmark,
    runMultiTurnBenchmark,
    runConcurrentBenchmark,
  };
}
