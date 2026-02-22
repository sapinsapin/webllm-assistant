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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isCacheableAsset(requestUrl) {
  if (!["http:", "https:"].includes(requestUrl.protocol)) return false;
  if (!CACHEABLE_HOSTS.some((host) => requestUrl.hostname === host || requestUrl.hostname.endsWith(`.${host}`))) {
    return false;
  }
  return CACHEABLE_EXTENSIONS.some((ext) => requestUrl.pathname.toLowerCase().endsWith(ext));
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

      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
  );
});
