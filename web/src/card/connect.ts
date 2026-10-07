// Picks the card's folder, and remembers it so that a reload only has to ask for permission again. The browser
// keeps the handle in IndexedDB; it's the only way to store one.

declare global {
  interface Window {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  }
}

const mode = "read";
const storeName = "handles";
const key = "card";

export const canConnect = typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickCard(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker!({ id: "deluge-card", mode });
  await withStore("readwrite", (store) => store.put(handle, key));
  return handle;
}

export async function rememberedCard(): Promise<FileSystemDirectoryHandle | undefined> {
  return withStore("readonly", (store) => store.get(key));
}

// Needs a user gesture unless the browser still has permission.
export async function reconnect(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

function withStore<T>(access: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("webluge", 1);
    open.onupgradeneeded = () => open.result.createObjectStore(storeName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = operation(db.transaction(storeName, access).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.transaction!.oncomplete = () => db.close();
    };
  });
}
