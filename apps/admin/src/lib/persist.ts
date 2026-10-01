import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

// The last-known data survives a restart (IndexedDB): the app opens straight to the
// board, even offline, then refreshes. Signing out or switching stores wipes it.

const DB = 'vendua-admin';
const KEY = 'queries';
const MAX_AGE = 24 * 60 * 60_000;
// bump when a cached response shape changes incompatibly
const SCHEMA = 2;

let db: Promise<IDBDatabase> | null = null;
function open() {
  db ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return db;
}
async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await open();
  return new Promise<T>((ok, fail) => {
    const tx = d.transaction('kv', mode);
    const r = f(tx.objectStore('kv'));
    tx.oncomplete = () => ok(r.result);
    tx.onerror = () => fail(tx.error);
  });
}

interface Saved {
  schema: number;
  at: number;
  state: unknown;
}

/** Before first render; gives up quickly so a slow disk never delays the app. */
export async function restoreCache(qc: QueryClient) {
  try {
    const saved = await Promise.race([
      run<Saved | undefined>('readonly', (s) => s.get(KEY)),
      new Promise<undefined>((ok) => setTimeout(ok, 400)),
    ]);
    if (saved?.schema === SCHEMA && Date.now() - saved.at < MAX_AGE)
      hydrate(qc, saved.state as Parameters<typeof hydrate>[1]);
  } catch {
    /* private mode, no IndexedDB: start cold */
  }
}

export function clearPersisted() {
  return run('readwrite', (s) => s.delete(KEY)).catch(() => undefined);
}

/** Sign out / switch store: nothing of this session may outlive it. */
export async function resetClient(qc: QueryClient) {
  qc.clear();
  await clearPersisted();
}

export function persistCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const state = dehydrate(qc, {
      shouldDehydrateQuery: (q) => q.state.status === 'success',
    });
    if (!state.queries.some((q) => q.queryKey[0] === 'session')) return void clearPersisted();
    void run('readwrite', (s) => s.put({ schema: SCHEMA, at: Date.now(), state }, KEY)).catch(
      () => undefined,
    );
  };
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' && e.type !== 'removed') return;
    timer ??= setTimeout(save, 1000);
  });
  // backgrounding may be the last chance before the OS kills the app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      save();
    }
  });
  window.addEventListener('vendua:unauthenticated', () => void clearPersisted());
}
