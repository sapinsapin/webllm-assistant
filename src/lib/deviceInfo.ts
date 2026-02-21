export interface DeviceInfo {
  browser: string;
  os: string;
  cores: number;
  ram: number | null; // GB, navigator.deviceMemory
  gpu: string | null;
  gpuVendor: string | null;
  screenRes: string;
  pixelRatio: number;
  userAgent: string;
  timestamp: string;
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Edge " + (ua.match(/Edg\/([\d.]+)/)?.[1] ?? "");
  if (ua.includes("Chrome/")) return "Chrome " + (ua.match(/Chrome\/([\d.]+)/)?.[1] ?? "");
  if (ua.includes("Firefox/")) return "Firefox " + (ua.match(/Firefox\/([\d.]+)/)?.[1] ?? "");
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari " + (ua.match(/Version\/([\d.]+)/)?.[1] ?? "");
  return "Unknown";
}

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "Unknown";
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  let gpu: string | null = null;
  let gpuVendor: string | null = null;

  try {
    const adapter = await (navigator as any).gpu?.requestAdapter();
    if (adapter) {
      const info = await adapter.requestAdapterInfo?.() ?? (adapter as any).info;
      if (info) {
        gpu = info.device || info.description || null;
        gpuVendor = info.vendor || null;
      }
      // Fallback: try architecture
      if (!gpu && info?.architecture) {
        gpu = info.architecture;
      }
    }
  } catch {
    // WebGPU not available
  }

  return {
    browser: detectBrowser(),
    os: detectOS(),
    cores: navigator.hardwareConcurrency || 0,
    ram: (navigator as any).deviceMemory ?? null,
    gpu,
    gpuVendor,
    screenRes: `${screen.width}x${screen.height}`,
    pixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };
}
