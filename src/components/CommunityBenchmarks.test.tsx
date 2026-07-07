import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rangeMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          range: h.rangeMock,
        }),
      }),
    }),
  },
}));

import { CommunityBenchmarks } from "./CommunityBenchmarks";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "run-1",
  created_at: new Date().toISOString(),
  device_model: "MacBook Pro M4",
  device_type: "desktop",
  avg_tps: 42.5,
  avg_ttft_ms: 120,
  verdict: "Great",
  model_name: "Gemma 3 1B",
  engine: "mediapipe",
  browser: "Chrome",
  os: "macOS",
  country: null,
  city: null,
  cores: 10,
  ram_gb: 32,
  gpu: "Apple M4",
  gpu_vendor: "Apple",
  screen_res: "3024x1964",
  ...over,
});

describe("CommunityBenchmarks states", () => {
  beforeEach(() => {
    h.rangeMock.mockReset();
  });

  it("shows loading skeletons while the query is pending", () => {
    h.rangeMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWithQuery(<CommunityBenchmarks />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows an error state with a retry button when the fetch fails — never the empty state", async () => {
    h.rangeMock.mockResolvedValue({ data: null, count: null, error: { message: "permission denied" } });
    renderWithQuery(<CommunityBenchmarks />);

    expect(
      await screen.findByText("Couldn't load community results", {}, { timeout: 8000 })
    ).toBeInTheDocument();
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No benchmark runs yet/)).not.toBeInTheDocument();
  }, 15_000);

  it("shows the empty state only for a successful empty result", async () => {
    h.rangeMock.mockResolvedValue({ data: [], count: 0, error: null });
    renderWithQuery(<CommunityBenchmarks />);
    expect(await screen.findByText(/No benchmark runs yet/)).toBeInTheDocument();
  });

  it("renders run rows with device, throughput, and verdict", async () => {
    h.rangeMock.mockResolvedValue({
      data: [run(), run({ id: "run-2", device_model: "Pixel 9", avg_tps: 7.2, verdict: "Slow" })],
      count: 2,
      error: null,
    });
    renderWithQuery(<CommunityBenchmarks />);

    expect(await screen.findByText("MacBook Pro M4")).toBeInTheDocument();
    expect(screen.getByText("Pixel 9")).toBeInTheDocument();
    expect(screen.getByText("42.5")).toBeInTheDocument();
    // 2 results fit one page → no pagination controls
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("shows pagination when there are more rows than one page", async () => {
    h.rangeMock.mockResolvedValue({
      data: Array.from({ length: 10 }, (_, i) => run({ id: `run-${i}` })),
      count: 25,
      error: null,
    });
    renderWithQuery(<CommunityBenchmarks />);

    expect((await screen.findAllByText("MacBook Pro M4")).length).toBe(10);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });
});
