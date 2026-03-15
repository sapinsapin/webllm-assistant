import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import {
  type EngineType,
  type InferenceEngine,
  type EngineCapability,
  type ImageAttachment,
  detectCapabilities,
  getBestEngine,
  createEngine,
} from "@/lib/inference";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[];
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

interface LlmInferenceContextValue {
  status: ModelStatus;
  statusMessage: string;
  downloadProgress: number;
  messages: ChatMessage[];
  isGenerating: boolean;
  currentModelName: string;
  activeEngine: EngineType | null;
  capabilities: EngineCapability[];
  engineRef: React.RefObject<InferenceEngine | null>;
  loadModel: (modelUrl: string, modelName?: string, hfToken?: string, engineOverride?: EngineType, visionEnabled?: boolean) => Promise<void>;
  unloadModel: () => void;
  sendMessage: (userMessage: string, images?: string[]) => Promise<void>;
  runBenchmarkPrompt: (promptText: string, category?: string) => Promise<BenchmarkResult | null>;
  runLongContextBenchmark: (promptText: string, context: string, category?: string) => Promise<BenchmarkResult | null>;
  runMultiTurnBenchmark: (turns: string[], category?: string) => Promise<BenchmarkResult | null>;
  runConcurrentBenchmark: (promptText: string, concurrency: number, category?: string) => Promise<BenchmarkResult | null>;
}

const LlmInferenceContext = createContext<LlmInferenceContextValue | null>(null);

export function LlmInferenceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentModelName, setCurrentModelName] = useState("");
  const [activeEngine, setActiveEngine] = useState<EngineType | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapability[]>([]);

  const engineRef = useRef<InferenceEngine | null>(null);

  // Detect capabilities on mount
  useEffect(() => {
    detectCapabilities().then((caps) => {
      setCapabilities(caps);
      const best = getBestEngine(caps);
      setActiveEngine(best);
    });
  }, []);

  const loadModel = useCallback(
    async (modelUrl: string, modelName?: string, hfToken?: string, engineOverride?: EngineType, visionEnabled?: boolean) => {
      try {
        const engineType = engineOverride || activeEngine || "mediapipe";
        setStatus("loading");
        setDownloadProgress(0);
        setCurrentModelName(modelName || modelUrl.split("/").pop() || "Unknown");

        const engine = createEngine(engineType);
        engineRef.current = engine;
        setActiveEngine(engineType);

        setStatusMessage(`Starting ${engine.label}...`);

        await engine.load(modelUrl, (pct, msg) => {
          setDownloadProgress(Math.max(pct, 0));
          setStatusMessage(msg);
        }, hfToken, { vision: visionEnabled });

        setStatus("ready");
        setStatusMessage(`Model loaded via ${engine.label}`);
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
    engineRef.current?.unload();
    engineRef.current = null;
    setStatus("idle");
    setStatusMessage("");
    setMessages([]);
    setCurrentModelName("");
    setDownloadProgress(0);
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string, images?: string[]) => {
      const engine = engineRef.current;
      if (!engine || isGenerating) return;

      const newMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: userMessage, images },
      ];
      setMessages(newMessages);
      setIsGenerating(true);

      const prompt = engine.formatPrompt(newMessages);

      // Convert image data URLs to ImageAttachment format
      const imageAttachments: ImageAttachment[] | undefined = images?.map((dataUrl) => ({ dataUrl }));

      try {
        let fullResponse = "";
        setMessages([...newMessages, { role: "assistant", content: "" }]);

        await engine.generateStream(prompt, {
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
        }, imageAttachments);
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
      const engine = engineRef.current;
      if (!engine) return null;

      const fullPrompt = engine.formatPrompt([{ role: "user", content: promptText }]);

      try {
        const result = await engine.generateFull(fullPrompt);

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

  const runLongContextBenchmark = useCallback(
    async (promptText: string, context: string, category: string = "long_context"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) return null;

      const combinedPrompt = `${context}\n\n${promptText}`;
      const fullPrompt = engine.formatPrompt([{ role: "user", content: combinedPrompt }]);

      try {
        const result = await engine.generateFull(fullPrompt);
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

  const runMultiTurnBenchmark = useCallback(
    async (turns: string[], category: string = "multi_turn"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) return null;

      try {
        const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
        let totalTokens = 0;
        let totalTimeMs = 0;
        let firstTtft = 0;
        const tpots: number[] = [];
        let lastResponse = "";

        for (let i = 0; i < turns.length; i++) {
          conversation.push({ role: "user", content: turns[i] });
          const fullPrompt = engine.formatPrompt(conversation);
          const result = await engine.generateFull(fullPrompt);

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

  const runConcurrentBenchmark = useCallback(
    async (promptText: string, concurrency: number, category: string = "concurrent"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) return null;

      const fullPrompt = engine.formatPrompt([{ role: "user", content: promptText }]);

      try {
        const start = performance.now();
        const promises = Array.from({ length: concurrency }, () => engine.generateFull(fullPrompt));
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

  const value: LlmInferenceContextValue = {
    status,
    statusMessage,
    downloadProgress,
    messages,
    isGenerating,
    currentModelName,
    activeEngine,
    capabilities,
    engineRef,
    loadModel,
    unloadModel,
    sendMessage,
    runBenchmarkPrompt,
    runLongContextBenchmark,
    runMultiTurnBenchmark,
    runConcurrentBenchmark,
  };

  return (
    <LlmInferenceContext.Provider value={value}>
      {children}
    </LlmInferenceContext.Provider>
  );
}

export function useLlmInference() {
  const context = useContext(LlmInferenceContext);
  if (!context) {
    throw new Error("useLlmInference must be used within a LlmInferenceProvider");
  }
  return context;
}

// Re-export types for convenience
export type { EngineType, EngineCapability };
