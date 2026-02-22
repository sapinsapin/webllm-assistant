const DB_NAME = "webllm-model-cache";
const STORE_NAME = "models";
const DB_VERSION = 1;

interface CachedModel {
  url: string;
  buffer: ArrayBuffer;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "url" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedModelBuffer(url: string): Promise<Uint8Array | null> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(url);

    request.onsuccess = () => {
      const result = request.result as CachedModel | undefined;
      if (!result?.buffer) {
        resolve(null);
        return;
      }
      resolve(new Uint8Array(result.buffer));
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function cacheModelBuffer(url: string, buffer: Uint8Array): Promise<void> {
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const payload: CachedModel = {
      url,
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      updatedAt: Date.now(),
    };

    const request = store.put(payload);

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
