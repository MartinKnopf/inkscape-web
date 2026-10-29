// SPDX-License-Identifier: GPL-2.0-or-later
// Small asynchronous key-value stores for the autosave and the recent files:
// IndexedDB in the browser, memory in tests.

/** A store of values by string key. */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** All entries, sorted by key. */
  entries(): Promise<[string, T][]>;
}

export function memoryStore<T>(): KeyValueStore<T> {
  const map = new Map<string, T>();
  return {
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    entries: async () => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

const DB_NAME = 'inkscape';
/** Object stores of the database, by the names that indexedDbStore takes. */
const STORES = ['autosave', 'recent'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** Run request on the object store name and resolve with its result. */
async function run<R>(
  name: StoreName,
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = request(db.transaction(name, mode).objectStore(name));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A store in the IndexedDB database "inkscape". Values must be structured-cloneable. */
export function indexedDbStore<T>(name: StoreName): KeyValueStore<T> {
  return {
    get: (key) => run<T | undefined>(name, 'readonly', (s) => s.get(key)),
    put: async (key, value) => void (await run(name, 'readwrite', (s) => s.put(value, key))),
    delete: async (key) => void (await run(name, 'readwrite', (s) => s.delete(key))),
    async entries() {
      const [keys, values] = await Promise.all([
        run<IDBValidKey[]>(name, 'readonly', (s) => s.getAllKeys()),
        run<T[]>(name, 'readonly', (s) => s.getAll()),
      ]);
      // getAllKeys and getAll both return in key order.
      return keys.map((k, i) => [String(k), values[i] as T] as [string, T]);
    },
  };
}
