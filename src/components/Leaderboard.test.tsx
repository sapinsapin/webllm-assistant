import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  limitMock: vi.fn(),
  eqCalls: [] as Array<[string, unknown]>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          h.eqCalls.push([col, val]);
          return {
            eq: (col2: string, val2: unknown) => {
              h.eqCalls.push([col2, val2]);
              return { order: () => ({ limit: h.limitMock }) };
            },
          };
        },
      }),
    }),
  },
}));

import { Leaderboard } from "./Leaderboard";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  spec_version: "2026.09",
  division: "closed",
  model_id: "webllm-llama-1b",
  engine: "webllm",
  device_key: "MacBook Pro M4",
  device_type: "desktop",
  model_name: "Llama 3.2 1B",
  gpu: "Apple M4",
  runs: 6,
  score_p50: 41.2,
  score_p25: 39,
  score_p75: 43,
  ttft_p90_p50_ms: 180,
  last_run_at: new Date().toISOString(),
  ...over,
});

describe("Leaderboard states", () => {
  beforeEach(() => {
    h.limitMock.mockReset();
    h.eqCalls.length = 0;
  });

  it("shows loading skeletons while pending", () => {
    h.limitMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<Leaderboard />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows an error with retry when the fetch fails — never the empty board", async () => {
    h.limitMock.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    renderWithQuery(<Leaderboard />);
    // The component sets retry: 2 (overriding the client default), so the
    // error surfaces only after React Query's backoff — wait for it.
    expect(await screen.findByText("Couldn't load the leaderboard", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText("relation does not exist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No certified/)).not.toBeInTheDocument();
  }, 15_000);

  it("shows the empty state only for a successful empty result", async () => {
    h.limitMock.mockResolvedValue({ data: [], error: null });
    renderWithQuery(<Leaderboard />);
    expect(await screen.findByText(/No certified closed-division runs/)).toBeInTheDocument();
  });

  it("queries the current round and closed division by default, ranks rows, and shows confidence", async () => {
    h.limitMock.mockResolvedValue({
      data: [
        row({ device_key: "Pixel 9", device_type: "mobile", score_p50: 9.5, runs: 1, score_p25: null, score_p75: null }),
        row(),
      ],
      error: null,
    });
    renderWithQuery(<Leaderboard />);

    expect(await screen.findByText("MacBook Pro M4")).toBeInTheDocument();
    expect(h.eqCalls).toContainEqual(["spec_version", "2026.09"]);
    expect(h.eqCalls).toContainEqual(["division", "closed"]);

    const cells = screen.getAllByRole("row").slice(1); // skip header
    expect(cells[0]).toHaveTextContent("MacBook Pro M4"); // 41.2 ranks above 9.5
    expect(cells[1]).toHaveTextContent("Pixel 9");
    expect(screen.getByText("high (≥5 runs)")).toBeInTheDocument();
    expect(screen.getByText("single run")).toBeInTheDocument();
  });

  it("switches to the open division on tab click", async () => {
    h.limitMock.mockResolvedValue({ data: [], error: null });
    renderWithQuery(<Leaderboard />);
    await screen.findByText(/No certified closed-division runs/);

    fireEvent.click(screen.getByRole("tab", { name: "open" }));
    expect(await screen.findByText(/No certified open-division runs/)).toBeInTheDocument();
    expect(h.eqCalls).toContainEqual(["division", "open"]);
  });
});
