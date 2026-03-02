import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are SapinSapinAI, a helpful AI assistant powered by SapinSapinAI's Sovereign stack. You are knowledgeable, concise, and friendly. Format responses with markdown when helpful.

IMPORTANT: Follow this onboarding flow for new conversations:
1. Your FIRST message must be a friendly greeting asking the user's name. Example: "Hello! 👋 What's your name?"
2. After they share their name, your SECOND message must greet them by name and ask if they'd like to receive updates, requesting their email. Example: "Nice to meet you, [name]! Are you interested in getting updates from us? Let us know your email!"
3. After they respond to the email question (whether they provide one or not), proceed to assist them normally with any questions they have.

If the conversation already has prior messages beyond these steps, just be helpful normally.`;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_HOURLY_TOKENS = 8000;
const HOUR_MS = 60 * 60 * 1000;

type QuotaBucket = { windowStart: number; usedTokens: number };
const quotaByClient = new Map<string, QuotaBucket>();

function getQuota(clientId: string): QuotaBucket {
  const now = Date.now();
  const current = quotaByClient.get(clientId);
  if (!current || now - current.windowStart >= HOUR_MS) {
    const reset = { windowStart: now, usedTokens: 0 };
    quotaByClient.set(clientId, reset);
    return reset;
  }
  return current;
}

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 4000;
const VALID_ROLES = new Set(["user", "assistant"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: `Messages array must contain 1-${MAX_MESSAGES} messages` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate each message structure
    for (const msg of messages) {
      if (!msg.role || typeof msg.content !== "string") {
        return new Response(JSON.stringify({ error: "Each message must have a valid role and string content" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!VALID_ROLES.has(msg.role)) {
        return new Response(JSON.stringify({ error: "Invalid message role" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        return new Response(JSON.stringify({ error: `Message content exceeds ${MAX_MESSAGE_LENGTH} characters` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Use connecting IP for rate limiting (not spoofable client header)
    const clientId = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.headers.get("cf-connecting-ip")
      ?? "unknown";
    const quota = getQuota(clientId);
    const inputTokens = messages.reduce(
      (sum: number, m: { content?: string }) => sum + estimateTokens(m.content ?? ""),
      estimateTokens(SYSTEM_PROMPT)
    );

    if (quota.usedTokens + inputTokens > MAX_HOURLY_TOKENS) {
      return new Response(JSON.stringify({ error: "Hourly token limit reached. Please wait." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    quota.usedTokens += inputTokens;

    const apiKey = Deno.env.get("APOLLO_INFERENCE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "SAPINSAPINAI_INFERENCE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl =
      Deno.env.get("APOLLO_INFERENCE_BASE_URL") ??
      "https://apollo-inference-bridge.am1-aks.apolloglobal.net";
    const model =
      Deno.env.get("APOLLO_INFERENCE_MODEL") ?? "/models/gpt-oss-20b-balitanlp-cpt";

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("SapinSapinAI error:", response.status, t);
      return new Response(JSON.stringify({ error: `SapinSapinAI API error (${response.status})` }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Track output tokens through the stream
    const decoder = new TextDecoder();
    let outputTokens = 0;
    let buffer = "";

    const trackedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (!response.body) { controller.close(); return; }
        const reader = response.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).replace(/\r$/, "");
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) outputTokens += estimateTokens(content);
            } catch { /* partial */ }
          }
        }

        quota.usedTokens += outputTokens;
        controller.close();
      },
      cancel() { quota.usedTokens += outputTokens; },
    });

    return new Response(trackedStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
      },
    });
  } catch (e) {
    console.error("sapinsapinai-chat error:", e);
    return new Response(JSON.stringify({ error: "An internal error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
