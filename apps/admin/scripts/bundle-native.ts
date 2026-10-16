// The app's over-the-air bundle (ADR 0044 §2), run after `vite build --mode native`: names
// dist-native/ by its content (`<app version>-<hash>`, written into dist-native/bundle.json so the
// running app knows which bundle it is), zips it byte-for-byte reproducibly, and writes
// bundles/<version>.zip + bundles/manifest.json, which Core's image carries and serves
// (packages/core/src/admin/app-bundle.ts). `requiresNative` is app-version.json's `native`:
// a bundle built against a newer shell is never offered to an older one.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist-native');
const out = join(root, 'bundles');
const app = JSON.parse(readFileSync(join(root, 'app-version.json'), 'utf8')) as {
  version: string;
  native: number;
};

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
const list = () =>
  walk(dist)
    .map((f) => relative(dist, f).split('\\').join('/'))
    .filter((f) => !f.endsWith('.map'))
    .sort();

const hash = createHash('sha256');
for (const f of list().filter((f) => f !== 'bundle.json'))
  hash
    .update(f)
    .update('\0')
    .update(readFileSync(join(dist, f)));
const version = `${app.version}-${hash.digest('hex').slice(0, 12)}`;
writeFileSync(join(dist, 'bundle.json'), JSON.stringify({ version }) + '\n');

// ── a zip with fixed timestamps and order: the same commit is the same bytes ───────
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // 2020-01-01

const parts: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const name of list()) {
  const data = readFileSync(join(dist, name));
  const packed = deflateRawSync(data, { level: 9 });
  const store = packed.length >= data.length;
  const body = store ? data : packed;
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // utf-8 names
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(store ? 0 : 8, 10);
  dir.writeUInt16LE(DOS_TIME, 12);
  dir.writeUInt16LE(DOS_DATE, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(body.length, 20);
  dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);
  parts.push(local, nameBuf, body);
  offset += local.length + nameBuf.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, cd, end]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${version}.zip`), zip);
const sha256 = createHash('sha256').update(zip).digest('hex');
writeFileSync(
  join(out, 'manifest.json'),
  JSON.stringify({ version, sha256, requiresNative: app.native }, null, 2) + '\n',
);
console.log(`bundle ${version}: ${(zip.length / 1024).toFixed(0)} KB, ${central.length / 2} files`);
