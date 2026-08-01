import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Semaphore } from "../_shared/semaphore.ts";
import {
  JUDGE_SYSTEM_PROMPT,
  buildEvalBlock,
  extractJudgeResults,
  validateItems,
  type JudgeRequest,
  type JudgeResult,
} from "./parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 10; // smaller batches to avoid compute limits
const UPSTREAM_TIMEOUT_MS = 60_000;
const PARSE_RETRIES = 1; // one corrective retry per batch before falling back

// Bound concurrent judge requests per isolate: each request runs several
// sequential upstream batches, so a burst of simultaneous eval runs would
// otherwise stampede the inference bridge. Excess requests briefly queue,
// then shed with 503 + Retry-After.
const upstreamSemaphore = new Semaphore(6, 24);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callJudge(
  messages: { role: string; content: string }[],
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Judge API error:", response.status, errText);
    if (response.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(`API error (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Judge one batch with a validate → retry → explicit-fallback loop:
 * 1. Ask for strict JSON.
 * 2. Validate every entry against the schema; drop invalid ones.
 * 3. If items are missing, retry ONCE with a corrective message.
 * 4. Items still missing are returned with judged:false — never a made-up score.
 */
async function judgeBatch(
  items: JudgeRequest[],
  startIndex: number,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<JudgeResult[]> {
  const evalBlock = buildEvalBlock(items, startIndex);
  const validIndices = new Set(items.map((_, i) => startIndex + i + 1));

  const messages = [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: evalBlock },
  ];

  let judged = new Map<number, { score: number; reasoning: string }>();
  for (let attempt = 0; attempt <= PARSE_RETRIES; attempt++) {
    const content = await callJudge(messages, apiKey, baseUrl, model);
    judged = extractJudgeResults(content, validIndices);
    if (judged.size === items.length) break;

    if (attempt < PARSE_RETRIES) {
      const missing = [...validIndices].filter((i) => !judged.has(i));
      console.warn(`Judge parse incomplete (attempt ${attempt + 1}): got ${judged.size}/${items.length}. Retrying for indices ${missing.join(",")}`);
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `Your previous reply was not a valid JSON array covering every eval. Respond again with ONLY the JSON array, one object per eval, covering indices: ${missing.join(", ")}. No markdown, no commentary.`,
        },
      );
    }
  }

  return items.map((_, i) => {
    const index = startIndex + i + 1;
    const hit = judged.get(index);
    if (hit) return { index, score: hit.score, reasoning: hit.reasoning, judged: true };
    // Explicit, honest fallback: the client uses keyword scoring for this item.
    return {
      index,
      score: 0,
      reasoning: "Judge output could not be validated for this item; keyword score applies.",
      judged: false,
    };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("APOLLO_INFERENCE_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "APOLLO_INFERENCE_API_KEY not configured" }, 500);
    }

    let body: { items?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON" }, 400);
    }

    const validationError = validateItems(body.items);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }
    const items = body.items as JudgeRequest[];

    const acquired = await upstreamSemaphore.acquire();
    if (!acquired) {
      return new Response(JSON.stringify({ error: "Judge is at capacity, please retry shortly." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
      });
    }

    try {
      const baseUrl =
        Deno.env.get("APOLLO_INFERENCE_BASE_URL") ??
        "https://apollo-inference-bridge.am1-aks.apolloglobal.net";
      const model =
        Deno.env.get("APOLLO_INFERENCE_MODEL") ?? "/models/gpt-oss-20b-balitanlp-cpt";

      // Process in smaller batches, sequentially, to stay within compute limits.
      const allResults: JudgeResult[] = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchResults = await judgeBatch(batch, i, apiKey, baseUrl, model);
        allResults.push(...batchResults);
      }

      return jsonResponse({ results: allResults });
    } finally {
      upstreamSemaphore.release();
    }
  } catch (e) {
    console.error("eval-judge error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "RATE_LIMITED" ? 429 : 500;
    return jsonResponse({ error: message }, status);
  }
});
