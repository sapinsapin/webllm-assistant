import type { ConversationMessage, LlmProvider, StreamHandlers } from "./hybrid-llm-handoff";

export type PeerRole = "client" | "server";

export interface PeerTransport {
  send(payload: string): void;
  onMessage(handler: (payload: string) => void): () => void;
  onClose?(handler: () => void): () => void;
  close?(): void;
}

export interface P2PRequest {
  requestId: string;
  messages: ConversationMessage[];
}

export type P2PProtocolMessage =
  | { type: "hello"; peerId: string; role: PeerRole; protocolVersion: 1 }
  | { type: "request"; request: P2PRequest }
  | { type: "token"; requestId: string; token: string }
  | { type: "complete"; requestId: string; response: string }
  | { type: "cancel"; requestId: string }
  | { type: "error"; requestId?: string; message: string }
  | { type: "ping"; timestamp: number }
  | { type: "pong"; timestamp: number };

interface PendingRequest {
  chunks: string[];
  handlers: StreamHandlers;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

export interface P2PLlmPeerOptions {
  peerId?: string;
  role: PeerRole;
  provider?: LlmProvider;
}

/**
 * WebRTC-like bidirectional protocol for p2p LLM serving over a data channel.
 *
 * This class focuses on protocol framing and request lifecycle; callers can plug
 * in any transport that looks like RTCDataChannel.
 */
export class P2PLlmPeer {
  private readonly peerId: string;
  private readonly role: PeerRole;
  private readonly provider?: LlmProvider;

  private transport: PeerTransport | null = null;
  private unsubscribeMessage?: () => void;
  private unsubscribeClose?: () => void;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly runningRequests = new Map<string, AbortController>();
  private readonly idSeed = Math.random().toString(36).slice(2);
  private sequence = 0;

  constructor(options: P2PLlmPeerOptions) {
    this.role = options.role;
    this.provider = options.provider;
    this.peerId = options.peerId ?? `${this.role}-${Math.random().toString(36).slice(2, 10)}`;
  }

  attachTransport(transport: PeerTransport): void {
    this.detachTransport();

    this.transport = transport;
    this.unsubscribeMessage = transport.onMessage((payload) => {
      this.onRawMessage(payload);
    });
    this.unsubscribeClose = transport.onClose?.(() => {
      this.failAllPending(new Error("Transport closed"));
    });

    this.send({
      type: "hello",
      role: this.role,
      peerId: this.peerId,
      protocolVersion: 1,
    });
  }

  detachTransport(): void {
    this.unsubscribeMessage?.();
    this.unsubscribeClose?.();
    this.unsubscribeMessage = undefined;
    this.unsubscribeClose = undefined;
    this.transport = null;
  }

  async requestCompletion(messages: ConversationMessage[], handlers: StreamHandlers = {}): Promise<string> {
    if (!this.transport) {
      throw new Error("Peer transport is not attached");
    }

    const requestId = this.nextRequestId();

    return new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        chunks: [],
        handlers,
        resolve,
        reject,
      });

      this.send({
        type: "request",
        request: {
          requestId,
          messages,
        },
      });
    });
  }

  cancelRequest(requestId: string): void {
    this.send({ type: "cancel", requestId });
    this.pendingRequests.get(requestId)?.reject(new Error(`Request cancelled: ${requestId}`));
    this.pendingRequests.delete(requestId);
  }

  ping(): void {
    this.send({ type: "ping", timestamp: Date.now() });
  }

  close(): void {
    this.failAllPending(new Error("Peer closed"));
    this.detachTransport();
  }

  private onRawMessage(payload: string): void {
    let message: P2PProtocolMessage;
    try {
      message = JSON.parse(payload) as P2PProtocolMessage;
    } catch {
      this.send({ type: "error", message: "Malformed protocol payload" });
      return;
    }

    switch (message.type) {
      case "hello":
        return;
      case "request":
        void this.handleInboundRequest(message.request);
        return;
      case "token": {
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) return;
        pending.chunks.push(message.token);
        pending.handlers.onToken?.(message.token);
        return;
      }
      case "complete": {
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) return;
        pending.handlers.onComplete?.(message.response);
        pending.resolve(message.response);
        this.pendingRequests.delete(message.requestId);
        return;
      }
      case "error": {
        if (message.requestId) {
          const pending = this.pendingRequests.get(message.requestId);
          if (pending) {
            pending.reject(new Error(message.message));
            this.pendingRequests.delete(message.requestId);
          }
        }
        return;
      }
      case "cancel": {
        const running = this.runningRequests.get(message.requestId);
        running?.abort();
        this.runningRequests.delete(message.requestId);
        return;
      }
      case "ping":
        this.send({ type: "pong", timestamp: message.timestamp });
        return;
      case "pong":
        return;
      default:
        this.send({ type: "error", message: "Unsupported protocol message" });
    }
  }

  private async handleInboundRequest(request: P2PRequest): Promise<void> {
    if (!this.provider) {
      this.send({
        type: "error",
        requestId: request.requestId,
        message: "This peer does not expose a provider",
      });
      return;
    }

    const abortController = new AbortController();
    this.runningRequests.set(request.requestId, abortController);

    try {
      const response = await this.provider.generateStream(
        request.messages,
        {
          onToken: (token) => {
            this.send({ type: "token", requestId: request.requestId, token });
          },
        },
        abortController.signal
      );

      this.send({ type: "complete", requestId: request.requestId, response });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown peer serving error";
      this.send({ type: "error", requestId: request.requestId, message });
    } finally {
      this.runningRequests.delete(request.requestId);
    }
  }

  private send(message: P2PProtocolMessage): void {
    this.transport?.send(JSON.stringify(message));
  }

  private nextRequestId(): string {
    this.sequence += 1;
    return `${this.idSeed}-${this.sequence}`;
  }

  private failAllPending(error: Error): void {
    this.pendingRequests.forEach((pending) => pending.reject(error));
    this.pendingRequests.clear();
  }
}

export function createRtcDataChannelTransport(channel: RTCDataChannel): PeerTransport {
  return {
    send(payload) {
      channel.send(payload);
    },
    onMessage(handler) {
      const listener = (event: MessageEvent<string>) => {
        handler(event.data);
      };
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    onClose(handler) {
      const listener = () => handler();
      channel.addEventListener("close", listener);
      return () => channel.removeEventListener("close", listener);
    },
    close() {
      channel.close();
    },
  };
}
