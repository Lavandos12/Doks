import * as Y from 'yjs';

const DB_NAME = 'doks_client_cache';
const STORE_NAME = 'yjs_docs';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadDocFromIndexedDb(docName: string, doc: Y.Doc): Promise<boolean> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(docName);
      req.onsuccess = () => {
        if (req.result && req.result instanceof Uint8Array) {
          Y.applyUpdate(doc, req.result, 'indexeddb');
          resolve(true);
        } else {
          resolve(false);
        }
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function saveDocToIndexedDb(docName: string, doc: Y.Doc): Promise<void> {
  try {
    const state = Y.encodeStateAsUpdate(doc);
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(state, docName);
  } catch {}
}
