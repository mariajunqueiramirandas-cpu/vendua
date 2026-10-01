// Staff check of an adapter against the live platform (docs/menu-import.md §8):
//   bun run import:probe <url> [--keys]
// Runs read + map + validateDoc and prints counts and what wouldn't come over. Never prints the
// raw payload; --keys lists its field names only, to fix an adapter after the platform drifts;
// --codes prints counts and a tally of note codes only. A custom domain is placed first, as
// the read job does.

import { recognise } from './adapters/index.ts';
import { placeHost } from './custom-domain.ts';
import { validateDoc } from './doc.ts';
import { createImportHttp, ImportFailure } from './http.ts';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
if (!url) {
  console.error('usage: bun run import:probe <store url> [--keys]');
  process.exit(2);
}

const recognised = recognise(url);
if (recognised.kind !== 'ok' && recognised.kind !== 'custom') {
  console.error(
    recognised.kind === 'invalid'
      ? 'not a link'
      : `${recognised.kind}: ${recognised.platform ?? 'unknown platform'}`,
  );
  process.exit(1);
}

async function placed(host: string, link: URL) {
  try {
    const p = await placeHost(host);
    if (p) {
      console.log(`${host}: claimed by ${p.adapter.platform} (${p.ref})`);
      return { ...p, url: link };
    }
    console.error(`${host}: no platform claims it`);
  } catch (e) {
    if (!(e instanceof ImportFailure)) throw e;
    console.error(`${host}: placing failed: ${e.code} — ${e.message}`);
  }
  process.exit(1);
}
const r = recognised.kind === 'ok' ? recognised : await placed(recognised.host, recognised.url);

function keys(v: unknown, path = '', out = new Map<string, Set<string>>(), depth = 0) {
  if (depth > 12) return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 50)) keys(x, `${path}[]`, out, depth + 1);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const t = Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x;
      const set = out.get(path) ?? new Set();
      set.add(`${k}:${t}`);
      out.set(path, set);
      if (x && typeof x === 'object') keys(x, `${path}.${k}`, out, depth + 1);
    }
  }
  return out;
}

const started = Date.now();
const http = createImportHttp({
  hosts: r.adapter.hosts.api,
  ...(r.adapter.limits ? { limits: r.adapter.limits } : {}),
});
try {
  const raw = await r.adapter.read(r.ref, http);
  if (args.includes('--keys')) {
    for (const [path, set] of keys(raw))
      console.log(`${path || '(root)'}  ${[...set].sort().join(' ')}`);
  }
  const doc = r.adapter.map(raw, {
    platform: r.adapter.platform,
    url: r.url.href,
    ref: r.ref,
    readAt: new Date().toISOString(),
  });
  const { doc: valid, counts } = validateDoc(doc);
  console.log(
    `${r.adapter.platform} ${r.ref}: ${http.used} request(s), ${Date.now() - started} ms`,
  );
  console.log(JSON.stringify(counts, null, 2));
  if (args.includes('--codes')) {
    // aggregate only: how the adapter fared, with nothing of the store's own content
    const tally = new Map<string, number>();
    for (const l of valid.lost)
      tally.set(`${l.scope}:${l.code}`, (tally.get(`${l.scope}:${l.code}`) ?? 0) + 1);
    for (const [k, n] of [...tally].sort()) console.log(`  ${k} ×${n}`);
    const groups = valid.categories.flatMap((c) => c.products.flatMap((p) => p.optionGroups));
    console.log(
      `option groups: ${groups.length}, most_expensive ${groups.filter((g) => g.pricingRule === 'most_expensive').length}, repeatable options ${groups.flatMap((g) => g.options).filter((o) => (o.maxQty ?? 1) > 1).length}, zones ${valid.zones?.length ?? 0}`,
    );
    process.exit(0);
  }
  for (const c of valid.categories)
    console.log(
      `  ${c.name}: ${c.products.length} produto(s), ${c.products.filter((p) => p.status === 'archived').length} oculto(s)`,
    );
  console.log('lost:');
  for (const l of valid.lost)
    console.log(
      `  - ${l.scope}${l.subject ? ` «${l.subject}»` : ''}: ${l.code}${l.detail ? ` (${l.detail.slice(0, 60)})` : ''}`,
    );
} catch (e) {
  if (e instanceof ImportFailure) {
    console.error(`failed: ${e.code} — ${e.message}`);
    process.exit(1);
  }
  throw e;
}
