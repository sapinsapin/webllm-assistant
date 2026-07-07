/**
 * Minimal structural types for experimental browser APIs (WebGPU,
 * Device Memory) that aren't in lib.dom yet. Centralised here so the
 * rest of the codebase doesn't need `as any` casts to reach them.
 */

export interface GpuAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface GpuAdapterLike {
  requestAdapterInfo?: () => Promise<GpuAdapterInfoLike | undefined>;
  info?: GpuAdapterInfoLike;
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
}

export interface GpuLike {
  requestAdapter: () => Promise<GpuAdapterLike | null>;
}

/** navigator.gpu, when the browser exposes WebGPU. */
export function getNavigatorGpu(): GpuLike | undefined {
  return (navigator as Navigator & { gpu?: GpuLike }).gpu;
}

/** navigator.deviceMemory in GB (Chrome-only, capped at 8). */
export function getDeviceMemoryGb(): number | undefined {
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}
