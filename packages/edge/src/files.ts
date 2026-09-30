import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { releaseKey, type ArtifactStore } from './artifacts.ts';
import { ByteCache, Lru } from './cache.ts';
import { log } from './log.ts';
import { MANIFEST_FILE, parseManifest, sha256Hex, type StorefrontManifest } from './manifest.ts';

export class ArtifactError extends Error {
  constructor(
    message: string,
    readonly kind: 'missing' | 'integrity' | 'store',
  ) {
    super(message);
  }
}

async function readOrNull(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, body: Uint8Array | string) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}

/**
 * Release manifests and files, read through a disk cache under `<cacheDir>/releases/<id>/`.
 * Releases are immutable, so a cached copy never needs revalidating — but a copy fetched from
 * the store is only cached (and served) once its sha256 matches the manifest.
 */
export function createReleases(o: { store: ArtifactStore; cacheDir: string; memBytes?: number }) {
  const manifests = new Lru<string, StorefrontManifest>(256);
  const mem = new ByteCache(o.memBytes ?? 64 * 1024 * 1024);
  const inflight = new Map<string, Promise<Uint8Array>>();
  const dir = (release: string) => join(o.cacheDir, 'releases', release);

  async function manifest(bundle: string, release: string): Promise<StorefrontManifest> {
    const hit = manifests.get(release);
    if (hit) return hit;
    const local = join(dir(release), MANIFEST_FILE);
    let raw = await readOrNull(local);
    const fromStore = !raw;
    if (!raw) {
      try {
        raw = await o.store.get(releaseKey(bundle, release, MANIFEST_FILE));
      } catch (e) {
        throw new ArtifactError(`artifact store: ${(e as Error).message}`, 'store');
      }
      if (!raw) throw new ArtifactError(`release ${bundle}/${release} has no manifest`, 'missing');
    }
    let m: StorefrontManifest;
    try {
      m = parseManifest(JSON.parse(new TextDecoder().decode(raw)));
    } catch (e) {
      throw new ArtifactError(`${bundle}/${release}: ${(e as Error).message}`, 'integrity');
    }
    if (m.release !== release || m.bundle !== bundle)
      throw new ArtifactError(
        `${bundle}/${release}: manifest names ${m.bundle}/${m.release}`,
        'integrity',
      );
    if (fromStore)
      await writeAtomic(local, raw).catch((e) =>
        log('warn', 'cache write failed', { file: local, error: (e as Error).message }),
      );
    manifests.set(release, m);
    return m;
  }

  async function load(m: StorefrontManifest, path: string): Promise<Uint8Array> {
    const meta = m.files[path]!;
    const local = join(dir(m.release), path);
    const cached = await readOrNull(local);
    if (cached && cached.length === meta.size) return cached;
    let body: Uint8Array | null;
    try {
      body = await o.store.get(releaseKey(m.bundle, m.release, path));
    } catch (e) {
      throw new ArtifactError(`artifact store: ${(e as Error).message}`, 'store');
    }
    if (!body) throw new ArtifactError(`${m.bundle}/${m.release}/${path} is missing`, 'missing');
    if (body.length !== meta.size || sha256Hex(body) !== meta.sha256) {
      log('error', 'artifact integrity mismatch', { release: m.release, path });
      throw new ArtifactError(`${m.release}/${path}: sha256 mismatch`, 'integrity');
    }
    await writeAtomic(local, body).catch((e) =>
      log('warn', 'cache write failed', { file: local, error: (e as Error).message }),
    );
    return body;
  }

  /** The verified bytes of `path` (must be a key of `m.files`). */
  async function file(m: StorefrontManifest, path: string): Promise<Uint8Array> {
    const key = `${m.release}/${path}`;
    const hit = mem.get(key);
    if (hit) return hit;
    let p = inflight.get(key);
    if (!p) {
      p = load(m, path).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const body = await p;
    mem.set(key, body);
    return body;
  }

  function gzipOf(m: StorefrontManifest, path: string, body: Uint8Array): Uint8Array {
    const key = `${m.release}/${path}\0gz`;
    let gz = mem.get(key);
    if (!gz) {
      gz = Bun.gzipSync(body as Uint8Array<ArrayBuffer>);
      mem.set(key, gz);
    }
    return gz;
  }

  return { manifest, file, gzipOf };
}

export type Releases = ReturnType<typeof createReleases>;
