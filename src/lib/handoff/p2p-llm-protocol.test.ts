import { describe, expect, it } from "vitest";

import type { ConversationMessage, LlmProvider } from "./hybrid-llm-handoff";
import { P2PLlmPeer, type PeerTransport } from "./p2p-llm-protocol";

function createEchoProvider(prefix: string): LlmProvider {
  return {
    async generateStream(messages, handlers) {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const response = `${prefix}:${lastUserMessage}`;
      for (const token of response.split("")) {
        handlers.onToken?.(token);
      }
      handlers.onComplete?.(response);
      return response;
    },
  };
}

function createLinkedTransports(): [PeerTransport, PeerTransport] {
  const leftHandlers = new Set<(payload: string) => void>();
  const rightHandlers = new Set<(payload: string) => void>();

  const left: PeerTransport = {
    send(payload) {
      rightHandlers.forEach((handler) => handler(payload));
    },
    onMessage(handler) {
      leftHandlers.add(handler);
      return () => leftHandlers.delete(handler);
    },
  };

  const right: PeerTransport = {
    send(payload) {
      leftHandlers.forEach((handler) => handler(payload));
    },
    onMessage(handler) {
      rightHandlers.add(handler);
      return () => rightHandlers.delete(handler);
    },
  };

  return [left, right];
}

describe("P2PLlmPeer", () => {
  it("streams tokens from serving peer and resolves final completion", async () => {
    const [clientTransport, serverTransport] = createLinkedTransports();

    const serverPeer = new P2PLlmPeer({ role: "server", provider: createEchoProvider("peer") });
    const clientPeer = new P2PLlmPeer({ role: "client" });

    serverPeer.attachTransport(serverTransport);
    clientPeer.attachTransport(clientTransport);

    const receivedTokens: string[] = [];
    const completion = await clientPeer.requestCompletion(
      [{ role: "user", content: "hello-p2p" } satisfies ConversationMessage],
      {
        onToken: (token) => receivedTokens.push(token),
      }
    );

    expect(completion).toBe("peer:hello-p2p");
    expect(receivedTokens.join("")).toBe("peer:hello-p2p");
  });

  it("returns protocol error if requester talks to non-serving peer", async () => {
    const [left, right] = createLinkedTransports();

    const receiverOnlyPeer = new P2PLlmPeer({ role: "client" });
    const requesterPeer = new P2PLlmPeer({ role: "client" });

    receiverOnlyPeer.attachTransport(right);
    requesterPeer.attachTransport(left);

    await expect(requesterPeer.requestCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(
      "does not expose a provider"
    );
  });
});
