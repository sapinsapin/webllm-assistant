export interface ModelPreset {
  id: string;
  name: string;
  size: string;
  url: string;
  description: string;
  gated: boolean;
}

export const PRESET_MODELS: ModelPreset[] = [
  {
    id: "gemma-270m",
    name: "Gemma 3 270M",
    size: "~200MB",
    url: "https://huggingface.co/litert-community/gemma-3-270m-it/resolve/main/gemma3-270m-it-q4_0-web.task",
    description: "Tiny model, fastest loading & inference. Great for testing.",
    gated: true,
  },
  {
    id: "gemma-3n-e2b",
    name: "Gemma 3n E2B",
    size: "~1.5GB",
    url: "https://huggingface.co/google/gemma-3n-E2B-it-litert-lm/resolve/main/gemma-3n-E2B-it-int4-Web.litertlm",
    description: "Small model with good quality-to-size ratio.",
    gated: true,
  },
  {
    id: "gemma-3n-e4b",
    name: "Gemma 3n E4B",
    size: "~3GB",
    url: "https://huggingface.co/google/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4-Web.litertlm",
    description: "Larger model, better quality but slower to load.",
    gated: true,
  },
];

export type BenchmarkCategory = "ttft" | "short" | "medium" | "long" | "reasoning";

export interface BenchmarkPrompt {
  label: string;
  prompt: string;
  category: BenchmarkCategory;
  description: string;
}

export const BENCHMARK_CATEGORIES: Record<BenchmarkCategory, { label: string; description: string }> = {
  ttft: { label: "TTFT", description: "Time to First Token — minimal output, measures prefill latency" },
  short: { label: "Short", description: "Short generation (~1-2 sentences)" },
  medium: { label: "Medium", description: "Medium generation (~1 paragraph)" },
  long: { label: "Long", description: "Long generation (~multiple paragraphs)" },
  reasoning: { label: "Reasoning", description: "Multi-step reasoning tasks" },
};

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  // TTFT — designed for minimal output to isolate prefill time
  { label: "Single word", prompt: "What is 2+2? Reply with just the number.", category: "ttft", description: "Measures pure prefill latency" },
  { label: "Yes/No", prompt: "Is the sky blue? Answer only yes or no.", category: "ttft", description: "Minimal decode, isolates TTFT" },

  // Short output
  { label: "Capital", prompt: "What is the capital of France?", category: "short", description: "One-sentence factual answer" },
  { label: "Haiku", prompt: "Write a haiku about technology.", category: "short", description: "Very short creative output" },

  // Medium output
  { label: "Explain concept", prompt: "Explain what a neural network is in one paragraph.", category: "medium", description: "Single paragraph explanation" },
  { label: "Recipe", prompt: "Give me a simple recipe for pancakes with ingredients and steps.", category: "medium", description: "Structured medium-length output" },

  // Long output
  { label: "Essay", prompt: "Write a short essay about the impact of artificial intelligence on education. Include an introduction, three main points, and a conclusion.", category: "long", description: "Multi-paragraph structured essay" },
  { label: "Story", prompt: "Write a short story about a robot discovering emotions for the first time. Make it at least 3 paragraphs.", category: "long", description: "Creative long-form generation" },

  // Reasoning
  { label: "Math", prompt: "If a train travels 60 mph for 2.5 hours, how far does it go? Explain step by step.", category: "reasoning", description: "Step-by-step math reasoning" },
  { label: "Logic", prompt: "There are 5 houses in a row. The red house is to the left of the blue house. The green house is between the red and yellow houses. The white house is at the far right. What is the order of houses from left to right? Think step by step.", category: "reasoning", description: "Multi-step logic puzzle" },
];
