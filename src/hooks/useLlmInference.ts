import { useState, useRef, useCallback } from "react";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function useLlmInference() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const llmRef = useRef<any>(null);

  const loadModel = useCallback(async (modelUrl: string) => {
    try {
      setStatus("loading");
      setStatusMessage("Initializing WebGPU runtime...");

      // Check WebGPU support
      if (!navigator.gpu) {
        throw new Error("WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.");
      }

      const genai = await window.FilesetResolver.forGenAiTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
      );

      setStatusMessage("Loading model (this may take a few minutes)...");

      llmRef.current = await window.LlmInference.createFromOptions(genai, {
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
    } catch (err: any) {
      setStatus("error");
      setStatusMessage(err.message || "Failed to load model");
      console.error("LLM load error:", err);
    }
  }, []);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!llmRef.current || isGenerating) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);
    setIsGenerating(true);

    // Build prompt with conversation history
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
    } catch (err: any) {
      console.error("Generation error:", err);
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Error generating response: " + err.message },
      ]);
      setIsGenerating(false);
    }
  }, [messages, isGenerating]);

  return { status, statusMessage, messages, isGenerating, loadModel, sendMessage };
}
