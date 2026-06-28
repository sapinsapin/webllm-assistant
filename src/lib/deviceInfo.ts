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
  latitude: number | null;
  longitude: number | null;
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
    return detectAppleSiliconModel(gpu);
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

/**
 * Best-effort fingerprint for Apple Silicon Macs.
 *
 * Apple + WebGPU only expose `vendor:"apple"` and `architecture:"metal-3"`.
 * No chip name is available. We infer the *tier* (base / Pro / Max / Ultra)
 * from `navigator.hardwareConcurrency`, and *generation* (M1–M4) from the
 * macOS major version embedded in the UA string. Both are heuristics — the
 * user can override in the Review step before submitting a benchmark.
 *
 * Core counts by tier (P+E cores):
 *   8  → base (M1/M2/M3 base, 4P+4E)
 *   10 → base M4 (4P+6E) OR M1 Max (8P+2E)   — disambiguated by generation
 *   11–12 → Pro
 *   14–16 → Max
 *   20–24 → Ultra
 */
function detectAppleSiliconModel(gpu: string | null): string {
  const cores = navigator.hardwareConcurrency || 0;
  const macOS = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
  const macMajor = macOS ? parseInt(macOS[1], 10) : 0;
  const macMinor = macOS ? parseInt(macOS[2], 10) : 0;

  // Generation hint from macOS version (users may run older OS on newer chips,
  // so this is "earliest plausible generation", labelled as a guess).
  //   macOS 15+ (Sequoia, Oct 2024) → M4 era
  //   macOS 14   (Sonoma,  Sep 2023) → M3 era
  //   macOS 13   (Ventura, Oct 2022) → M2 era
  //   macOS 12   (Monterey)          → M1 era
  let genGuess: "M1" | "M2" | "M3" | "M4" | null = null;
  if (macMajor >= 26 || macMajor === 15) genGuess = "M4";
  else if (macMajor === 14) genGuess = "M3";
  else if (macMajor === 13) genGuess = "M2";
  else if (macMajor === 12 || (macMajor === 10 && macMinor >= 16)) genGuess = "M1";

  let tier: "" | " Pro" | " Max" | " Ultra" = "";
  if (cores >= 20) tier = " Ultra";
  else if (cores >= 14) tier = " Max";
  else if (cores >= 11) tier = " Pro";
  else if (cores === 10 && genGuess && genGuess !== "M1") tier = ""; // base M4 has 10 cores
  else if (cores === 10) tier = " Max"; // M1 Max also has 10 cores
  else tier = ""; // 8 cores = base

  if (genGuess) {
    return `MacBook / Mac (Apple ${genGuess}${tier}, ~${cores} cores)`;
  }
  // Fall back to old GPU-string sniffing if macOS version not parseable.
  if (gpu) {
    const g = gpu.toLowerCase();
    if (g.includes("m4")) return `Mac (Apple M4${tier})`;
    if (g.includes("m3")) return `Mac (Apple M3${tier})`;
    if (g.includes("m2")) return `Mac (Apple M2${tier})`;
    if (g.includes("m1")) return `Mac (Apple M1${tier})`;
  }
  return `Mac (Apple Silicon${tier}, ~${cores} cores)`;
}

/**
 * Estimate unified-memory size from WebGPU adapter limits.
 * On Apple Silicon, `maxBufferSize` scales with installed RAM
 * (roughly 25–30 % of unified memory). Browsers cap `navigator.deviceMemory`
 * at 8 GB for privacy, so this is the only signal that can see > 8 GB.
 * Returns RAM in GB, snapped to the common Apple SKUs (8/16/24/32/36/48/64/96/128/192).
 */
function estimateAppleRam(maxBufferSizeBytes: number | undefined): number | null {
  if (!maxBufferSizeBytes || maxBufferSizeBytes <= 0) return null;
  const gb = maxBufferSizeBytes / (1024 ** 3);
  // maxBufferSize ≈ 0.28 × unifiedRAM on recent Apple Silicon
  const estimated = gb / 0.28;
  const skus = [8, 16, 24, 32, 36, 48, 64, 96, 128, 192];
  let best = skus[0];
  let bestDiff = Math.abs(estimated - skus[0]);
  for (const s of skus) {
    const d = Math.abs(estimated - s);
    if (d < bestDiff) { best = s; bestDiff = d; }
  }
  return best;
}

function detectDeviceType(): "desktop" | "mobile" | "tablet" {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet";
  if (/iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

async function fetchGeoLocation(): Promise<{ country: string | null; city: string | null; latitude: number | null; longitude: number | null }> {
  try {
    const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { country: null, city: null, latitude: null, longitude: null };
    const data = await res.json();
    return {
      country: data.country_name ?? null,
      city: data.city ?? null,
      latitude: typeof data.latitude === "number" ? data.latitude : null,
      longitude: typeof data.longitude === "number" ? data.longitude : null,
    };
  } catch {
    return { country: null, city: null, latitude: null, longitude: null };
  }
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  let gpu: string | null = null;
  let gpuVendor: string | null = null;
  let maxBufferSize: number | undefined;

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
      maxBufferSize = (adapter as any).limits?.maxBufferSize;
    }
  } catch {
    // WebGPU not available
  }

  const geo = await geoPromise;

  // Browsers hide most GPU details on Apple Silicon — `architecture` is
  // typically "metal-3" with no device name. Relabel to something humans
  // recognise so the community feed doesn't show bare "metal-3".
  const ua = navigator.userAgent;
  const isAppleSilicon =
    (gpuVendor?.toLowerCase() === "apple") ||
    (ua.includes("Macintosh") && (gpu?.toLowerCase().startsWith("metal") ?? false)) ||
    ua.includes("iPhone") || ua.includes("iPad");
  if (isAppleSilicon && gpu && /^metal[-\s]?\d*/i.test(gpu)) {
    const metalVer = gpu.match(/\d+/)?.[0];
    const cores = navigator.hardwareConcurrency || 0;
    let tier = "";
    if (cores >= 20) tier = " Ultra";
    else if (cores >= 14) tier = " Max";
    else if (cores >= 11) tier = " Pro";
    gpu = `Apple Silicon GPU${tier} (Metal ${metalVer ?? "3"}, ${cores}-core CPU)`;
  }

  // Browser-reported RAM is capped at 8 GB. On Apple Silicon, derive a
  // better estimate from the WebGPU buffer-size limit (unified memory).
  let ram: number | null = (navigator as any).deviceMemory ?? null;
  if (isAppleSilicon && ua.includes("Macintosh")) {
    const estimated = estimateAppleRam(maxBufferSize);
    if (estimated && (ram == null || estimated > ram)) {
      ram = estimated;
    }
  }

  return {
    browser: detectBrowser(),
    os: detectOS(),
    cores: navigator.hardwareConcurrency || 0,
    ram,
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
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}
