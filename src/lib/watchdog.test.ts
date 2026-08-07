import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStreamWatchdog, unwrapWatchdogError, WatchdogTimeoutError } from "./watchdog";

describe("createStreamWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const opts = { connectTimeoutMs: 1000, idleTimeoutMs: 500 };

  it("aborts with a connect-phase timeout when no byte ever arrives", () => {
    const wd = createStreamWatchdog(opts);
    vi.advanceTimersByTime(999);
    expect(wd.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(wd.signal.aborted).toBe(true);
    expect(wd.timedOut).toBe(true);
    expect((wd.signal.reason as WatchdogTimeoutError).phase).toBe("connect");
  });

  it("never times out a slow-but-progressing stream (no unnecessary timeouts)", () => {
    const wd = createStreamWatchdog(opts);
    // Feed every 400ms — always under the 500ms idle limit — for far longer
    // than either timeout window.
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(400);
      wd.feed();
    }
    expect(wd.signal.aborted).toBe(false);
    expect(wd.timedOut).toBe(false);
  });

  it("aborts with an idle-phase timeout when the stream stalls mid-flight", () => {
    const wd = createStreamWatchdog(opts);
    vi.advanceTimersByTime(200);
    wd.feed(); // first byte arrived — idle watchdog takes over
    vi.advanceTimersByTime(500);
    expect(wd.signal.aborted).toBe(true);
    expect((wd.signal.reason as WatchdogTimeoutError).phase).toBe("idle");
  });

  it("clear() disarms everything and is safe to call twice", () => {
    const wd = createStreamWatchdog(opts);
    wd.feed();
    wd.clear();
    wd.clear();
    vi.advanceTimersByTime(10_000);
    expect(wd.signal.aborted).toBe(false);
  });

  it("feed() after clear() or timeout does not resurrect timers", () => {
    const wd = createStreamWatchdog(opts);
    vi.advanceTimersByTime(1000); // connect timeout fires
    expect(wd.timedOut).toBe(true);
    wd.feed(); // must be a no-op
    vi.advanceTimersByTime(10_000);
    expect((wd.signal.reason as WatchdogTimeoutError).phase).toBe("connect");
  });

  it("carries the custom messages for each phase", () => {
    const a = createStreamWatchdog({ ...opts, connectMessage: "slow connect" });
    vi.advanceTimersByTime(1000);
    expect((a.signal.reason as Error).message).toBe("slow connect");

    const b = createStreamWatchdog({ ...opts, idleMessage: "stalled" });
    b.feed();
    vi.advanceTimersByTime(500);
    expect((b.signal.reason as Error).message).toBe("stalled");
  });
});

describe("unwrapWatchdogError", () => {
  it("recovers the timeout reason hidden behind a generic AbortError", () => {
    vi.useFakeTimers();
    try {
      const wd = createStreamWatchdog({ connectTimeoutMs: 10, idleTimeoutMs: 10 });
      vi.advanceTimersByTime(10);
      const generic = new DOMException("The operation was aborted.", "AbortError");
      const unwrapped = unwrapWatchdogError(generic, wd.signal);
      expect(unwrapped).toBeInstanceOf(WatchdogTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes non-watchdog errors through untouched", () => {
    const controller = new AbortController();
    const err = new TypeError("Failed to fetch");
    expect(unwrapWatchdogError(err, controller.signal)).toBe(err);
  });
});
