// Frugal FLOPs: maps detected device fingerprints to estimated dense FP16
// AI-inference TFLOPs. Numbers are deliberately conservative best-guesses
// based on public vendor specs — used only for the "Dark Compute" equivalence
// calculator on /benchmarks. Not authoritative.

export interface DeviceLike {
  device_model: string | null;
  device_type: string | null;
  gpu: string | null;
  gpu_vendor: string | null;
  ram_gb?: number | null;
  cores?: number | null;
}

// Datacenter baselines (FP16 dense TFLOPs)
export const DATACENTER = {
  A100: 312,
  H100: 1000,
  GB200: 2500,
} as const;

// Conservative fallback tiers (matches the "Dark Compute Engine" baseline spec)
const TIER_PHONE = 4;
const TIER_LAPTOP = 30;
const TIER_DESKTOP = 80;

// Apple device-model -> TFLOPs (FP16). iPhone Neural Engine + GPU combined,
// Mac numbers are GPU FP16 estimates for the most common SKU in that family.
const APPLE_MODEL_TFLOPS: Array<{ match: RegExp; tflops: number; label: string }> = [
  { match: /iPhone 16( Pro)?( Max)?/i, tflops: 4.3, label: "iPhone 16-class" },
  { match: /iPhone 15 Pro/i, tflops: 4.0, label: "iPhone 15 Pro" },
  { match: /iPhone 15/i, tflops: 3.5, label: "iPhone 15" },
  { match: /iPhone 14 Pro/i, tflops: 3.5, label: "iPhone 14 Pro" },
  { match: /iPhone 14/i, tflops: 2.5, label: "iPhone 14" },
  { match: /iPhone 13/i, tflops: 2.2, label: "iPhone 13" },
  { match: /iPhone 12/i, tflops: 1.8, label: "iPhone 12" },
  { match: /iPhone 11/i, tflops: 1.2, label: "iPhone 11" },
  { match: /iPhone X|iPhone XS/i, tflops: 0.9, label: "iPhone X-class" },
  { match: /iPad Pro/i, tflops: 5.0, label: "iPad Pro" },
  { match: /iPad/i, tflops: 2.5, label: "iPad" },
];

// Apple Silicon Mac tiers (GPU FP16, typical Pro/Max blended)
const APPLE_GPU_TFLOPS: Array<{ match: RegExp; tflops: number; label: string }> = [
  { match: /metal-3/i, tflops: 14, label: "Apple Silicon (M-series)" },
  { match: /metal-2/i, tflops: 5, label: "Apple Silicon (older)" },
  { match: /apple/i, tflops: 4, label: "Apple GPU" },
];

// NVIDIA architecture -> typical consumer SKU FP16 TFLOPs (dense, no sparsity)
const NVIDIA_ARCH_TFLOPS: Record<string, { tflops: number; label: string }> = {
  blackwell: { tflops: 165, label: "RTX 50-series (Blackwell)" },
  "ada-lovelace": { tflops: 90, label: "RTX 40-series (Ada)" },
  lovelace: { tflops: 90, label: "RTX 40-series (Ada)" },
  ampere: { tflops: 40, label: "RTX 30-series (Ampere)" },
  turing: { tflops: 22, label: "RTX 20-series (Turing)" },
  pascal: { tflops: 11, label: "GTX 10-series (Pascal)" },
  maxwell: { tflops: 6, label: "GTX 9-series (Maxwell)" },
  kepler: { tflops: 4, label: "GTX 7-series (Kepler)" },
};

// AMD architecture -> typical consumer SKU FP16 TFLOPs
const AMD_ARCH_TFLOPS: Record<string, { tflops: number; label: string }> = {
  "rdna-4": { tflops: 60, label: "Radeon RX 9000 (RDNA4)" },
  "rdna-3": { tflops: 50, label: "Radeon RX 7000 (RDNA3)" },
  "rdna-2": { tflops: 23, label: "Radeon RX 6000 (RDNA2)" },
  "rdna-1": { tflops: 13, label: "Radeon RX 5000 (RDNA)" },
  rdna: { tflops: 13, label: "Radeon RX 5000 (RDNA)" },
  "gcn-5": { tflops: 11, label: "Vega" },
  "gcn-4": { tflops: 6, label: "Polaris" },
};

// Intel iGPU/Arc generations
const INTEL_ARCH_TFLOPS: Record<string, { tflops: number; label: string }> = {
  "gen-13": { tflops: 4, label: "Intel Iris Xe (13th gen)" },
  "gen-12lp": { tflops: 3, label: "Intel Iris Xe (12th gen)" },
  "gen-12": { tflops: 3, label: "Intel Iris Xe" },
  "gen-11": { tflops: 1.5, label: "Intel Iris Plus" },
  "gen-9": { tflops: 0.8, label: "Intel HD Graphics" },
  arc: { tflops: 16, label: "Intel Arc" },
};

// Mobile GPUs (Qualcomm Adreno, ARM Mali Bifrost/Valhall)
const MOBILE_GPU_TFLOPS: Array<{ match: RegExp; tflops: number; label: string }> = [
  { match: /adreno-8xx/i, tflops: 4.5, label: "Snapdragon 8 Gen 3/4 (Adreno 8xx)" },
  { match: /adreno-7xx/i, tflops: 3.0, label: "Snapdragon 8 Gen 1/2 (Adreno 7xx)" },
  { match: /adreno-6xx/i, tflops: 1.5, label: "Snapdragon 8xx (Adreno 6xx)" },
  { match: /valhall/i, tflops: 2.0, label: "ARM Mali (Valhall)" },
  { match: /bifrost/i, tflops: 1.0, label: "ARM Mali (Bifrost)" },
];

export interface FlopsEstimate {
  tflops: number;
  label: string;
  /** confidence: 'exact' (matched specific model), 'arch' (matched arch), 'tier' (fallback) */
  source: "exact" | "arch" | "tier";
}

export function estimateDeviceTflops(d: DeviceLike): FlopsEstimate {
  const model = d.device_model || "";
  const gpu = (d.gpu || "").toLowerCase();
  const vendor = (d.gpu_vendor || "").toLowerCase();
  const type = (d.device_type || "").toLowerCase();

  // 1. Apple iPhone/iPad by model
  for (const m of APPLE_MODEL_TFLOPS) {
    if (m.match.test(model)) return { tflops: m.tflops, label: m.label, source: "exact" };
  }

  // 2. Vendor-arch lookups
  if (vendor === "nvidia" && NVIDIA_ARCH_TFLOPS[gpu]) {
    return { ...NVIDIA_ARCH_TFLOPS[gpu], source: "arch" };
  }
  if (vendor === "amd" && AMD_ARCH_TFLOPS[gpu]) {
    return { ...AMD_ARCH_TFLOPS[gpu], source: "arch" };
  }
  if (vendor === "intel" && INTEL_ARCH_TFLOPS[gpu]) {
    return { ...INTEL_ARCH_TFLOPS[gpu], source: "arch" };
  }
  if (vendor === "apple") {
    for (const m of APPLE_GPU_TFLOPS) {
      if (m.match.test(gpu)) return { tflops: m.tflops, label: m.label, source: "arch" };
    }
  }
  if (vendor === "qualcomm" || vendor === "arm") {
    for (const m of MOBILE_GPU_TFLOPS) {
      if (m.match.test(gpu)) return { tflops: m.tflops, label: m.label, source: "arch" };
    }
  }

  // 3. Fallback to tier
  if (type === "mobile") return { tflops: TIER_PHONE, label: "Generic phone", source: "tier" };
  if (type === "tablet") return { tflops: TIER_PHONE * 1.5, label: "Generic tablet", source: "tier" };
  // Distinguish desktop vs laptop from RAM/cores heuristic
  const isLaptopish = (d.ram_gb ?? 0) <= 16 && (d.cores ?? 0) <= 12;
  return isLaptopish
    ? { tflops: TIER_LAPTOP, label: "Generic laptop", source: "tier" }
    : { tflops: TIER_DESKTOP, label: "Generic desktop", source: "tier" };
}

/** Stable fingerprint for de-duplicating "unique devices" across many runs. */
export function deviceFingerprint(d: DeviceLike & { screen_res?: string | null; pixel_ratio?: number | null }): string {
  return [
    d.device_model || "?",
    d.gpu || "?",
    d.gpu_vendor || "?",
    d.device_type || "?",
    d.ram_gb ?? "?",
    d.cores ?? "?",
    d.screen_res || "?",
    d.pixel_ratio ?? "?",
  ].join("|");
}

export function formatTflops(tflops: number): string {
  if (tflops >= 1000) return `${(tflops / 1000).toFixed(2)} PFLOPs`;
  return `${tflops.toFixed(1)} TFLOPs`;
}