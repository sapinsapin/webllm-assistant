import { useState, useRef, useCallback, useEffect } from "react";
import {
  type EngineType,
  type InferenceEngine,
  type EngineCapability,
  detectCapabilities,
  getBestEngine,
  createEngine,
} from "@/lib/inference";

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
    async (modelUrl: string, modelName?: string, hfToken?: string, engineOverride?: EngineType) => {
      try {
        const engineType = engineOverride || activeEngine || "mediapipe";
        setStatus("loading");
        setDownloadProgress(0);
        setCurrentModelName(modelName || modelUrl.split("/").pop() || "Unknown");

        // Create engine instance
        const engine = createEngine(engineType);
        engineRef.current = engine;
        setActiveEngine(engineType);

        setStatusMessage(`Starting ${engine.label}...`);

        await engine.load(modelUrl, (pct, msg) => {
          setDownloadProgress(Math.max(pct, 0));
          setStatusMessage(msg);
        }, hfToken);

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
    async (userMessage: string) => {
      const engine = engineRef.current;
      if (!engine || isGenerating) return;

      const newMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: userMessage },
      ];
      setMessages(newMessages);
      setIsGenerating(true);

      const prompt = engine.formatPrompt(newMessages);

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

  return {
    status,
    statusMessage,
    downloadProgress,
    messages,
    isGenerating,
    currentModelName,
    activeEngine,
    capabilities,
    loadModel,
    unloadModel,
    sendMessage,
    runBenchmarkPrompt,
  };
}
