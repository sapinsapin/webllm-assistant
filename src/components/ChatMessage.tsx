import { User, Bot } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useLlmInference";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

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
        <p className="whitespace-pre-wrap font-mono text-[13px]">
          {message.content || (
            <span className="inline-flex gap-1">
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" />
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "0.2s" }} />
              <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "0.4s" }} />
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
