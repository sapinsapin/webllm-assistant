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

function isLiteRtLmModel(pathname) {
  return pathname.toLowerCase().endsWith(".litertlm");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);

  // Allow gated LiteRT-LM downloads to pass through this SW for auth header injection,
  // but never cache them (they are typically multi-GB and can crash Cache API writes).
  const isLiteRtRequest = isLiteRtLmModel(requestUrl.pathname);
  const shouldHandle = isCacheableAsset(requestUrl) || isLiteRtRequest;
  if (!shouldHandle) return;

  event.respondWith(
    caches.open(MODEL_CACHE).then(async (cache) => {
      if (!isLiteRtRequest) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;
      }

      // For HuggingFace gated models, inject auth header if we have a token.
      // Some internal fetchers use `no-cors`; Authorization is stripped in that mode,
      // so we force a CORS GET here and preserve original headers (e.g. Range).
      let fetchRequest = request;
      if (hfToken && isHfHost(requestUrl.hostname)) {
        const authedHeaders = new Headers(request.headers);
        authedHeaders.set("Authorization", `Bearer ${hfToken}`);

        fetchRequest = new Request(request.url, {
          method: "GET",
          headers: authedHeaders,
          mode: "cors",
          credentials: "omit",
          redirect: "follow",
        });
      }

      const networkResponse = await fetch(fetchRequest);
      if (networkResponse.ok && !isLiteRtRequest) {
        // Don't cache when size is unknown or very large (>2GB) — Cache API may fail/crash.
        const rawLength = networkResponse.headers.get("content-length");
        const contentLength = parseInt(rawLength || "0", 10);
        if (contentLength > 0 && contentLength < 2 * 1024 * 1024 * 1024) {
          cache.put(request, networkResponse.clone());
        }
      }
      return networkResponse;
    })
  );
});
