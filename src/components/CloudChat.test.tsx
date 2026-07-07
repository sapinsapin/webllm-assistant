import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const insertMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: unknown) => ({
        then: (cb: (r: { error: unknown }) => void) => Promise.resolve(insertMock(table, row)).then(cb),
      }),
    }),
  },
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

// CloudBenchmark pulls in heavier deps; not under test here.
vi.mock("@/components/CloudBenchmark", () => ({
  CloudBenchmark: () => null,
}));

import { CloudChat } from "./CloudChat";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const sseChunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

function sendChat(text: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

beforeEach(() => {
  insertMock.mockReset().mockReturnValue({ error: null });
  toastErrorMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("CloudChat", () => {
  it("streams the assistant reply into the chat", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([sseChunk("Hello"), sseChunk(" there!"), "data: [DONE]\n"])
    );
    render(<CloudChat />);

    sendChat("Hi");

    expect(await screen.findByText("Hello there!")).toBeInTheDocument();
  });

  it("handles an SSE event split across network chunks", async () => {
    const full = sseChunk("Hello world");
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([full.slice(0, 15), full.slice(15), "data: [DONE]\n"])
    );
    render(<CloudChat />);

    sendChat("Hi");

    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("shows an error banner when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Hourly token limit reached. Please wait." }), { status: 429 })
    );
    render(<CloudChat />);

    sendChat("Hi");

    // Failure appears in the error banner (and as an in-chat error message)
    expect((await screen.findAllByText(/Hourly token limit reached/)).length).toBeGreaterThan(0);
  });

  it("shows an error banner on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Failed to fetch"));
    render(<CloudChat />);

    sendChat("Hi");

    expect(await screen.findAllByText(/Failed to fetch/)).not.toHaveLength(0);
  });

  it("surfaces an empty upstream response as an error instead of a blank bubble", async () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse(["data: [DONE]\n"]));
    render(<CloudChat />);

    sendChat("Hi");

    expect((await screen.findAllByText(/empty response/i)).length).toBeGreaterThan(0);
  });

  it("saves the lead after the second user message", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      sseResponse([sseChunk("ok"), "data: [DONE]\n"])
    );
    render(<CloudChat />);

    sendChat("Ada Lovelace");
    await screen.findByText("ok");
    sendChat("sure, ada@example.com");

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith("leads", {
        name: "Ada Lovelace",
        email: "ada@example.com",
        source: "cloud_chat",
      });
    });
  });

  it("toasts and retries on the next message when saving the lead fails", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      sseResponse([sseChunk("ok"), "data: [DONE]\n"])
    );
    insertMock.mockReturnValueOnce({ error: { message: "insert denied" } });
    render(<CloudChat />);

    sendChat("Ada Lovelace");
    await waitFor(() => expect(screen.getAllByText("ok").length).toBeGreaterThan(0));
    sendChat("ada@example.com");

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't save your signup")
      );
    });
    expect(insertMock).toHaveBeenCalledTimes(1);

    // Next user message triggers the retry, which now succeeds
    sendChat("thanks!");
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
  });
});
