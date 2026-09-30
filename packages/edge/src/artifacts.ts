import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Immutable storefront artifacts: `storefronts/<bundle>/<release>/<path>` under a root that is
// a local directory (file:// or absolute path) or an S3-compatible bucket (s3://bucket/prefix).

export interface ArtifactStore {
  readonly uri: string;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const BUNDLE_RE = /^[a-z0-9_][a-z0-9_-]{0,39}(\/[a-z0-9_][a-z0-9_-]{0,39})?$/;
export const RELEASE_RE = /^[0-9a-f]{20}$/;

/** A relative, '/'-separated key with no empty, '.' or '..' segments. */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 1024 || key.startsWith('/') || /[\\\0]/.test(key)) return false;
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function checkKey(key: string): string {
  if (!isSafeKey(key)) throw new Error(`invalid artifact key '${key}'`);
  return key;
}

export function releaseKey(bundle: string, release: string, path?: string): string {
  if (!BUNDLE_RE.test(bundle)) throw new Error(`invalid bundle '${bundle}'`);
  if (!RELEASE_RE.test(release)) throw new Error(`invalid release id '${release}'`);
  const base = `storefronts/${bundle}/${release}`;
  return path === undefined ? base : checkKey(`${base}/${path}`);
}

function fsStore(dir: string): ArtifactStore {
  const root = resolve(dir);
  const at = (key: string) => join(root, checkKey(key));
  return {
    uri: pathToFileURL(root).href,
    async get(key) {
      try {
        return new Uint8Array(await readFile(at(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async put(key, body) {
      const file = at(key);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    },
    async exists(key) {
      try {
        return (await stat(at(key))).isFile();
      } catch {
        return false;
      }
    },
  };
}

function isMissing(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err?.code === 'NoSuchKey' ||
    err?.code === 'ERR_S3_FILE_NOT_FOUND' ||
    /NoSuchKey|not found|404/i.test(err?.message ?? '')
  );
}

function s3Store(uri: string): ArtifactStore {
  const url = new URL(uri);
  const bucket = url.hostname;
  if (!bucket) throw new Error(`s3 artifact uri needs a bucket: '${uri}'`);
  const prefix = url.pathname.replace(/^\/+|\/+$/g, '');
  const env = process.env;
  const client = new Bun.S3Client({
    bucket,
    virtualHostedStyle: false,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_REGION ? { region: env.S3_REGION } : {}),
    ...(env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID } : {}),
    ...(env.S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY } : {}),
  });
  const at = (key: string) => (prefix ? `${prefix}/${checkKey(key)}` : checkKey(key));
  return {
    uri: `s3://${bucket}${prefix ? `/${prefix}` : ''}`,
    async get(key) {
      try {
        return new Uint8Array(await client.file(at(key)).arrayBuffer());
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async put(key, body, contentType) {
      await client.write(at(key), body, { type: contentType });
    },
    async exists(key) {
      return client.exists(at(key));
    },
  };
}

export function openArtifactStore(uri: string): ArtifactStore {
  const u = uri.trim();
  if (u.startsWith('s3://')) return s3Store(u);
  if (u.startsWith('file://')) return fsStore(fileURLToPath(u));
  if (isAbsolute(u)) return fsStore(u);
  throw new Error(`unsupported artifact uri '${uri}' (file:///abs/path, /abs/path or s3://bucket)`);
}
