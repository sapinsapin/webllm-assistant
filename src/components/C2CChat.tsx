import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { C2CBenchmark } from "@/components/C2CBenchmark";
import { Cloud, Cpu, Loader2, CheckCircle2, AlertCircle, ArrowDownToLine, BarChart3, MessageSquare } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useLlmInference";
import type { EngineCapability, EngineType, InferenceEngine } from "@/lib/inference/types";
import { createEngine } from "@/lib/inference";
import { getBestQuickStartModel } from "@/lib/models";

const APOLLO_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apollo-chat`;

type C2CMode = "cloud" | "local";
type LocalState = "idle" | "loading" | "ready" | "error";
type C2CView = "chat" | "benchmark";

interface C2CChatProps {
  capabilities: EngineCapability[];
  activeEngine: EngineType | null;
}

export function C2CChat({ capabilities, activeEngine }: C2CChatProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<C2CMode>("cloud");
  const [localState, setLocalState] = useState<LocalState>("idle");
  const [localProgress, setLocalProgress] = useState(0);
  const [localStatusMsg, setLocalStatusMsg] = useState("");
  const [cloudRequests, setCloudRequests] = useState(0);
  const [localRequests, setLocalRequests] = useState(0);
  const [view, setView] = useState<C2CView>("chat");

  const scrollRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InferenceEngine | null>(null);
  const loadStarted = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Start loading local model in the background on mount
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    const model = getBestQuickStartModel(capabilities);
    if (!model) {
      setLocalState("error");
      setLocalStatusMsg("No compatible model found");
      return;
    }

    const engineType = model.engine || activeEngine || "mediapipe";

    (async () => {
      try {
        setLocalState("loading");
        setLocalStatusMsg(`Loading ${model.name}...`);
        const engine = createEngine(engineType);
        engineRef.current = engine;

        await engine.load(model.url, (pct, msg) => {
          setLocalProgress(Math.max(pct, 0));
          setLocalStatusMsg(msg);
        });

        setLocalState("ready");
        setLocalStatusMsg(`${model.name} ready`);
        // Auto-switch to local
        setMode("local");
      } catch (err) {
        console.error("C2C local load error:", err);
        setLocalState("error");
        setLocalStatusMsg(err instanceof Error ? err.message : "Failed to load local model");
      }
    })();

    return () => {
      engineRef.current?.unload();
    };
  }, [capabilities, activeEngine]);

  const sendCloudMessage = useCallback(
    async (input: string, currentMessages: ChatMessageType[]): Promise<string> => {
      const resp = await fetch(APOLLO_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: currentMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      const updatedMessages = currentMessages.slice(0, -1); // remove empty assistant placeholder

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const parsed = JSON.parse(payload);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages([...updatedMessages, { role: "assistant", content: assistantContent }]);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Final flush
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const payload = raw.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages([...updatedMessages, { role: "assistant", content: assistantContent }]);
            }
          } catch { /* ignore */ }
        }
      }

      return assistantContent;
    },
    []
  );

  const sendLocalMessage = useCallback(
    async (currentMessages: ChatMessageType[]): Promise<string> => {
      const engine = engineRef.current;
      if (!engine) throw new Error("Local engine not ready");

      const prompt = engine.formatPrompt(currentMessages);
      const updatedMessages = currentMessages.slice(0, -1);
      let fullResponse = "";

      await engine.generateStream(prompt, {
        onToken: (token) => {
          fullResponse += token;
          setMessages([...updatedMessages, { role: "assistant", content: fullResponse }]);
        },
        onComplete: () => {},
      });

      return fullResponse;
    },
    []
  );

  const sendMessage = useCallback(
    async (input: string) => {
      setError(null);
      const userMsg: ChatMessageType = { role: "user", content: input };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsLoading(true);

      // Add empty assistant message for streaming
      const withPlaceholder = [...updatedMessages, { role: "assistant" as const, content: "" }];
      setMessages(withPlaceholder);

      const useLocal = mode === "local" && localState === "ready" && engineRef.current;

      try {
        let response: string;
        if (useLocal) {
          response = await sendLocalMessage(withPlaceholder);
          setLocalRequests((p) => p + 1);
        } else {
          response = await sendCloudMessage(input, withPlaceholder);
          setCloudRequests((p) => p + 1);
        }

        // Ensure final message is set
        setMessages([...updatedMessages, { role: "assistant", content: response }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        setMessages([...updatedMessages, { role: "assistant", content: `Error: ${msg}` }]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, mode, localState, sendCloudMessage, sendLocalMessage]
  );

  const modeIcon = mode === "local" ? <Cpu className="h-3 w-3" /> : <Cloud className="h-3 w-3" />;
  const modeLabel = mode === "local" ? "On-Device" : "Cloud";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* C2C Status Bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-secondary/20">
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          {modeIcon}
          <span className="text-foreground font-medium">{modeLabel}</span>
        </div>

        <div className="mx-2 h-3 w-px bg-border" />

        {/* Local model status */}
        {localState === "loading" && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
            <ArrowDownToLine className="h-3 w-3 animate-pulse text-primary" />
            <span>Loading local model… {localProgress > 0 ? `${Math.round(localProgress)}%` : ""}</span>
            <div className="w-16 h-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(localProgress, 2)}%` }}
              />
            </div>
          </div>
        )}
        {localState === "ready" && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-primary">
            <CheckCircle2 className="h-3 w-3" />
            <span>{localStatusMsg}</span>
          </div>
        )}
        {localState === "error" && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>Local failed — using cloud</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cloud className="h-2.5 w-2.5" /> {cloudRequests}
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="h-2.5 w-2.5" /> {localRequests}
          </span>
        </div>

        {/* Manual toggle if local is ready */}
        {localState === "ready" && (
          <>
            <div className="mx-1 h-3 w-px bg-border" />
            <button
              onClick={() => setMode(mode === "local" ? "cloud" : "local")}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              Switch to {mode === "local" ? "Cloud" : "Local"}
            </button>
          </>
        )}
      </div>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center h-full gap-3">
            <div className="flex items-center gap-2">
              <Cloud className="h-6 w-6 text-muted-foreground/30" />
              <span className="text-muted-foreground/20">→</span>
              <Cpu className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-muted-foreground/40 text-sm font-mono text-center max-w-xs">
              Cloud → Client mode: chat instantly via cloud while your device loads the AI model in the background
            </p>
            {localState === "loading" && (
              <p className="text-[10px] font-mono text-primary/60 animate-pulse">
                Local model downloading…
              </p>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
      </div>

      {error && (
        <div className="mx-6 mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" /> {error}
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
