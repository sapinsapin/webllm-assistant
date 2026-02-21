/// <reference types="vite/client" />

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPU {}

  const FilesetResolver: {
    forGenAiTasks: (wasmPath: string) => Promise<unknown>;
  };

  const LlmInference: {
    createFromOptions: (genai: unknown, options: Record<string, unknown>) => Promise<LlmInferenceInstance>;
  };

  interface LlmInferenceInstance {
    generateResponse(prompt: string): Promise<string>;
    generateResponse(prompt: string, callback: (partial: string, done: boolean) => void): Promise<void>;
  }
}

export {};
