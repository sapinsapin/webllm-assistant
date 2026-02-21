import { useRef, useEffect } from "react";
import { useLlmInference } from "@/hooks/useLlmInference";
import { ModelLoader } from "@/components/ModelLoader";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { Cpu } from "lucide-react";

const Index = () => {
  const { status, statusMessage, messages, isGenerating, loadModel, sendMessage } =
    useLlmInference();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-6 py-3">
        <Cpu className="h-5 w-5 text-primary" />
        <span className="font-mono text-sm font-semibold">
          <span className="text-primary">Edge</span>
          <span className="text-foreground">LLM</span>
        </span>
        {status === "ready" && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
            Model active
          </span>
        )}
      </header>

      {/* Main content */}
      <main className="flex flex-1 flex-col">
        {status !== "ready" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <ModelLoader
              status={status}
              statusMessage={statusMessage}
              onLoadModel={loadModel}
            />
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin"
            >
              {messages.length === 0 && (
                <div className="flex flex-1 items-center justify-center h-full">
                  <p className="text-muted-foreground/40 text-sm font-mono">
                    Start a conversation...
                  </p>
                </div>
              )}
              {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
              ))}
            </div>

            {/* Input */}
            <div className="border-t border-border p-4">
              <div className="mx-auto max-w-3xl">
                <ChatInput onSend={sendMessage} disabled={isGenerating} />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
