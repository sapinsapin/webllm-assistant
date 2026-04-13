import { useState, useCallback } from "react";
import { User, Bot, Volume2, VolumeX } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useLlmInference";
import { stripControlTokens } from "@/lib/inference/sanitize";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [isSpeaking, setIsSpeaking] = useState(false);

  const canSpeak =
    !isUser &&
    message.content &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window;
  const cleanContent = stripControlTokens(message.content || "");

  const toggleSpeak = useCallback(() => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanContent);
    utterance.rate = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [isSpeaking, cleanContent]);

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-primary/10 text-primary border border-primary/20"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-card border border-border text-card-foreground"
        }`}
      >
        {/* Image attachments */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {message.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`Attachment ${i + 1}`}
                className="max-h-48 rounded-lg border border-border object-contain"
              />
            ))}
          </div>
        )}
        {message.audios && message.audios.length > 0 && (
          <div className="mb-2 flex flex-col gap-2">
            {message.audios.map((src, i) => (
              <audio key={i} controls src={src} className="max-w-xs" />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap font-mono text-[13px]">
          {cleanContent || (
            <span className="inline-flex gap-1">
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" />
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "0.2s" }} />
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "0.4s" }} />
            </span>
          )}
        </p>

        {/* Read aloud button for assistant messages */}
        {canSpeak && (
          <button
            onClick={toggleSpeak}
            className={`mt-2 inline-flex items-center gap-1.5 text-xs font-mono transition-colors ${
              isSpeaking
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={isSpeaking ? "Stop reading" : "Read aloud"}
          >
            {isSpeaking ? (
              <><VolumeX className="h-3 w-3" /> Stop</>
            ) : (
              <><Volume2 className="h-3 w-3" /> Read aloud</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
