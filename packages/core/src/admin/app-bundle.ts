import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { clientOf } from './auth.ts';

// The admin app updates itself from Core, with no vendor (ADR 0044 §2): the deploy that builds
// this Core also builds the app's bundle from the same commit (apps/admin/scripts/bundle-native.ts)
// and bakes it into the image. The app asks for the manifest, downloads the zip, checks its
// sha256 and applies it; a bundle that needs a newer shell than the app has is never offered.

const BUNDLES = join(import.meta.dir, '../../../../apps/admin/bundles');
const VERSION_RE = /^[0-9A-Za-z._-]{1,64}$/;

export interface BundleManifest {
  version: string;
  sha256: string;
  /** the lowest shell `native` level this bundle runs on (app-version.json) */
  requiresNative: number;
}

let cached: { at: number; manifest: BundleManifest | null } | null = null;

/** The baked-in bundle, or null in dev and tests (nothing built). Read once: the image is fixed. */
export function bundleManifest(dir = BUNDLES): BundleManifest | null {
  if (cached && dir === BUNDLES) return cached.manifest;
  let manifest: BundleManifest | null = null;
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BundleManifest;
    if (
      typeof raw.version === 'string' &&
      VERSION_RE.test(raw.version) &&
      /^[0-9a-f]{64}$/.test(raw.sha256) &&
      Number.isInteger(raw.requiresNative) &&
      existsSync(join(dir, `${raw.version}.zip`))
    )
      manifest = { version: raw.version, sha256: raw.sha256, requiresNative: raw.requiresNative };
    else log.warn({ mod: 'app-bundle' }, 'apps/admin/bundles/manifest.json is malformed');
  } catch {
    /* no bundle built */
  }
  if (dir === BUNDLES) cached = { at: Date.now(), manifest };
  return manifest;
}

/** Core's floor for the app's shell: below it, every call answers 426 and the app asks for the
 *  store update. VENDUA_ADMIN_MIN_NATIVE, unset = no floor. */
export function minNative(): number {
  const n = Number(process.env.VENDUA_ADMIN_MIN_NATIVE);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Before everything under /admin/v1: an app too old for this Core gets one clear answer. */
export function clientFloor(): MiddlewareHandler {
  return async (c, next) => {
    const who = clientOf(c);
    if (who.kind !== 'web' && who.native < minNative())
      throw new HttpError(426, 'CLIENT_TOO_OLD', 'update the app in the store', {
        minNative: minNative(),
      });
    await next();
  };
}

/** GET /admin/v1/app/bundle?native=N → the bundle this shell can run (pre-session). */
export function mountBundleManifest(admin: Hono<any>, dir = BUNDLES) {
  admin.get('/app/bundle', (c: Context) => {
    const q = c.req.query('native');
    const native = q !== undefined && /^\d{1,6}$/.test(q) ? Number(q) : clientOfNative(c);
    c.header('cache-control', 'no-store');
    const m = bundleManifest(dir);
    if (!m) return c.json({ version: null, url: null, sha256: null, requiresNative: null });
    // a bundle that uses a plugin this shell doesn't have: the app says "atualize na loja"
    if (native === null || m.requiresNative > native)
      return c.json({ version: null, url: null, sha256: null, requiresNative: m.requiresNative });
    return c.json({
      version: m.version,
      url: `/admin/app/bundle/${m.version}.zip`,
      sha256: m.sha256,
      requiresNative: m.requiresNative,
    });
  });
}

const clientOfNative = (c: Context) => {
  const who = clientOf(c);
  return who.kind === 'web' ? null : who.native;
};

/** GET /admin/app/bundle/<version>.zip: only the version this image carries. */
export function mountBundleZip(app: Hono<any>, dir = BUNDLES) {
  app.get('/admin/app/bundle/:file', (c) => {
    const m = bundleManifest(dir);
    const file = c.req.param('file');
    // during a start-first swap the other Core may answer with its own version: a 404 here and
    // the app retries later (a checksum mismatch the same way)
    if (!m || file !== `${m.version}.zip`) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const path = join(dir, file);
    c.header('content-type', 'application/zip');
    c.header('content-length', String(statSync(path).size));
    c.header('cache-control', 'public, max-age=31536000, immutable');
    return c.body(readFileSync(path));
  });
}
