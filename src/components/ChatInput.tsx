import { useState, useRef, useEffect, useCallback } from "react";
import { SendHorizonal, ImagePlus, X, Mic, MicOff } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string, images?: string[]) => void;
  disabled: boolean;
  supportsVision?: boolean;
  supportsVoice?: boolean;
}

export function ChatInput({ onSend, disabled, supportsVision, supportsVoice }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [imagePreview, setImagePreview] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const speechSupported =
    supportsVoice && typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      setValue((prev) => {
        const base = finalTranscript || "";
        return prev.split(/\n/).slice(0, -1).join("\n") +
          (prev.includes("\n") ? "\n" : "") +
          base + (interim ? interim : "");
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript) {
        setValue((prev) => prev.trimEnd() + " ");
      }
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((!trimmed && imagePreview.length === 0) || disabled) return;
    // Stop listening on send
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    onSend(trimmed || "Describe this image.", imagePreview.length > 0 ? imagePreview : undefined);
    setValue("");
    setImagePreview([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImagePreview((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImagePreview((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-2">
      {/* Image previews */}
      {imagePreview.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {imagePreview.map((src, i) => (
            <div key={i} className="relative group">
              <img
                src={src}
                alt={`Attachment ${i + 1}`}
                className="h-16 w-16 rounded-lg object-cover border border-border"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Listening indicator */}
      {isListening && (
        <div className="flex items-center gap-2 px-2 pb-2 text-xs text-primary font-mono animate-pulse">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Listening... speak now
        </div>
      )}

      <div className="flex items-end gap-2">
        {supportsVision && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach image"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-all hover:text-foreground hover:bg-secondary disabled:opacity-30"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Voice input button */}
        {speechSupported && (
          <button
            onClick={toggleListening}
            disabled={disabled}
            title={isListening ? "Stop listening" : "Voice input"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all disabled:opacity-30 ${
              isListening
                ? "border-red-500/50 bg-red-500/10 text-red-500 shadow-[0_0_8px_hsl(0_80%_50%/0.3)]"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            speechSupported
              ? "Type or use 🎙️ voice..."
              : supportsVision
                ? "Type a message or attach an image..."
                : "Type a message..."
          }
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || (!value.trim() && imagePreview.length === 0)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:opacity-30"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
