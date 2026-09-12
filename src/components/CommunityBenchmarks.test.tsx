import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rangeMock: vi.fn(),
  eqMock: vi.fn(),
  isMock: vi.fn(),
  inMock: vi.fn(),
}));

// Chainable query builder: select → (eq | is)* → order → range, plus the
// audit lookup select → in (resolves directly).
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.eq = (...a: unknown[]) => { h.eqMock(...a); return chain; };
  chain.is = (...a: unknown[]) => { h.isMock(...a); return chain; };
  chain.order = () => chain;
  chain.range = (...a: unknown[]) => h.rangeMock(...a);
  chain.in = (...a: unknown[]) => h.inMock(...a);
  return { supabase: { from: () => ({ select: () => chain }) } };
});

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
    h.eqMock.mockReset();
    h.isMock.mockReset();
    h.inMock.mockReset().mockResolvedValue({ data: [], error: null });
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

  it("falls back to legacy columns when the live schema predates the methodology migration", async () => {
    h.rangeMock
      .mockResolvedValueOnce({ data: null, count: null, error: { code: "PGRST204", message: "Could not find the 'overall_score' column of 'benchmark_runs' in the schema cache" } })
      .mockResolvedValueOnce({ data: [run()], count: 1, error: null });
    renderWithQuery(<CommunityBenchmarks />);

    expect(await screen.findByText("MacBook Pro M4")).toBeInTheDocument();
    expect(h.rangeMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Couldn't load community results")).not.toBeInTheDocument();
  });

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

  it("does not filter by round by default, then filters by spec_version when a round is chosen", async () => {
    h.rangeMock.mockResolvedValue({ data: [run()], count: 1, error: null });
    renderWithQuery(<CommunityBenchmarks />);
    await screen.findByText("MacBook Pro M4");
    expect(h.eqMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "Round" }), { target: { value: "2026.09" } });
    await waitFor(() => expect(h.eqMock).toHaveBeenCalledWith("spec_version", "2026.09"));
  });

  it("maps the legacy round to spec_version IS NULL", async () => {
    h.rangeMock.mockResolvedValue({ data: [], count: 0, error: null });
    renderWithQuery(<CommunityBenchmarks />);
    await screen.findByText(/No benchmark runs yet/);

    fireEvent.change(screen.getByRole("combobox", { name: "Round" }), { target: { value: "legacy" } });
    await waitFor(() => expect(h.isMock).toHaveBeenCalledWith("spec_version", null));
    expect(await screen.findByText(/No runs in this round yet/)).toBeInTheDocument();
  });

  it("marks audit-flagged certified rows as outliers instead of certified", async () => {
    h.rangeMock.mockResolvedValue({
      data: [run({ id: "ok", result_tier: "certified" }), run({ id: "sus", device_model: "Pixel 9", result_tier: "certified", overall_score: 99 })],
      count: 2,
      error: null,
    });
    h.inMock.mockResolvedValue({ data: [{ id: "sus", flagged: true, device_median: 9.5, device_runs: 7 }, { id: "ok", flagged: false, device_median: 40, device_runs: 7 }], error: null });
    renderWithQuery(<CommunityBenchmarks />);

    expect(await screen.findByText("Pixel 9")).toBeInTheDocument();
    expect(h.inMock).toHaveBeenCalledWith("id", ["ok", "sus"]);
    expect(screen.getByText("⚠ outlier")).toBeInTheDocument();
    expect(screen.getAllByText("✓ certified")).toHaveLength(1);
  });

  it("still renders the feed when the audit view is missing or fails", async () => {
    h.rangeMock.mockResolvedValue({ data: [run({ result_tier: "certified" })], count: 1, error: null });
    h.inMock.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.benchmark_audit'" } });
    renderWithQuery(<CommunityBenchmarks />);
    expect(await screen.findByText("MacBook Pro M4")).toBeInTheDocument();
    expect(screen.queryByText("⚠ outlier")).not.toBeInTheDocument();
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
