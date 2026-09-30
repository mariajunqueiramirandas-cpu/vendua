// Phase 4 end to end against a running Core: a staff invite provisions a store, a real
// `_template` release is published to an artifact store, a real edge serves it with
// vendua-state, Core's probes verify it through the edge, a new release rolls out and a
// rollback brings the old one back — the "First store" stage gate's mechanics, minus DNS/TLS.
//
//   Core: CONTROL_SECRET, VENDUA_EDGE_SECRET, VENDUA_PROBES=1,
//         VENDUA_PROBE_ORIGIN=http://localhost:<EDGE_PORT>
//   bun packages/edge/scripts/smoke.ts
// Env: CORE (http://localhost:8787), CONTROL_SECRET, VENDUA_EDGE_SECRET, EDGE_PORT (8080),
//      STORE_DOMAIN (vendua.com.br — Core's VENDUA_STORE_DOMAIN).
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openArtifactStore } from '../src/artifacts.ts';
import { createEdge } from '../src/server.ts';

const CORE = process.env.CORE ?? 'http://localhost:8787';
const CONTROL = process.env.CONTROL_SECRET ?? 'dev';
const EDGE_SECRET = process.env.VENDUA_EDGE_SECRET ?? 'devedge';
const PORT = Number(process.env.EDGE_PORT ?? 8080);
const STORE_DOMAIN = process.env.STORE_DOMAIN ?? 'vendua.com.br';
const root = resolve(import.meta.dir, '../../..');
const dist = join(root, 'storefronts/_template/dist');

const step = (s: string) => console.log(`✓ ${s}`);
function fail(msg: string): never {
  throw new Error(msg);
}

async function control<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CORE}/control/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-vendua-control': CONTROL,
      'idempotency-key': crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

async function cli(args: string[], env: Record<string, string>) {
  const p = Bun.spawn(['bun', 'packages/cli/src/main.ts', ...args], {
    cwd: root,
    env: { ...process.env, VENDUA_CORE_ORIGIN: CORE, CONTROL_SECRET: CONTROL, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if (code !== 0) fail(`vendua ${args.join(' ')} exited ${code}\n${out}\n${err}`);
  return out;
}

async function until<T>(what: string, check: () => Promise<T | null>, seconds = 120): Promise<T> {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const v = await check();
    if (v !== null) return v;
    if (Date.now() > end) fail(`timed out waiting for ${what}`);
    await Bun.sleep(1000);
  }
}

interface Detail {
  live: { release: string } | null;
  policy: string;
  deployments: { release: string; status: string; kind: string }[];
}
const detail = async (slug: string) =>
  (await control<{ storefront: Detail }>('GET', `/fleet/storefronts/${slug}`)).storefront;

const artifacts = `file://${mkdtempSync(join(tmpdir(), 'vendua-artifacts-'))}`;
const cacheDir = mkdtempSync(join(tmpdir(), 'vendua-edge-'));
const slug = `smoke-${Date.now().toString(36)}`;
const host = `${slug}.${STORE_DOMAIN}`;
const page = () => fetch(`http://127.0.0.1:${PORT}/`, { headers: { host } });

const edge = createEdge({
  coreUrl: CORE,
  edgeSecret: EDGE_SECRET,
  store: openArtifactStore(artifacts),
  cacheDir,
  routeTtlMs: 2_000,
  stateTtlMs: 2_000,
});
const server = Bun.serve({ port: PORT, fetch: (req, srv) => edge.fetch(req, srv) });
const indexHtml = join(dist, 'index.html');
const backup = join(cacheDir, 'index.html.orig');

try {
  if (!existsSync(indexHtml)) {
    const b = Bun.spawnSync(['bun', 'run', 'build'], { cwd: join(root, 'storefronts/_template') });
    if (b.exitCode !== 0) fail('storefronts/_template build failed');
  }
  copyFileSync(indexHtml, backup);

  const published = await cli(['release', 'publish', '_template', '--no-build'], {
    VENDUA_ARTIFACTS: artifacts,
  });
  const first =
    published.match(/\b([0-9a-f]{20})\b/)?.[1] ?? fail(`no release id in:\n${published}`);
  step(`published _template ${first.slice(0, 7)} to ${artifacts}`);

  const plan = (await control<{ plans: { id: string }[] }>('GET', '/plans')).plans[0]?.id;
  const { provisioning } = await control<{ provisioning: { id: string } }>(
    'POST',
    '/fleet/provisionings',
    {
      slug,
      storeName: 'Loja da Fumaça',
      planId: plan ?? fail('no plans'),
      ownerName: 'Dona Fumaça',
      ownerPhone: `119${String(Date.now()).slice(-8)}`,
      ownerEmail: `${slug}@example.com`,
    },
  );
  step(`staff invite created ${slug}`);

  const live = await until('the provisioning to go live', async () => {
    const { provisionings } = await control<{
      provisionings: {
        id: string;
        state: string;
        lastError: string | null;
        log: { note: string }[];
      }[];
    }>('GET', '/fleet/provisionings');
    const p = provisionings.find((x) => x.id === provisioning.id);
    return p?.state === 'live' ? p : null;
  });
  step(`provisioned: ${live.log.map((l) => l.note).join(' → ')}`);

  const res = await page();
  const html = await res.text();
  if (res.status !== 200) fail(`page → ${res.status}`);
  if (res.headers.get('x-vendua-release') !== first)
    fail(`edge serves ${res.headers.get('x-vendua-release')}, expected ${first}`);
  const state = html.match(
    /<script id="vendua-state">window.__VENDUA_STATE__=(.*?)<\/script>/,
  )?.[1];
  const envelope = JSON.parse(state ?? fail('no vendua-state in the page')) as {
    store: { status: string };
  };
  step(`edge serves ${first.slice(0, 7)} with vendua-state (store ${envelope.store.status})`);
  const d0 = await detail(slug);
  if (d0.deployments[0]?.status !== 'live') fail(`deployment is ${d0.deployments[0]?.status}`);
  step(`deployment ${d0.deployments[0]!.kind} verified live by the probe`);

  writeFileSync(indexHtml, `${readFileSync(indexHtml, 'utf8')}<!-- smoke ${slug} -->\n`);
  const again = await cli(['release', 'publish', '_template', '--no-build'], {
    VENDUA_ARTIFACTS: artifacts,
  });
  const second = again.match(/\b([0-9a-f]{20})\b/)?.[1] ?? fail(`no release id in:\n${again}`);
  if (second === first) fail('a changed dist kept its release id');
  await until('the new release to verify', async () => {
    const d = await detail(slug);
    return d.live?.release === second && d.deployments[0]?.status === 'live' ? d : null;
  });
  if ((await page()).headers.get('x-vendua-release') !== second)
    fail('edge still on the old release');
  step(`new release ${second.slice(0, 7)} promoted automatically and verified`);

  await control('POST', `/fleet/storefronts/${slug}/rollback`, { reason: 'smoke' });
  const back = await until('the rollback to verify', async () => {
    const d = await detail(slug);
    return d.live?.release === first && d.deployments[0]?.status === 'live' ? d : null;
  });
  if (back.policy !== 'pinned') fail(`policy after rollback is ${back.policy}`);
  if ((await page()).headers.get('x-vendua-release') !== first) fail('edge did not roll back');
  step(`rollback to ${first.slice(0, 7)} verified; store pinned`);
  console.log('\nsmoke passed');
} finally {
  if (existsSync(backup)) copyFileSync(backup, indexHtml);
  server.stop(true);
  await edge.stop();
}
