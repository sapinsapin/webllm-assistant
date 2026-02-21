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
  tokensGenerated: number;
  timeMs: number;
  tokensPerSecond: number;
  response: string;
}

export function useLlmInference() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentModelName, setCurrentModelName] = useState("");
  const llmRef = useRef<LlmInference | null>(null);

  const loadModel = useCallback(async (modelUrl: string, modelName?: string) => {
    try {
      setStatus("loading");
      setStatusMessage("Initializing WebGPU runtime...");
      setCurrentModelName(modelName || modelUrl.split("/").pop() || "Unknown");

      if (!(navigator as any).gpu) {
      }

      const genai = await FilesetResolver.forGenAiTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
      );

      setStatusMessage("Loading model (this may take a few minutes)...");

      llmRef.current = await LlmInference.createFromOptions(genai, {
        baseOptions: {
          modelAssetPath: modelUrl,
        },
        maxTokens: 1024,
        topK: 40,
        temperature: 0.8,
        randomSeed: 101,
      });

      setStatus("ready");
      setStatusMessage("Model loaded successfully");
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to load model";
      setStatusMessage(msg);
      console.error("LLM load error:", err);
    }
  }, []);

  const unloadModel = useCallback(() => {
    llmRef.current = null;
    setStatus("idle");
    setStatusMessage("");
    setMessages([]);
    setCurrentModelName("");
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

  const runBenchmarkPrompt = useCallback(async (promptText: string): Promise<BenchmarkResult | null> => {
    if (!llmRef.current) return null;

    const fullPrompt = `<start_of_turn>user\n${promptText}<end_of_turn>\n<start_of_turn>model\n`;
    const startTime = performance.now();
    let tokenCount = 0;
    let fullResponse = "";

    try {
      await llmRef.current.generateResponse(
        fullPrompt,
        (partialResult: string, done: boolean) => {
          fullResponse += partialResult;
          tokenCount++;
          if (done) {
            // done
          }
        }
      );

      const endTime = performance.now();
      const timeMs = endTime - startTime;

      return {
        modelName: currentModelName,
        prompt: promptText,
        tokensGenerated: tokenCount,
        timeMs,
        tokensPerSecond: tokenCount / (timeMs / 1000),
        response: fullResponse,
      };
    } catch (err) {
      console.error("Benchmark error:", err);
      return null;
    }
  }, [currentModelName]);

  return {
    status, statusMessage, messages, isGenerating, currentModelName,
    loadModel, unloadModel, sendMessage, runBenchmarkPrompt,
  };
}
