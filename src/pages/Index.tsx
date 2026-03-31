import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLlmInference } from "@/hooks/useLlmInference";
import { ModelLoader } from "@/components/ModelLoader";
import { QuickStart } from "@/components/QuickStart";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { BenchmarkPanel } from "@/components/BenchmarkPanel";
import { CloudChat } from "@/components/CloudChat";
import { C2CChat } from "@/components/C2CChat";
import { EvalsPanel } from "@/components/EvalsPanel";
import { Cpu, MessageSquare, BarChart3, RotateCcw, Zap, Globe, Server, History, Cloud, ArrowRightLeft, ClipboardCheck } from "lucide-react";

type Tab = "chat" | "benchmark" | "evals" | "cloud" | "c2c";

const ENGINE_BADGE: Record<string, { icon: React.ReactNode; label: string }> = {
  mediapipe: { icon: <Zap className="h-3 w-3" />, label: "MediaPipe" },
  webllm: { icon: <Globe className="h-3 w-3" />, label: "WebLLM" },
  onnx: { icon: <Server className="h-3 w-3" />, label: "ONNX" },
};

const Index = () => {
  const {
    status, statusMessage, downloadProgress, messages, isGenerating, currentModelName,
    activeEngine, capabilities, engineRef,
    loadModel, unloadModel, sendMessage, runBenchmarkPrompt,
    runLongContextBenchmark, runMultiTurnBenchmark, runConcurrentBenchmark,
  } = useLlmInference();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [quickStartDismissed, setQuickStartDismissed] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const engineInfo = activeEngine ? ENGINE_BADGE[activeEngine] : null;

  // Show quick start when user hasn't explicitly dismissed it
  const showQuickStart = !quickStartDismissed && !advancedMode && activeTab !== "cloud" && activeTab !== "c2c";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header — hide in quick start mode for cleaner look, but show in cloud mode */}
      {!showQuickStart && (
        <header className="flex items-center gap-2 border-b border-border px-6 py-3">
          <Cpu className="h-5 w-5 text-primary" />
          <span className="font-mono text-sm font-semibold">
            <span className="text-primary">Can I</span>
            <span className="text-foreground"> AI?</span>
          </span>

          {status === "ready" ? (
            <>
              {/* Tabs */}
              <div className="ml-6 flex items-center gap-1 rounded-lg border border-border bg-secondary/30 p-0.5">
                <button
                  onClick={() => setActiveTab("chat")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab === "chat"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MessageSquare className="h-3 w-3" /> Chat
                </button>
                <button
                  onClick={() => setActiveTab("cloud")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab === "cloud"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Cloud className="h-3 w-3" /> Cloud
                </button>
                <button
                  onClick={() => setActiveTab("c2c")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab === "c2c"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ArrowRightLeft className="h-3 w-3" /> C2C
                </button>
                <button
                  onClick={() => setActiveTab("benchmark")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab === "benchmark"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="h-3 w-3" /> Benchmark
                </button>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {engineInfo && (
                  <span className="flex items-center gap-1 rounded-md border border-border bg-secondary/30 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                    {engineInfo.icon} {engineInfo.label}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
                  {currentModelName}
                </span>
                <Link
                  to="/benchmarks"
                  className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:border-muted-foreground/40"
                >
                  <History className="h-3 w-3" /> Benchmarks
                </Link>
                <button
                  onClick={() => {
                    unloadModel();
                    setAdvancedMode(false);
                    setQuickStartDismissed(false);
                  }}
                  className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:border-muted-foreground/40"
                >
                  <RotateCcw className="h-3 w-3" /> Switch
                </button>
              </div>
            </>
          ) : activeTab === "cloud" || activeTab === "c2c" ? (
            <div className="ml-auto">
              <button
                onClick={() => setActiveTab("chat")}
                className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:border-muted-foreground/40"
              >
                <RotateCcw className="h-3 w-3" /> Back
              </button>
            </div>
          ) : null}
        </header>
      )}

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {showQuickStart ? (
          <QuickStart
            status={status}
            statusMessage={statusMessage}
            downloadProgress={downloadProgress}
            activeEngine={activeEngine}
            capabilities={capabilities}
            onLoadModel={loadModel}
            onAdvancedMode={() => { setAdvancedMode(true); setQuickStartDismissed(true); }}
            onCloudChat={() => setActiveTab("cloud")}
            onC2CChat={() => setActiveTab("c2c")}
            onRunBenchmark={runBenchmarkPrompt}
            onRunLongContext={runLongContextBenchmark}
            onRunMultiTurn={runMultiTurnBenchmark}
            onRunConcurrent={runConcurrentBenchmark}
          />
        ) : activeTab === "cloud" ? (
          <CloudChat />
        ) : activeTab === "c2c" ? (
          <C2CChat />
        ) : status !== "ready" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <ModelLoader
              status={status}
              statusMessage={statusMessage}
              downloadProgress={downloadProgress}
              activeEngine={activeEngine}
              capabilities={capabilities}
              onLoadModel={loadModel}
              onBackToQuickStart={() => {
                setAdvancedMode(false);
                setQuickStartDismissed(false);
              }}
            />
          </div>
        ) : activeTab === "chat" ? (
          <>
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
            <div className="border-t border-border p-4">
              <div className="mx-auto max-w-3xl">
                <ChatInput onSend={sendMessage} disabled={isGenerating} supportsVision={engineRef.current?.supportsVision} />
              </div>
            </div>
          </>
        ) : (
          <BenchmarkPanel
            modelName={currentModelName}
            onRunPrompt={runBenchmarkPrompt}
          />
        )}
      </main>
    </div>
  );
};

export default Index;
