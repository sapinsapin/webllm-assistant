import type { EngineType } from "./inference/types";

export interface ModelPreset {
  id: string;
  name: string;
  size: string;
  url: string; // URL or WebLLM model ID
  description: string;
  gated: boolean;
  engine: EngineType;
  vision?: boolean;
}

export const PRESET_MODELS: ModelPreset[] = [
  // MediaPipe models (WebGPU required)
  {
    id: "gemma-270m",
    name: "Gemma 3 270M",
    size: "~200MB",
    url: "https://huggingface.co/litert-community/gemma-3-270m-it/resolve/main/gemma3-270m-it-q4_0-web.task",
    description: "Tiny model, fastest loading & inference. Great for testing.",
    gated: true,
    engine: "mediapipe",
  },
  {
    id: "gemma-1b",
    name: "Gemma 3 1B",
    size: "~555MB",
    url: "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-q4_0-web.task",
    description: "Good balance of quality and speed. Recommended for most devices.",
    gated: true,
    engine: "mediapipe",
  },
  {
    id: "gemma-4b",
    name: "Gemma 3 4B",
    size: "~2.3GB",
    url: "https://huggingface.co/litert-community/Gemma3-4B-IT/resolve/main/gemma3-4b-it-int4-web.task",
    description: "Strong quality, needs more VRAM. Best for powerful GPUs.",
    gated: true,
    engine: "mediapipe",
  },

  // Gemma 3n models (MediaPipe, WebGPU, vision-capable)
  {
    id: "gemma-3n-e2b",
    name: "Gemma 3n E2B",
    size: "~3.0GB",
    url: "https://huggingface.co/google/gemma-3n-E2B-it-litert-lm/resolve/main/gemma-3n-E2B-it-int4-Web.litertlm",
    description: "Gemma 3n E2B — multimodal (vision + text). Efficient on-device model.",
    gated: true,
    engine: "mediapipe",
    vision: true,
  },
  {
    id: "gemma-3n-e4b",
    name: "Gemma 3n E4B",
    size: "~4.3GB",
    url: "https://huggingface.co/google/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4-Web.litertlm",
    description: "Gemma 3n E4B — multimodal (vision + text). Higher quality, needs more VRAM.",
    gated: true,
    engine: "mediapipe",
    vision: true,
  },

  // Gemma 4 models (MediaPipe, WebGPU, vision-capable)
  {
    id: "gemma-4-e2b",
    name: "Gemma 4 E2B",
    size: "~2.0GB",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task",
    description: "Gemma 4 E2B — multimodal (vision + text). Next-gen reasoning & coding with 128K context.",
    gated: true,
    engine: "mediapipe",
    vision: true,
  },
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B",
    size: "~3.0GB",
    url: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.task",
    description: "Gemma 4 E4B — multimodal (vision + text). Higher quality, stronger reasoning with 128K context.",
    gated: true,
    engine: "mediapipe",
    vision: true,
  },

  {
    id: "webllm-smollm2-360m",
    name: "SmolLM2 360M",
    size: "~250MB",
    url: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    description: "Tiny model via WebLLM. Fast loading, basic capabilities.",
    gated: false,
    engine: "webllm",
  },
  {
    id: "webllm-llama-1b",
    name: "Llama 3.2 1B",
    size: "~700MB",
    url: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    description: "Compact Llama model via WebLLM. Good balance of speed and quality.",
    gated: false,
    engine: "webllm",
  },
  {
    id: "webllm-phi-3.5-mini",
    name: "Phi 3.5 Mini",
    size: "~2.2GB",
    url: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    description: "Microsoft Phi-3.5 via WebLLM. Strong reasoning for its size.",
    gated: false,
    engine: "webllm",
  },

  // Transformers.js models (WASM fallback — works everywhere including iOS)
  {
    id: "onnx-smollm2-135m",
    name: "SmolLM2 135M",
    size: "~100MB",
    url: "onnx-community/SmolLM2-135M-ONNX",
    description: "SmolLM2 135M via Transformers.js. Works on all browsers (WASM). Tiny and fast.",
    gated: false,
    engine: "onnx",
  },
];

export function getModelsForEngine(engine: EngineType): ModelPreset[] {
  return PRESET_MODELS.filter((m) => m.engine === engine);
}

/** Returns the smallest (first listed) non-gated model for an engine, or the first model available. */
export function getSmallestModel(engine: EngineType): ModelPreset | null {
  const models = getModelsForEngine(engine);
  return models.find((m) => !m.gated) || models[0] || null;
}

/** Returns the best engine+model combo for quick start (prefers smallest model across engines). */
export function getBestQuickStartModel(capabilities: { engine: EngineType; available: boolean; priority: number }[]): ModelPreset | null {
  const sorted = [...capabilities].filter(c => c.available).sort((a, b) => a.priority - b.priority);
  for (const cap of sorted) {
    const model = getModelsForEngine(cap.engine)[0];
    if (model) return model;
  }
  return null;
}

/** Returns the Gemma 4 E2B model preset if the device supports MediaPipe/WebGPU. */
export function getGemma4Model(capabilities: { engine: EngineType; available: boolean }[]): ModelPreset | null {
  const hasMediaPipe = capabilities.some(c => c.engine === "mediapipe" && c.available);
  if (!hasMediaPipe) return null;
  return PRESET_MODELS.find(m => m.id === "gemma-4-e2b") || null;
}

export type BenchmarkCategory = "ttft" | "short" | "medium" | "long" | "reasoning" | "long_context" | "multi_turn" | "concurrent";

export interface BenchmarkPrompt {
  label: string;
  prompt: string;
  category: BenchmarkCategory;
  description: string;
  /** For multi_turn: the conversation turns to send sequentially */
  turns?: string[];
  /** For concurrent: number of parallel requests to fire */
  concurrency?: number;
  /** For long_context: prefix context to prepend to the prompt */
  context?: string;
}

const LONG_CONTEXT_PASSAGE = `The following is a detailed technical document about distributed systems architecture. Distributed systems are collections of independent computers that appear to users as a single coherent system. They share state and coordinate actions through message passing. Key challenges include: (1) Network partitions - when nodes cannot communicate, the system must decide between consistency and availability per the CAP theorem. (2) Consensus - algorithms like Paxos and Raft ensure nodes agree on shared state despite failures. (3) Replication - data is copied across nodes for fault tolerance, using strategies like leader-follower or multi-leader replication. (4) Consistency models range from strong (linearizability) to weak (eventual consistency). (5) Clock synchronization is difficult; logical clocks (Lamport, vector) provide ordering without wall-clock agreement. (6) Failure detection uses heartbeats and phi-accrual detectors. (7) Sharding partitions data across nodes using hash or range partitioning. (8) Load balancing distributes requests evenly. (9) Service discovery enables nodes to find each other dynamically. (10) Observability through distributed tracing, metrics, and structured logging is essential for debugging. Modern microservice architectures face all these challenges simultaneously, requiring careful trade-off analysis for each subsystem.`;

export const BENCHMARK_CATEGORIES: Record<BenchmarkCategory, { label: string; description: string }> = {
  ttft: { label: "TTFT", description: "Time to First Token — minimal output, measures prefill latency" },
  short: { label: "Short", description: "Short generation (~1-2 sentences)" },
  medium: { label: "Medium", description: "Medium generation (~1 paragraph)" },
  long: { label: "Long", description: "Long generation (~multiple paragraphs)" },
  reasoning: { label: "Reasoning", description: "Multi-step reasoning tasks" },
  long_context: { label: "Long Context", description: "Large input context — measures prefill speed at scale" },
  multi_turn: { label: "Multi-Turn", description: "Multi-turn conversation — measures context accumulation overhead" },
  concurrent: { label: "Concurrent", description: "Parallel requests — measures throughput under load" },
};

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  // Existing categories
  { label: "Single word", prompt: "What is 2+2? Reply with just the number.", category: "ttft", description: "Measures pure prefill latency" },
  { label: "Yes/No", prompt: "Is the sky blue? Answer only yes or no.", category: "ttft", description: "Minimal decode, isolates TTFT" },
  { label: "Capital", prompt: "What is the capital of France?", category: "short", description: "One-sentence factual answer" },
  { label: "Haiku", prompt: "Write a haiku about technology.", category: "short", description: "Very short creative output" },
  { label: "Explain concept", prompt: "Explain what a neural network is in one paragraph.", category: "medium", description: "Single paragraph explanation" },
  { label: "Recipe", prompt: "Give me a simple recipe for pancakes with ingredients and steps.", category: "medium", description: "Structured medium-length output" },
  { label: "Essay", prompt: "Write a short essay about the impact of artificial intelligence on education. Include an introduction, three main points, and a conclusion.", category: "long", description: "Multi-paragraph structured essay" },
  { label: "Story", prompt: "Write a short story about a robot discovering emotions for the first time. Make it at least 3 paragraphs.", category: "long", description: "Creative long-form generation" },
  { label: "Math", prompt: "If a train travels 60 mph for 2.5 hours, how far does it go? Explain step by step.", category: "reasoning", description: "Step-by-step math reasoning" },
  { label: "Logic", prompt: "There are 5 houses in a row. The red house is to the left of the blue house. The green house is between the red and yellow houses. The white house is at the far right. What is the order of houses from left to right? Think step by step.", category: "reasoning", description: "Multi-step logic puzzle" },

  // Long context
  {
    label: "Context QA",
    prompt: "Based on the document above, what are the two main consensus algorithms mentioned and why are they important?",
    category: "long_context",
    description: "Question over ~300 word technical passage",
    context: LONG_CONTEXT_PASSAGE,
  },
  {
    label: "Context Summary",
    prompt: "Summarize the above document in exactly 3 bullet points.",
    category: "long_context",
    description: "Summarization of long input context",
    context: LONG_CONTEXT_PASSAGE,
  },

  // Multi-turn
  {
    label: "3-turn chat",
    prompt: "What is photosynthesis?",
    category: "multi_turn",
    description: "3-turn conversation with follow-ups",
    turns: [
      "What is photosynthesis?",
      "What are the two main stages?",
      "Why is it important for life on Earth?",
    ],
  },
  {
    label: "5-turn drill",
    prompt: "Name a programming language.",
    category: "multi_turn",
    description: "5-turn deepening conversation",
    turns: [
      "Name a programming language.",
      "What is it mainly used for?",
      "Give me a simple code example.",
      "What are its main advantages?",
      "What are its main disadvantages?",
    ],
  },

  // Concurrent
  {
    label: "2× parallel",
    prompt: "What is the speed of light?",
    category: "concurrent",
    description: "2 simultaneous requests",
    concurrency: 2,
  },
  {
    label: "4× parallel",
    prompt: "Define gravity in one sentence.",
    category: "concurrent",
    description: "4 simultaneous requests",
    concurrency: 4,
  },
];
