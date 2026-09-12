/**
 * Progress-aware timeout watchdog for streaming fetches.
 *
 * Policy (mirrors CLAUDE.md "no silent failures" + "no unnecessary timeouts"):
 * - A CONNECT timeout covers the window before the first byte arrives
 *   (edge-function cold starts are slow, so it is generous).
 * - After the first feed(), an IDLE timeout takes over and is re-armed on
 *   every subsequent feed() — a slow but progressing stream is NEVER killed,
 *   only a genuinely stalled one.
 * - On timeout the AbortSignal fires with a WatchdogTimeoutError so callers
 *   can distinguish "took too long" from network/HTTP failures and render a
 *   specific fallback (e.g. suggest the on-device model).
 */

export class WatchdogTimeoutError extends Error {
  readonly phase: "connect" | "idle";
  constructor(phase: "connect" | "idle", message: string) {
    super(message);
    this.name = "WatchdogTimeoutError";
    this.phase = phase;
  }
}

export interface StreamWatchdog {
  /** Pass to fetch() / reader loops; aborts on timeout. */
  signal: AbortSignal;
  /** Call when bytes arrive: switches connect → idle and re-arms the idle timer. */
  feed(): void;
  /** Call on completion or error: stops all timers. Safe to call twice. */
  clear(): void;
  /** True once the watchdog aborted the stream. */
  readonly timedOut: boolean;
}

export interface StreamWatchdogOptions {
  /** Max ms to wait for the FIRST byte. */
  connectTimeoutMs: number;
  /** Max ms between subsequent bytes. */
  idleTimeoutMs: number;
  connectMessage?: string;
  idleMessage?: string;
}

export function createStreamWatchdog(opts: StreamWatchdogOptions): StreamWatchdog {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleared = false;
  let timedOut = false;

  const trip = (phase: "connect" | "idle", message: string) => {
    timedOut = true;
    controller.abort(new WatchdogTimeoutError(phase, message));
  };

  const arm = (ms: number, phase: "connect" | "idle", message: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => trip(phase, message), ms);
  };

  arm(
    opts.connectTimeoutMs,
    "connect",
    opts.connectMessage ?? "The service took too long to respond."
  );

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    feed() {
      if (cleared || timedOut) return;
      arm(
        opts.idleTimeoutMs,
        "idle",
        opts.idleMessage ?? "The response stream stalled."
      );
    },
    clear() {
      cleared = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Normalize an error caught around an aborted fetch: browsers surface the
 * abort as a DOMException("AbortError") whose message hides the reason, so
 * recover the WatchdogTimeoutError from the signal when there is one.
 */
export function unwrapWatchdogError(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted && signal.reason instanceof WatchdogTimeoutError) return signal.reason;
  return err;
}
