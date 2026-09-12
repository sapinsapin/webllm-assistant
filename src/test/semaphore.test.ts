import { describe, it, expect } from "vitest";
import { Semaphore } from "../../supabase/functions/_shared/semaphore";

describe("Semaphore", () => {
  it("grants slots up to the concurrency limit immediately", async () => {
    const sem = new Semaphore(2, 0);
    expect(await sem.acquire()).toBe(true);
    expect(await sem.acquire()).toBe(true);
    expect(sem.active).toBe(2);
  });

  it("sheds load when both the limit and queue are full", async () => {
    const sem = new Semaphore(1, 0);
    expect(await sem.acquire()).toBe(true);
    expect(await sem.acquire()).toBe(false); // no queue → immediate rejection
  });

  it("queues waiters and wakes them on release, in order", async () => {
    const sem = new Semaphore(1, 2);
    await sem.acquire();
    const order: string[] = [];
    const w1 = sem.acquire().then((ok) => order.push(`w1:${ok}`));
    const w2 = sem.acquire().then((ok) => order.push(`w2:${ok}`));
    expect(await sem.acquire()).toBe(false); // queue full

    sem.release();
    await w1;
    expect(order).toEqual(["w1:true"]);
    sem.release();
    await w2;
    expect(order).toEqual(["w1:true", "w2:true"]);
  });

  it("supports the full 10-concurrent-user target without shedding", async () => {
    const sem = new Semaphore(12, 24);
    const grants = await Promise.all(Array.from({ length: 10 }, () => sem.acquire()));
    expect(grants.every(Boolean)).toBe(true);
    expect(sem.active).toBe(10);
  });

  it("never lets active count go negative on spurious release", () => {
    const sem = new Semaphore(1, 0);
    sem.release();
    expect(sem.active).toBe(0);
  });
});
