/**
 * Pre-download device diagnostics — checks RAM, storage, and GPU limits
 * to determine if the device can handle a given model weight.
 */

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "unknown";
  value: string;
  detail: string;
}

export interface DiagnosticReport {
  checks: DiagnosticCheck[];
  overall: "pass" | "warn" | "fail";
  canProceed: boolean;
}

/** Parse a size string like "~200MB" or "~1.5GB" to bytes */
function parseSizeToBytes(sizeStr: string): number {
  const cleaned = sizeStr.replace(/[~≈]/g, "").trim();
  const match = cleaned.match(/([\d.]+)\s*(KB|MB|GB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return value * (multipliers[unit] || 0);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function checkDeviceMemory(modelBytes: number): Promise<DiagnosticCheck> {
  const ramGB = (navigator as any).deviceMemory as number | undefined;

  if (!ramGB) {
    return {
      id: "ram",
      label: "Device Memory",
      status: "unknown",
      value: "Not reported",
      detail: "Your browser doesn't expose device memory. Proceeding anyway.",
    };
  }

  const ramBytes = ramGB * 1024 ** 3;
  // Model needs roughly 2× its weight in RAM (loading + inference buffers)
  const needed = modelBytes * 2;

  if (ramBytes >= needed) {
    return {
      id: "ram",
      label: "Device Memory",
      status: "pass",
      value: `${ramGB} GB`,
      detail: `${ramGB} GB available — sufficient for ${formatBytes(modelBytes)} model.`,
    };
  }
  if (ramBytes >= modelBytes) {
    return {
      id: "ram",
      label: "Device Memory",
      status: "warn",
      value: `${ramGB} GB`,
      detail: `${ramGB} GB is tight for a ${formatBytes(modelBytes)} model. May work but could be slow.`,
    };
  }
  return {
    id: "ram",
    label: "Device Memory",
    status: "fail",
    value: `${ramGB} GB`,
    detail: `${ramGB} GB is likely too low for a ${formatBytes(modelBytes)} model.`,
  };
}

async function checkStorageQuota(modelBytes: number): Promise<DiagnosticCheck> {
  try {
    if (!navigator.storage?.estimate) {
      return {
        id: "storage",
        label: "Storage Quota",
        status: "unknown",
        value: "Not supported",
        detail: "Storage API not available. Model will still download to memory.",
      };
    }
    const estimate = await navigator.storage.estimate();
    const available = (estimate.quota || 0) - (estimate.usage || 0);

    if (available >= modelBytes * 1.5) {
      return {
        id: "storage",
        label: "Storage Quota",
        status: "pass",
        value: formatBytes(available),
        detail: `${formatBytes(available)} free — plenty of room for caching.`,
      };
    }
    if (available >= modelBytes) {
      return {
        id: "storage",
        label: "Storage Quota",
        status: "warn",
        value: formatBytes(available),
        detail: `${formatBytes(available)} free — enough but limited headroom.`,
      };
    }
    return {
      id: "storage",
      label: "Storage Quota",
      status: "fail",
      value: formatBytes(available),
      detail: `Only ${formatBytes(available)} free — may not cache the ${formatBytes(modelBytes)} model.`,
    };
  } catch {
    return {
      id: "storage",
      label: "Storage Quota",
      status: "unknown",
      value: "Error",
      detail: "Could not query storage quota.",
    };
  }
}

async function checkGpuLimits(modelBytes: number): Promise<DiagnosticCheck> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      return {
        id: "gpu",
        label: "GPU Buffer Limits",
        status: "unknown",
        value: "No WebGPU",
        detail: "WebGPU not available — will use WASM fallback.",
      };
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return {
        id: "gpu",
        label: "GPU Buffer Limits",
        status: "fail",
        value: "No adapter",
        detail: "Could not get GPU adapter.",
      };
    }

    const maxBuffer = adapter.limits?.maxBufferSize ?? 0;
    const maxStorage = adapter.limits?.maxStorageBufferBindingSize ?? 0;

    // For WebGPU models, the largest weight tensor needs to fit in a single buffer
    // Typical largest tensor is ~25% of model weight for quantized models
    const largestTensor = modelBytes * 0.25;

    if (maxBuffer >= largestTensor && maxStorage >= largestTensor) {
      return {
        id: "gpu",
        label: "GPU Buffer Limits",
        status: "pass",
        value: formatBytes(maxBuffer),
        detail: `Max buffer: ${formatBytes(maxBuffer)} — sufficient for model tensors.`,
      };
    }
    if (maxBuffer >= largestTensor * 0.5) {
      return {
        id: "gpu",
        label: "GPU Buffer Limits",
        status: "warn",
        value: formatBytes(maxBuffer),
        detail: `Max buffer: ${formatBytes(maxBuffer)} — may be tight for larger tensors.`,
      };
    }
    return {
      id: "gpu",
      label: "GPU Buffer Limits",
      status: "fail",
      value: formatBytes(maxBuffer),
      detail: `Max buffer: ${formatBytes(maxBuffer)} — too small for model tensors.`,
    };
  } catch {
    return {
      id: "gpu",
      label: "GPU Buffer Limits",
      status: "unknown",
      value: "Error",
      detail: "Could not query GPU limits.",
    };
  }
}

async function checkCpuCores(): Promise<DiagnosticCheck> {
  const cores = navigator.hardwareConcurrency || 0;
  if (cores === 0) {
    return { id: "cpu", label: "CPU Cores", status: "unknown", value: "Unknown", detail: "Could not detect CPU core count." };
  }
  if (cores >= 4) {
    return { id: "cpu", label: "CPU Cores", status: "pass", value: `${cores} cores`, detail: `${cores} cores — good for parallel inference.` };
  }
  if (cores >= 2) {
    return { id: "cpu", label: "CPU Cores", status: "warn", value: `${cores} cores`, detail: `${cores} cores — inference may be slow.` };
  }
  return { id: "cpu", label: "CPU Cores", status: "fail", value: `${cores} core`, detail: `Only ${cores} core — expect very slow inference.` };
}

export async function runDiagnostics(modelSizeStr: string): Promise<DiagnosticReport> {
  const modelBytes = parseSizeToBytes(modelSizeStr);

  const checks = await Promise.all([
    checkDeviceMemory(modelBytes),
    checkStorageQuota(modelBytes),
    checkGpuLimits(modelBytes),
    checkCpuCores(),
  ]);

  const hasAnyFail = checks.some((c) => c.status === "fail");
  const hasAnyWarn = checks.some((c) => c.status === "warn");

  return {
    checks,
    overall: hasAnyFail ? "fail" : hasAnyWarn ? "warn" : "pass",
    canProceed: !hasAnyFail, // warnings are ok, failures block
  };
}
