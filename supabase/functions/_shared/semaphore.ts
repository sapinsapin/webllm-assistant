/**
 * Minimal counting semaphore for bounding concurrent upstream calls in edge
 * functions. Pure TypeScript (no Deno APIs) so it is unit-testable from
 * Vitest (see src/test/semaphore.test.ts).
 */
export class Semaphore {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number = 0
  ) {}

  /**
   * Acquire a slot. Resolves true when the slot is granted; resolves false
   * immediately when both the concurrency limit and the wait queue are full
   * (caller should shed load with 503 + Retry-After).
   */
  acquire(): Promise<boolean> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return Promise.resolve(true);
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve(true);
      });
    });
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  get active(): number {
    return this.inFlight;
  }
}
