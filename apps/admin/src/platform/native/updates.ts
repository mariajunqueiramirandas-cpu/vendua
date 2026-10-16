import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';

// Over-the-air updates from our own Core (ADR 0044 §2): the deploy bakes this commit's bundle
// into Core's image; the app asks for its manifest, downloads the zip, checks its sha256 and
// stages it. The UX is the service worker's: a cold start applies a quick download before first
// paint, a running app offers "atualizar", and started() marks a bundle good (else it rolls back).

type Ctx = {
  url: (path: string) => string;
  headers: () => Record<string, string>;
  native: number;
  bundle: () => string;
};

let ctx: Ctx | null = null;
let staged: BundleInfo | null = null;
let storeUpdate = false;
let checking: Promise<void> | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

async function look(): Promise<void> {
  if (!ctx) return;
  const res = await fetch(ctx.url(`/admin/v1/app/bundle?native=${ctx.native}`), {
    headers: ctx.headers(),
    cache: 'no-store',
  });
  if (!res.ok) return;
  const m = (await res.json()) as {
    version: string | null;
    url: string | null;
    sha256: string | null;
    requiresNative: number | null;
  };
  // this Core's bundle needs a newer shell: only the store has it
  if (!m.version || !m.url || !m.sha256) {
    if (m.requiresNative !== null && m.requiresNative > ctx.native && !storeUpdate) {
      storeUpdate = true;
      window.dispatchEvent(new CustomEvent('vendua:store-update', { detail: { hard: false } }));
    }
    return;
  }
  if (m.version === ctx.bundle() || staged?.version === m.version) return;
  const have = (await CapacitorUpdater.list()).bundles.find(
    (b) => b.version === m.version && b.status !== 'error',
  );
  // a manifest from one Core and a zip from the other (a start-first swap) fail the checksum:
  // the next check tries again
  const b =
    have ??
    (await CapacitorUpdater.download({
      url: ctx.url(m.url),
      version: m.version,
      checksum: m.sha256,
    }));
  await CapacitorUpdater.next({ id: b.id });
  staged = b;
  tell();
}

export function startUpdates(c: Ctx) {
  ctx = c;
}

/** Look for a new bundle; one look at a time. */
export function checkForUpdate(): Promise<void> {
  checking ??= look()
    .catch(() => undefined)
    .finally(() => (checking = null));
  return checking;
}

/** A cold start: a bundle that downloads within ~3 s is applied before the first paint. */
export async function updateOnLaunch() {
  await Promise.race([checkForUpdate(), new Promise((r) => setTimeout(r, 3000))]);
  if (staged) await CapacitorUpdater.set({ id: staged.id });
}

export const updateReady = () => !!staged;
export const needsStoreUpdate = () => storeUpdate;
export function onUpdate(fn: () => void) {
  subs.add(fn);
  return () => void subs.delete(fn);
}
export function applyUpdate() {
  if (staged) void CapacitorUpdater.set({ id: staged.id });
  else location.reload();
}
/** The router mounted and /session answered: this bundle works, keep it. */
export function bundleGood() {
  void CapacitorUpdater.notifyAppReady().catch(() => undefined);
}
