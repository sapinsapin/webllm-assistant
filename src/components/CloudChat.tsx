import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { CloudBenchmark } from "@/components/CloudBenchmark";
import { Cloud, AlertCircle, MessageSquare, BarChart3 } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useLlmInference";
import { supabase } from "@/integrations/supabase/client";

const SAPINSAPINAI_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apollo-chat`;

// Simple email regex for detection
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function CloudChat() {
  const [view, setView] = useState<"chat" | "benchmark">("chat");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onboardingRef = useRef<{ name: string | null; email: string | null; saved: boolean }>({
    name: null,
    email: null,
    saved: false,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track onboarding: 1st user msg = name, 2nd user msg = email response
  const tryCaptureLead = useCallback((allMessages: ChatMessageType[]) => {
    if (onboardingRef.current.saved) return;
    const userMessages = allMessages.filter((m) => m.role === "user");

    // First user message is their name
    if (userMessages.length >= 1 && !onboardingRef.current.name) {
      onboardingRef.current.name = userMessages[0].content.trim();
    }

    // Second user message is their email response
    if (userMessages.length >= 2 && !onboardingRef.current.email) {
      const emailMsg = userMessages[1].content;
      const match = emailMsg.match(EMAIL_RE);
      onboardingRef.current.email = match ? match[0] : null;

      // Save lead after second response regardless
      const { name, email } = onboardingRef.current;
      if (name) {
        onboardingRef.current.saved = true;
        supabase
          .from("leads")
          .insert({ name, email, source: "cloud_chat" })
          .then(({ error }) => {
            if (error) console.error("Failed to save lead:", error);
          });
      }
    }
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    setError(null);
    const userMsg: ChatMessageType = { role: "user", content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);
    tryCaptureLead(updatedMessages);

    try {
      const resp = await fetch(SAPINSAPINAI_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error("No response body");

      // Stream SSE
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      setMessages([...updatedMessages, { role: "assistant", content: "" }]);

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
              const snapshot = assistantContent;
              setMessages([...updatedMessages, { role: "assistant", content: snapshot }]);
            }
          } catch {
            // partial JSON, put back
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setMessages([...updatedMessages, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, tryCaptureLead]);

  if (view === "benchmark") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <button
            onClick={() => setView("chat")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-secondary transition-colors"
          >
            <MessageSquare className="h-3 w-3" /> Chat
          </button>
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono bg-secondary text-foreground"
          >
            <BarChart3 className="h-3 w-3" /> Bench
          </button>
        </div>
        <CloudBenchmark />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono bg-secondary text-foreground"
        >
          <MessageSquare className="h-3 w-3" /> Chat
        </button>
        <button
          onClick={() => setView("benchmark")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-secondary transition-colors"
        >
          <BarChart3 className="h-3 w-3" /> Bench
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center h-full gap-3">
            <Cloud className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-muted-foreground/40 text-sm font-mono text-center max-w-xs">
              Cloud chat powered by SapinSapinAI Sovereign stack
            </p>
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
