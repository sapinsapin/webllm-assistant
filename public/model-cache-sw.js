const MODEL_CACHE = "webllm-model-cache-v1";

const CACHEABLE_HOSTS = [
  "huggingface.co",
  "cdn-lfs.hf.co",
  "mlc.ai",
  "raw.githubusercontent.com",
  "storage.googleapis.com",
];

const CACHEABLE_EXTENSIONS = [
  ".bin",
  ".json",
  ".wasm",
  ".params",
  ".safetensors",
  ".litertlm",
  ".task",
  ".onnx",
];

// Auth token for gated HuggingFace models — injected via postMessage
let hfToken = null;

const HF_HOSTS = ["huggingface.co", "cdn-lfs.hf.co", "cdn-lfs-us-1.hf.co"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Accept HF token from the main thread
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SET_HF_TOKEN") {
    hfToken = event.data.token || null;
  }
});

function isCacheableAsset(requestUrl) {
  if (!["http:", "https:"].includes(requestUrl.protocol)) return false;
  if (!CACHEABLE_HOSTS.some((host) => requestUrl.hostname === host || requestUrl.hostname.endsWith(`.${host}`))) {
    return false;
  }
  return CACHEABLE_EXTENSIONS.some((ext) => requestUrl.pathname.toLowerCase().endsWith(ext));
}

function isHfHost(hostname) {
  return HF_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (!isCacheableAsset(requestUrl)) return;

  event.respondWith(
    caches.open(MODEL_CACHE).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;

      // For HuggingFace gated models, inject auth header if we have a token
      let fetchRequest = request;
      if (hfToken && isHfHost(requestUrl.hostname)) {
        fetchRequest = new Request(request, {
          headers: new Headers({
            ...Object.fromEntries(request.headers.entries()),
            Authorization: `Bearer ${hfToken}`,
          }),
        });
      }

      const networkResponse = await fetch(fetchRequest);
      if (networkResponse.ok) {
        // Don't cache very large responses (>2GB) — Cache API may fail
        const contentLength = parseInt(networkResponse.headers.get("content-length") || "0", 10);
        if (contentLength < 2 * 1024 * 1024 * 1024) {
          cache.put(request, networkResponse.clone());
        }
      }
      return networkResponse;
    })
  );
});
