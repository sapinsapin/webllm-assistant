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
  deviceModel: string | null;
  deviceType: "desktop" | "mobile" | "tablet";
  country: string | null;
  city: string | null;
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

// iPhone model fingerprinting via screen dimensions + pixel ratio
function detectIPhoneModel(): string {
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const r = window.devicePixelRatio;
  const key = `${w}x${h}@${r}`;
  const MAP: Record<string, string> = {
    "320x568@2": "iPhone SE (1st gen)/5s",
    "375x667@2": "iPhone 6/7/8/SE (2nd/3rd)",
    "414x736@3": "iPhone 6+/7+/8+",
    "375x812@3": "iPhone X/XS/11 Pro/12 mini/13 mini",
    "414x896@2": "iPhone XR/11",
    "414x896@3": "iPhone XS Max/11 Pro Max",
    "390x844@3": "iPhone 12/13/14",
    "428x926@3": "iPhone 12/13 Pro Max/14 Plus",
    "393x852@3": "iPhone 14 Pro/15/15 Pro",
    "430x932@3": "iPhone 14 Pro Max/15 Plus/15 Pro Max",
    "402x874@3": "iPhone 16/16 Pro",
    "440x956@3": "iPhone 16 Plus/16 Pro Max",
  };
  return MAP[key] || "iPhone";
}

function detectDeviceModel(gpu: string | null): string | null {
  const ua = navigator.userAgent;
  if (ua.includes("iPhone")) return detectIPhoneModel();
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Macintosh") && navigator.maxTouchPoints > 1) return "iPad";
  const android = ua.match(/;\s*([^;)]+?)\s*Build\//);
  if (android) return android[1].trim();
  if (ua.includes("Macintosh")) {
    if (gpu) {
      const g = gpu.toLowerCase();
      if (g.includes("m4")) return "Mac (Apple M4)";
      if (g.includes("m3")) return "Mac (Apple M3)";
      if (g.includes("m2")) return "Mac (Apple M2)";
      if (g.includes("m1")) return "Mac (Apple M1)";
    }
    return "Mac";
  }
  if (ua.includes("Windows")) {
    if (gpu) return `Windows PC · ${gpu}`;
    return "Windows PC";
  }
  if (ua.includes("Linux") && !ua.includes("Android")) {
    if (gpu) return `Linux PC · ${gpu}`;
    return "Linux PC";
  }
  return null;
}

function detectDeviceType(): "desktop" | "mobile" | "tablet" {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet";
  if (/iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

async function fetchGeoLocation(): Promise<{ country: string | null; city: string | null }> {
  try {
    const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { country: null, city: null };
    const data = await res.json();
    return { country: data.country_name ?? null, city: data.city ?? null };
  } catch {
    return { country: null, city: null };
  }
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  let gpu: string | null = null;
  let gpuVendor: string | null = null;

  // Run GPU detection and geo lookup in parallel
  const geoPromise = fetchGeoLocation();

  try {
    const adapter = await (navigator as any).gpu?.requestAdapter();
    if (adapter) {
      const info = await adapter.requestAdapterInfo?.() ?? (adapter as any).info;
      if (info) {
        gpu = info.device || info.description || null;
        gpuVendor = info.vendor || null;
      }
      if (!gpu && info?.architecture) {
        gpu = info.architecture;
      }
    }
  } catch {
    // WebGPU not available
  }

  const geo = await geoPromise;

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
    deviceModel: detectDeviceModel(gpu),
    deviceType: detectDeviceType(),
    country: geo.country,
    city: geo.city,
  };
}
