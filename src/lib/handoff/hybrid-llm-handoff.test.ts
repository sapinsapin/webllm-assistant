import { describe, expect, it, vi } from "vitest";
import { HybridLlmHandoff, type HandoffLocalProvider, type LlmProvider } from "./hybrid-llm-handoff";

function createFakeCloud(): LlmProvider {
  return {
    async generateStream(messages) {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      return `cloud:${lastUserMessage}`;
    },
  };
}

function createFakeLocal(delayMs = 0): HandoffLocalProvider {
  let loaded = false;

  return {
    async load() {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      loaded = true;
    },
    async generateStream(messages) {
      if (!loaded) throw new Error("local not loaded");
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      return `local:${lastUserMessage}`;
    },
  };
}

describe("HybridLlmHandoff", () => {
  it("uses cloud first while local model is still loading", async () => {
    vi.useFakeTimers();

    const handoff = new HybridLlmHandoff(createFakeCloud(), createFakeLocal(50), {
      localModelId: "test-model",
    });

    handoff.startBackgroundLoad();

    const responsePromise = handoff.sendUserMessage("hello");
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toBe("cloud:hello");
    expect(handoff.getHistory()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "cloud:hello" },
    ]);

    vi.useRealTimers();
  });

  it("switches to local after load and preserves prompt history", async () => {
    const handoff = new HybridLlmHandoff(createFakeCloud(), createFakeLocal(), {
      localModelId: "test-model",
    });

    await handoff.start();

    await expect(handoff.sendUserMessage("first")).resolves.toBe("local:first");
    await expect(handoff.sendUserMessage("second")).resolves.toBe("local:second");

    expect(handoff.getHistory()).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "local:first" },
      { role: "user", content: "second" },
      { role: "assistant", content: "local:second" },
    ]);

    expect(handoff.getStatus().localRequests).toBe(2);
  });
});
