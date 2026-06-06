// Public MCP (Model Context Protocol) server for Can I AI.
// Lets external AI agents run the same on-device benchmark suite and submit results.
// Streamable HTTP transport — discoverable at /.well-known/mcp.json on the site.

import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ----- Benchmark suite (kept in sync with src/lib/models.ts BENCHMARK_PROMPTS) -----
const LONG_CONTEXT_PASSAGE =
  "The following is a detailed technical document about distributed systems architecture. Distributed systems are collections of independent computers that appear to users as a single coherent system. They share state and coordinate actions through message passing. Key challenges include: (1) Network partitions - when nodes cannot communicate, the system must decide between consistency and availability per the CAP theorem. (2) Consensus - algorithms like Paxos and Raft ensure nodes agree on shared state despite failures. (3) Replication - data is copied across nodes for fault tolerance. (4) Consistency models range from strong (linearizability) to weak (eventual consistency). (5) Clock synchronization uses logical clocks like Lamport and vector clocks. (6) Failure detection uses heartbeats and phi-accrual detectors. (7) Sharding partitions data across nodes. (8) Load balancing distributes requests. (9) Service discovery enables nodes to find each other. (10) Observability via tracing, metrics, and structured logging is essential.";

const BENCHMARK_PROMPTS = [
  { label: "Single word", prompt: "What is 2+2? Reply with just the number.", category: "ttft" },
  { label: "Yes/No", prompt: "Is the sky blue? Answer only yes or no.", category: "ttft" },
  { label: "Capital", prompt: "What is the capital of France?", category: "short" },
  { label: "Haiku", prompt: "Write a haiku about technology.", category: "short" },
  { label: "Explain concept", prompt: "Explain what a neural network is in one paragraph.", category: "medium" },
  { label: "Recipe", prompt: "Give me a simple recipe for pancakes with ingredients and steps.", category: "medium" },
  { label: "Essay", prompt: "Write a short essay about the impact of artificial intelligence on education. Include an introduction, three main points, and a conclusion.", category: "long" },
  { label: "Story", prompt: "Write a short story about a robot discovering emotions for the first time. Make it at least 3 paragraphs.", category: "long" },
  { label: "Math", prompt: "If a train travels 60 mph for 2.5 hours, how far does it go? Explain step by step.", category: "reasoning" },
  { label: "Logic", prompt: "There are 5 houses in a row. The red house is to the left of the blue house. The green house is between the red and yellow houses. The white house is at the far right. What is the order of houses from left to right? Think step by step.", category: "reasoning" },
  { label: "Context QA", prompt: "Based on the document above, what are the two main consensus algorithms mentioned and why are they important?", category: "long_context", context: LONG_CONTEXT_PASSAGE },
  { label: "Context Summary", prompt: "Summarize the above document in exactly 3 bullet points.", category: "long_context", context: LONG_CONTEXT_PASSAGE },
  { label: "3-turn chat", prompt: "What is photosynthesis?", category: "multi_turn", turns: ["What is photosynthesis?", "What are the two main stages?", "Why is it important for life on Earth?"] },
  { label: "5-turn drill", prompt: "Name a programming language.", category: "multi_turn", turns: ["Name a programming language.", "What is it mainly used for?", "Give me a simple code example.", "What are its main advantages?", "What are its main disadvantages?"] },
  { label: "2× parallel", prompt: "What is the speed of light?", category: "concurrent", concurrency: 2 },
  { label: "4× parallel", prompt: "Define gravity in one sentence.", category: "concurrent", concurrency: 4 },
];

const METHODOLOGY = {
  metrics: {
    tokens_per_second: "Decoded tokens / wall-clock generation time (s), per prompt, averaged across runs.",
    ttft_ms: "Time to first token in ms — measures prefill latency.",
    tpot_ms: "Time per output token in ms — average inter-token latency during decode.",
    verdict: "Excellent>=20, Good>=10, Usable>=4, Slow>=1, Unusable<1 (avg_tps over the suite).",
  },
  runs_per_prompt: 3,
  warmup: "First run per prompt discarded when averaging.",
  categories: ["ttft", "short", "medium", "long", "reasoning", "long_context", "multi_turn", "concurrent"],
};

const PRESET_MODELS = [
  { id: "gemma-3-1b-it", engine: "mediapipe", size_gb: 0.5, family: "gemma" },
  { id: "gemma-3-4b-it", engine: "mediapipe", size_gb: 2.7, family: "gemma" },
  { id: "gemma-3n-e2b-it", engine: "mediapipe", size_gb: 1.5, family: "gemma", vision: true },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", engine: "webllm", size_gb: 0.9, family: "llama" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", engine: "webllm", size_gb: 2.0, family: "llama" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", engine: "webllm", size_gb: 2.2, family: "phi" },
  { id: "SmolLM2-1.7B-Instruct", engine: "onnx", size_gb: 1.0, family: "smollm" },
];

function verdictFor(tps: number): string {
  if (tps >= 20) return "Excellent";
  if (tps >= 10) return "Good";
  if (tps >= 4) return "Usable";
  if (tps >= 1) return "Slow";
  return "Unusable";
}

// ----- MCP server -----
const mcp = new McpServer({
  name: "can-i-ai",
  version: "1.0.0",
});

mcp.tool({
  name: "list_benchmark_prompts",
  description:
    "Return the full Can I AI benchmark suite (16 prompts across 8 categories). Run each prompt locally with your model and submit the result via submit_benchmark_run.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => ({
    content: [{ type: "text", text: JSON.stringify({ prompts: BENCHMARK_PROMPTS, methodology: METHODOLOGY }, null, 2) }],
  }),
});

mcp.tool({
  name: "get_methodology",
  description: "Return scoring rules, metric definitions, and verdict thresholds used by Can I AI.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => ({
    content: [{ type: "text", text: JSON.stringify(METHODOLOGY, null, 2) }],
  }),
});

mcp.tool({
  name: "list_model_presets",
  description: "Return the catalogue of models Can I AI knows how to benchmark (id, engine, approx size, family, vision flag).",
  inputSchema: { type: "object", properties: {} },
  handler: async () => ({
    content: [{ type: "text", text: JSON.stringify(PRESET_MODELS, null, 2) }],
  }),
});

mcp.tool({
  name: "get_community_benchmarks",
  description:
    "Query historical benchmark runs from the community. Optionally filter by model_name (ILIKE), engine, or device_type. Returns up to `limit` rows (default 25, max 100).",
  inputSchema: {
    type: "object",
    properties: {
      model_name: { type: "string", description: "Substring to match against model_name" },
      engine: { type: "string", description: "mediapipe | webllm | onnx" },
      device_type: { type: "string", description: "desktop | mobile | tablet" },
      limit: { type: "number", description: "Max rows (1-100)", default: 25 },
    },
  },
  handler: async (args: any) => {
    const limit = Math.min(Math.max(args?.limit ?? 25, 1), 100);
    let q = supabase
      .from("benchmark_runs")
      .select(
        "id, created_at, model_name, engine, avg_tps, avg_ttft_ms, verdict, device_model, device_type, os, browser, gpu, ram_gb, country",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (args?.model_name) q = q.ilike("model_name", `%${args.model_name}%`);
    if (args?.engine) q = q.eq("engine", args.engine);
    if (args?.device_type) q = q.eq("device_type", args.device_type);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify({ count: data?.length ?? 0, rows: data }, null, 2) }] };
  },
});

mcp.tool({
  name: "submit_benchmark_run",
  description:
    "Submit a completed benchmark run to the community feed. Provide at minimum model_name, engine, and avg_tps; verdict is computed if omitted. Include device hardware fields when known so the result is comparable.",
  inputSchema: {
    type: "object",
    properties: {
      model_name: { type: "string" },
      engine: { type: "string", description: "mediapipe | webllm | onnx | cloud | other" },
      avg_tps: { type: "number" },
      avg_ttft_ms: { type: "number" },
      verdict: { type: "string" },
      device_model: { type: "string" },
      device_type: { type: "string" },
      os: { type: "string" },
      browser: { type: "string", description: "User-agent or runtime, e.g. 'node 22.5'" },
      cores: { type: "number" },
      ram_gb: { type: "number" },
      gpu: { type: "string" },
      gpu_vendor: { type: "string" },
      country: { type: "string" },
      results: {
        type: "array",
        description: "Per-prompt results: { prompt, category, tokensGenerated, timeMs, tokensPerSecond, ttftMs, tpotMs }",
      },
    },
    required: ["model_name", "engine", "avg_tps"],
  },
  handler: async (args: any) => {
    const row = {
      model_name: String(args.model_name).slice(0, 200),
      engine: String(args.engine).slice(0, 50),
      avg_tps: Number(args.avg_tps),
      avg_ttft_ms: Number(args.avg_ttft_ms ?? 0),
      verdict: args.verdict ? String(args.verdict) : verdictFor(Number(args.avg_tps)),
      device_model: args.device_model ?? null,
      device_type: args.device_type ?? null,
      os: args.os ?? null,
      browser: args.browser ?? "mcp-agent",
      cores: args.cores ?? null,
      ram_gb: args.ram_gb ?? null,
      gpu: args.gpu ?? null,
      gpu_vendor: args.gpu_vendor ?? null,
      country: args.country ?? null,
      user_agent: "mcp:can-i-ai/1.0",
      results: args.results ?? [],
    };
    const { data, error } = await supabase
      .from("benchmark_runs")
      .insert(row)
      .select("id, created_at, verdict")
      .single();
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify({ ok: true, id: data.id, verdict: data.verdict, view_url: `https://www.caniaitest.com/benchmarks` }, null, 2) },
      ],
    };
  },
});

// ----- HTTP transport -----
const app = new Hono();
const transport = new StreamableHttpTransport();

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  await next();
  for (const [k, v] of Object.entries(corsHeaders)) c.res.headers.set(k, v);
});

// Discovery / health
app.get("/mcp/info", (c) =>
  c.json({
    name: "can-i-ai",
    version: "1.0.0",
    transport: "streamable-http",
    tools: ["list_benchmark_prompts", "get_methodology", "list_model_presets", "get_community_benchmarks", "submit_benchmark_run"],
  }),
);

app.all("/*", async (c) => await transport.handleRequest(c.req.raw, mcp));

Deno.serve(app.fetch);