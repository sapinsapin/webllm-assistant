import { describe, it, expect } from "vitest";
import {
  estimateDeviceTflops,
  deviceFingerprint,
  formatTflops,
  DATACENTER,
  type DeviceLike,
} from "./deviceFlops";

const device = (over: Partial<DeviceLike> = {}): DeviceLike => ({
  device_model: null,
  device_type: null,
  gpu: null,
  gpu_vendor: null,
  ram_gb: null,
  cores: null,
  ...over,
});

describe("estimateDeviceTflops", () => {
  it("matches known Apple device models exactly", () => {
    const est = estimateDeviceTflops(device({ device_model: "iPhone 15 Pro" }));
    expect(est.source).toBe("exact");
    expect(est.tflops).toBe(4.0);
  });

  it("prefers the more specific Apple model when patterns overlap", () => {
    // "iPhone 15 Pro" must not fall through to the plain "iPhone 15" tier
    const pro = estimateDeviceTflops(device({ device_model: "iPhone 15 Pro" }));
    const base = estimateDeviceTflops(device({ device_model: "iPhone 15" }));
    expect(pro.tflops).toBeGreaterThan(base.tflops);
  });

  it("matches vendor + architecture lookups", () => {
    const est = estimateDeviceTflops(device({ gpu_vendor: "nvidia", gpu: "ampere" }));
    expect(est.source).toBe("arch");
    expect(est.tflops).toBe(40);
  });

  it("is case-insensitive on vendor casing from real UA strings", () => {
    const est = estimateDeviceTflops(device({ gpu_vendor: "NVIDIA", gpu: "ampere" }));
    expect(est.source).toBe("arch");
  });

  it("falls back to the phone tier for unknown mobile devices", () => {
    const est = estimateDeviceTflops(device({ device_type: "mobile" }));
    expect(est.source).toBe("tier");
    expect(est.label).toBe("Generic phone");
  });

  it("distinguishes laptop vs desktop tiers by RAM/core heuristic", () => {
    const laptop = estimateDeviceTflops(device({ device_type: "desktop", ram_gb: 8, cores: 8 }));
    const desktop = estimateDeviceTflops(device({ device_type: "desktop", ram_gb: 64, cores: 24 }));
    expect(laptop.label).toBe("Generic laptop");
    expect(desktop.label).toBe("Generic desktop");
    expect(desktop.tflops).toBeGreaterThan(laptop.tflops);
  });

  it("never throws on an all-null device — worst case is a tier fallback", () => {
    const est = estimateDeviceTflops(device());
    expect(est.source).toBe("tier");
    expect(est.tflops).toBeGreaterThan(0);
  });

  it("ignores an unknown vendor/arch combo and still returns a tier estimate", () => {
    const est = estimateDeviceTflops(device({ gpu_vendor: "nvidia", gpu: "not-a-real-arch" }));
    expect(est.source).toBe("tier");
  });
});

describe("deviceFingerprint", () => {
  it("is stable for identical devices and placeholders nulls", () => {
    const a = deviceFingerprint(device({ device_model: "MacBook", ram_gb: 16 }));
    const b = deviceFingerprint(device({ device_model: "MacBook", ram_gb: 16 }));
    expect(a).toBe(b);
    expect(deviceFingerprint(device())).toContain("?");
  });

  it("differs when any distinguishing field differs", () => {
    const a = deviceFingerprint(device({ device_model: "MacBook", ram_gb: 16 }));
    const b = deviceFingerprint(device({ device_model: "MacBook", ram_gb: 32 }));
    expect(a).not.toBe(b);
  });
});

describe("formatTflops", () => {
  it("formats sub-petaflop values as TFLOPs", () => {
    expect(formatTflops(4.25)).toBe("4.3 TFLOPs");
  });

  it("promotes >= 1000 TFLOPs to PFLOPs", () => {
    expect(formatTflops(DATACENTER.GB200)).toBe("2.50 PFLOPs");
  });
});
