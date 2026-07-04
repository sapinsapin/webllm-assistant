import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import {
  type EngineType,
  type InferenceEngine,
  type EngineCapability,
  type ImageAttachment,
  detectCapabilities,
  getBestEngine,
  getFallbackChain,
  createEngine,
} from "@/lib/inference";
import { getSmallestModel } from "@/lib/models";
import { toast } from "@/hooks/use-toast";

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
  /** Message of the most recent failed benchmark run (null once one succeeds). */
  lastBenchmarkError: string | null;
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
  const [lastBenchmarkError, setLastBenchmarkError] = useState<string | null>(null);

  const engineRef = useRef<InferenceEngine | null>(null);

  // Detect capabilities on mount. Detection failure must not leave the app
  // engine-less: fall back to the universally-available WASM engine and say so.
  useEffect(() => {
    detectCapabilities()
      .then((caps) => {
        setCapabilities(caps);
        const best = getBestEngine(caps);
        setActiveEngine(best);
      })
      .catch((err) => {
        console.error("Capability detection failed:", err);
        setCapabilities([
          { engine: "onnx", label: "Transformers.js (WASM)", available: true, priority: 3 },
        ]);
        setActiveEngine("onnx");
        toast({
          title: "Hardware detection failed",
          description: "Falling back to the universal WASM engine. Performance may be reduced.",
          variant: "destructive",
        });
      });
  }, []);

  const loadModel = useCallback(
    async (modelUrl: string, modelName?: string, hfToken?: string, engineOverride?: EngineType, visionEnabled?: boolean) => {
      const preferred = engineOverride || activeEngine || "mediapipe";
      setStatus("loading");
      setDownloadProgress(0);

      // Load plan: the requested engine/model first, then every other available
      // engine (by priority) with its own smallest non-gated model. Model
      // presets are engine-specific, so falling back across engines requires
      // swapping the model too.
      const attempts: { engine: EngineType; url: string; name: string; vision?: boolean }[] = [
        {
          engine: preferred,
          url: modelUrl,
          name: modelName || modelUrl.split("/").pop() || "Unknown",
          vision: visionEnabled,
        },
      ];
      for (const eng of getFallbackChain(capabilities, preferred)) {
        if (eng === preferred) continue;
        const fallbackModel = getSmallestModel(eng);
        // Gated fallbacks would just fail again without a token — skip them.
        if (fallbackModel && !fallbackModel.gated) {
          attempts.push({ engine: eng, url: fallbackModel.url, name: fallbackModel.name });
        }
      }

      let lastErr: unknown = null;
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          setCurrentModelName(attempt.name);
          setDownloadProgress(0);

          const engine = createEngine(attempt.engine);
          engineRef.current = engine;
          setActiveEngine(attempt.engine);
          setStatusMessage(
            i === 0
              ? `Starting ${engine.label}...`
              : `Falling back to ${engine.label} with ${attempt.name}...`
          );

          await engine.load(attempt.url, (pct, msg) => {
            setDownloadProgress(Math.max(pct, 0));
            setStatusMessage(msg);
          }, hfToken, { vision: attempt.vision });

          setStatus("ready");
          setStatusMessage(`Model loaded via ${engine.label}`);
          if (i > 0) {
            toast({
              title: "Loaded on fallback engine",
              description: `${attempts[0].name} failed on ${attempts[0].engine}. Using ${attempt.name} via ${engine.label} instead.`,
            });
          }
          return;
        } catch (err: unknown) {
          lastErr = err;
          console.error(`LLM load error on ${attempt.engine}:`, err);
          engineRef.current = null;
          const msg = err instanceof Error ? err.message : "Failed to load model";
          if (i < attempts.length - 1) {
            const next = attempts[i + 1];
            setStatusMessage(`${attempt.engine} failed — trying ${next.engine}...`);
            toast({
              title: `${attempt.name} failed to load`,
              description: `${msg} — falling back to ${next.name} (${next.engine}).`,
            });
          }
        }
      }

      // Every attempt failed — this must be loudly visible, never silent.
      const msg = lastErr instanceof Error ? lastErr.message : "Failed to load model";
      setStatus("error");
      setStatusMessage(msg);
      setDownloadProgress(0);
      toast({
        title: "Could not load any AI engine",
        description: msg,
        variant: "destructive",
      });
    },
    [activeEngine, capabilities]
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

        // Tokens to strip from streamed output
        const CONTROL_TOKENS = [/<end_of_turn>/g, /<start_of_turn>(?:user|model)\n?/g, /<eos>/g];
        const cleanResponse = (text: string) => {
          let cleaned = text;
          for (const re of CONTROL_TOKENS) cleaned = cleaned.replace(re, "");
          return cleaned;
        };

        await engine.generateStream(prompt, {
          onToken: (token) => {
            fullResponse += token;
            const cleaned = cleanResponse(fullResponse);
            setMessages([
              ...newMessages,
              { role: "assistant", content: cleaned },
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
      } finally {
        // Guarantee the input is re-enabled even if an engine resolves
        // without ever invoking onComplete.
        setIsGenerating(false);
      }
    },
    [messages, isGenerating]
  );

  const runBenchmarkPrompt = useCallback(
    async (promptText: string, category: string = "general"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) {
        setLastBenchmarkError("No model loaded");
        return null;
      }
      setLastBenchmarkError(null);

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
        setLastBenchmarkError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [currentModelName]
  );

  const runLongContextBenchmark = useCallback(
    async (promptText: string, context: string, category: string = "long_context"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) {
        setLastBenchmarkError("No model loaded");
        return null;
      }
      setLastBenchmarkError(null);

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
        setLastBenchmarkError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [currentModelName]
  );

  const runMultiTurnBenchmark = useCallback(
    async (turns: string[], category: string = "multi_turn"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) {
        setLastBenchmarkError("No model loaded");
        return null;
      }
      setLastBenchmarkError(null);

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
        setLastBenchmarkError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [currentModelName]
  );

  const runConcurrentBenchmark = useCallback(
    async (promptText: string, concurrency: number, category: string = "concurrent"): Promise<BenchmarkResult | null> => {
      const engine = engineRef.current;
      if (!engine) {
        setLastBenchmarkError("No model loaded");
        return null;
      }
      setLastBenchmarkError(null);

      const fullPrompt = engine.formatPrompt([{ role: "user", content: promptText }]);

      // Estimate expected tokens per request (~60) and compute timeout
      // based on a minimum viability threshold of 0.1 tokens/second
      const estimatedTokensPerRequest = 60;
      const totalExpectedTokens = estimatedTokensPerRequest * concurrency;
      const MIN_VIABLE_TPS = 0.1;
      const timeoutMs = (totalExpectedTokens / MIN_VIABLE_TPS) * 1000;

      try {
        const start = performance.now();
        const promises = Array.from({ length: concurrency }, () => engine.generateFull(fullPrompt));

        const timeoutPromise = new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), timeoutMs)
        );

        const raceResult = await Promise.race([
          Promise.allSettled(promises).then((r) => ({ type: "done" as const, results: r })),
          timeoutPromise.then(() => ({ type: "timeout" as const, results: [] as PromiseSettledResult<import("@/lib/inference/types").GenerationResult>[] })),
        ]);

        const end = performance.now();
        const wallTimeMs = end - start;
        const isTimeout = raceResult.type === "timeout";

        const fulfilled = raceResult.results
          .filter((r): r is PromiseFulfilledResult<import("@/lib/inference/types").GenerationResult> => r.status === "fulfilled")
          .map(r => r.value);

        if (fulfilled.length === 0) {
          return {
            modelName: currentModelName,
            prompt: `${concurrency}× ${promptText}`,
            category,
            tokensGenerated: 0,
            timeMs: wallTimeMs,
            tokensPerSecond: 0,
            ttftMs: 0,
            tpotMs: 0,
            response: isTimeout
              ? `Timed out after ${Math.round(wallTimeMs / 1000)}s — below ${MIN_VIABLE_TPS} tok/s threshold`
              : `0/${concurrency} completed`,
          };
        }

        const totalTokens = fulfilled.reduce((a, r) => a + r.tokenCount, 0);
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
          response: isTimeout
            ? `Timed out: ${fulfilled.length}/${concurrency} completed in ${Math.round(wallTimeMs / 1000)}s`
            : `${fulfilled.length}/${concurrency} completed`,
        };
      } catch (err) {
        console.error("Concurrent benchmark error:", err);
        setLastBenchmarkError(err instanceof Error ? err.message : "Unknown error");
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
    lastBenchmarkError,
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
