import type { EngineCapability, EngineType } from "./types";

export async function detectCapabilities(): Promise<EngineCapability[]> {
  const caps: EngineCapability[] = [];

  // 1. Check WebGPU for MediaPipe
  const hasWebGPU = !!(navigator as any).gpu;
  let webgpuUsable = false;
  if (hasWebGPU) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      webgpuUsable = !!adapter;
    } catch {
      webgpuUsable = false;
    }
  }

  caps.push({
    engine: "mediapipe",
    label: "MediaPipe (WebGPU)",
    available: webgpuUsable,
    reason: webgpuUsable ? undefined : "WebGPU not available in this browser",
    priority: 1,
  });

  // 2. WebLLM also needs WebGPU but has broader model support
  caps.push({
    engine: "webllm",
    label: "WebLLM (WebGPU)",
    available: webgpuUsable,
    reason: webgpuUsable ? undefined : "WebGPU not available in this browser",
    priority: 2,
  });

  // 3. ONNX Runtime Web works everywhere via WASM
  caps.push({
    engine: "onnx",
    label: "Transformers.js (WASM)",
    available: true, // WASM is universally supported
    reason: undefined,
    priority: 3,
  });

  return caps;
}

export function getBestEngine(caps: EngineCapability[]): EngineType {
  const available = caps
    .filter((c) => c.available)
    .sort((a, b) => a.priority - b.priority);
  return available[0]?.engine ?? "onnx";
}
