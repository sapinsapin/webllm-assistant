import { useState } from "react";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function WaitlistSignup() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail) || trimmedEmail.length > 255) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }
    setState("saving");
    const { error } = await supabase.from("leads").insert({
      name: (name.trim() || trimmedEmail.split("@")[0]).slice(0, 100),
      email: trimmedEmail,
      source: "waitlist",
    });
    if (error) {
      console.error("Waitlist signup failed:", error);
      setState("idle");
      toast({
        title: "Couldn't join the waitlist",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setState("done");
  };

  if (state === "done") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-mono text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" /> You're on the list!
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-xs font-mono text-muted-foreground transition-all hover:text-foreground hover:border-primary/40"
      >
        <Bell className="h-3.5 w-3.5" /> Join waitlist
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (optional)"
        maxLength={100}
        className="w-28 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        maxLength={255}
        autoFocus
        className="w-40 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
      />
      <button
        type="submit"
        disabled={state === "saving"}
        className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[10px] font-mono font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
      >
        {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Join"}
      </button>
    </form>
  );
}
