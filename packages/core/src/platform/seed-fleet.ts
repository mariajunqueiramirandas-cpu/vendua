// Fills a local Core with a fleet to judge the CRM's Lojas → frota: releases per bundle, stores
// the provisioner created (some from leads), a pinned store, a failing probe, open incidents and
// a provisioning stuck in verify.
//   bun run seed:fleet        (Core running on :8787 with CONTROL_SECRET=dev)
// Env: API (http://localhost:8787/control/v1), CONTROL_KEY (dev),
//      DATABASE_URL (postgres://vendua:vendua@localhost:5433/vendua — the states no API writes)
// Run apps/control's `bun scripts/dev-seed.ts` first (leads). Skips when the fleet already has
// releases.
import postgres from 'postgres';

const API = process.env.API ?? 'http://localhost:8787/control/v1';
const KEY = process.env.CONTROL_KEY ?? 'dev';
const db = postgres(process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua');

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-vendua-control': KEY,
      'idempotency-key': crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const existing = await call<{ releases: unknown[] }>('GET', '/fleet/releases');
if (existing.releases.length) {
  console.log(`already ${existing.releases.length} releases — skipping`);
  process.exit(0);
}

const hex = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
async function publish(bundle: string, tenant: string, kernelVersion: string) {
  const id = hex();
  await call('POST', '/fleet/releases', {
    manifest: {
      manifestVersion: 1,
      release: id,
      bundle,
      tenant,
      contract: 2,
      kernelVersion,
      builtAt: new Date().toISOString(),
      commit: hex().slice(0, 12),
      entry: 'index.html',
      spaFallback: true,
      files: { 'index.html': { size: 1200, sha256: 'a'.repeat(64), type: 'text/html' } },
      budgets: {
        files: 14,
        totalBytes: 612_000,
        htmlBytes: 1200,
        jsBytes: 540_000,
        cssBytes: 48_000,
        entryGzipBytes: 181_000,
      },
      qa: {
        status: 'passed',
        checks: ['compat', 'manifest', 'entry', 'budget'].map((c) => ({ id: c, ok: true })),
      },
      build: {},
    },
    artifactUri: `file:///var/lib/vendua/artifacts/storefronts/${bundle}/${id}`,
  });
  return id;
}

const t1 = await publish('_template', 'loja-modelo', '1.8.0');
await publish('quero-pudim', 'quero-pudim', '1.9.0');

const leads = (
  await call<{
    leads: { id: string; name: string; business_name: string | null; phone: string | null }[];
  }>('GET', '/leads?limit=100')
).leads;
const stores = [
  ['cantina-da-nona', 'Cantina da Nona', 'Giulia Rossi'],
  ['acai-do-porto', 'Açaí do Porto', 'Marcos Lima'],
  ['brigadeiros-bia', 'Brigadeiros da Bia', 'Beatriz Nunes'],
  ['marmitas-fit-sp', 'Marmitas Fit SP', 'Rafael Costa'],
  ['padaria-sao-jorge', 'Padaria São Jorge', 'Jorge Almeida'],
] as const;
const ids: Record<string, string> = {};
for (const [i, [slug, name, owner]] of stores.entries()) {
  const lead = i < 3 ? leads[i] : undefined;
  const p = await call<{ provisioning: { tenantId: string } }>('POST', '/fleet/provisionings', {
    ...(lead ? { leadId: lead.id } : {}),
    slug,
    storeName: name,
    planId: (['mirim', 'bandeira', 'pangolim'] as const)[i % 3],
    ownerName: owner,
    ownerPhone: `1199${String(1000000 + i * 7919).slice(0, 7)}`,
    ownerEmail: `${slug}@exemplo.com.br`,
  });
  ids[slug] = p.provisioning.tenantId;
}
await Bun.sleep(1500); // the provisioner runs right after each invite

// a newer template build: auto stores follow, then one store is held on the old one
await publish('_template', 'loja-modelo', '1.9.0');
await call('POST', '/fleet/storefronts/brigadeiros-bia/promote', {
  release: t1,
  reason: 'a dona pediu para esperar a troca do cardápio',
});

const now = Date.now();
const ago = (m: number) => new Date(now - m * 60_000);
// probes: everyone healthy but one store failing for 14 minutes
await db`
  insert into fleet_probes (host, tenant_id, status, failures, last_checked_at, last_ok_at,
                            last_release_id, latency_ms, next_check_at)
  select d.host, d.tenant_id, 'ok', 0, ${ago(0.4)}, ${ago(0.4)}, o.live_release_id,
         80 + (random() * 140)::int, now()
  from domains d join storefront_ops o on o.tenant_id = d.tenant_id
  where o.live_release_id is not null
  on conflict (host) do nothing
`;
const failing = 'marmitas-fit-sp.vendua.com.br';
await db`
  update fleet_probes set status = 'failing', failures = 14, failing_since = ${ago(14)},
    last_ok_at = ${ago(14)}, last_error = 'page: HTTP 502; state: HTTP 502', latency_ms = 10000
  where host = ${failing}
`;
for (let m = 14; m >= 1; m -= 1)
  await db`
    insert into health_checks (tenant_id, host, at, ok, latency_ms, checks)
    values (${ids['marmitas-fit-sp']!}, ${failing}, ${ago(m)}, false, 10000,
            ${db.json([
              { id: 'page', ok: false, detail: 'HTTP 502' },
              { id: 'loader', ok: true },
              { id: 'state', ok: false, detail: 'HTTP 502' },
              { id: 'checkout', ok: true },
            ])})
  `;
await db`
  insert into fleet_incidents (tenant_id, kind, severity, subject, summary, detail, opened_at)
  values (${ids['marmitas-fit-sp']!}, 'probe_failing', 'critical', ${failing},
          ${`${failing} não passa na sonda (page: HTTP 502; state: HTTP 502)`}, '{}', ${ago(11)})
`;
await db`
  insert into fleet_incidents (tenant_id, kind, severity, subject, summary, detail, opened_at, acked_at)
  values (${ids['acai-do-porto']!}, 'deployment_failed', 'warning', ${crypto.randomUUID()},
          'acai-do-porto: a versão 3f9c2a1 falhou e a loja voltou para 7d41b0e', '{}', ${ago(95)},
          ${ago(80)})
`;
// one store stuck waiting for its first verification
await db`
  update provisionings set state = 'verify', live_at = null, attempts = 3,
    last_error = 'a versão não subiu: nenhuma sonda viu esta versão no ar em 5 minutos',
    created_at = ${ago(42)}, next_attempt_at = now() + interval '2 minutes'
  where tenant_id = ${ids['padaria-sao-jorge']!}
`;
await db`
  insert into fleet_incidents (tenant_id, kind, severity, subject, summary, opened_at)
  select tenant_id, 'provisioning_stuck', 'warning', id::text,
         'padaria-sao-jorge: a loja não ficou no ar em 30 min (verify: a versão não subiu)', ${ago(12)}
  from provisionings where tenant_id = ${ids['padaria-sao-jorge']!}
`;
console.log('fleet seeded:', Object.keys(ids).join(', '));
await db.end();
