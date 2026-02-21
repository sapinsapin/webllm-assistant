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

export const BENCHMARK_PROMPTS = [
  { label: "Short answer", prompt: "What is the capital of France?" },
  { label: "Creative", prompt: "Write a haiku about technology." },
  { label: "Reasoning", prompt: "If a train travels 60 mph for 2.5 hours, how far does it go? Explain step by step." },
  { label: "Coding", prompt: "Write a JavaScript function that reverses a string." },
];
