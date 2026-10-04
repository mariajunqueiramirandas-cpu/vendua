// Real screenshots of the merchant admin and the storefront for the launch Reel's story: Caio sends
// Bolos da Nena's WhatsApp a voice note, Duá (the Vendedor) sells him a bolo de cenoura com brigadeiro
// plus a fatia de chocolate for delivery, Pix; the order lands in Pedidos, is accepted, prints, goes
// through the kitchen display and the pickup board, and the customer sees it ready.
//
// Dev database only. Data goes in the way the repo's own seeds do it: the store, menu and every
// order through Core's APIs (totals are Core's), and what has no API the way site/scripts/assets.ts,
// apps/admin/scripts/demo-orders.ts and demo-vendedor.ts do it in SQL: Vendedor threads and messages,
// the print device, and timestamps moved back to the shoot's evening so the screens read ~18h. The
// browser clock is pinned to the same evening. Nothing in the pages is edited.
//
// Needs, already running: Core on :8787 started with VENDUA_ADMIN_DEV_OTP=1 (dev DB on :5433), the
// admin (`bun run dev` in apps/admin, :5196) and the standard storefront (`bun run dev` in
// storefronts/_template, :5175). Expects a freshly seeded store (`bun run seed` in packages/core):
// it adds 29 orders so Caio's is #30. When Core serves the admin API only on its admin host
// (VENDUA_ADMIN_HOST), the browser reaches the admin through a small proxy inside this script that
// gives Core that Host; nothing else about the pages changes.
//
// Run: node videos/vendua-lancamento/scripts/capture-shots.mjs [phase ...]
// Phases, in story order (default: all): seed conversa pedidos impressoras cozinha vitrine.
// The order only moves forward: each phase shoots the moments its state still allows (conversa
// before pedidos accepts the order, cozinha's ticks and "pronto" once). Browser runs are bounded by
// their own timeouts; wrap the whole run in `timeout 600`.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const REPO = join(PROJECT, '../..');
const OUT = join(PROJECT, 'capture/assets');
const TMP = process.env.SHOTS_TMP ?? join(tmpdir(), 'vendua-lancamento-shots');
const CORE = new URL(process.env.CORE ?? 'http://localhost:8787');
const ADMIN = process.env.ADMIN ?? 'http://localhost:5196/admin/';
const STORE = process.env.STORE ?? 'http://bolosdanena.localhost:5175';
const DB = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
let PHONE = process.env.PHONE ?? '';
const SLUG = 'bolosdanena';
const HOST = `${SLUG}.localhost`;
const TZ = 'America/Sao_Paulo';
const AUTH = join(TMP, 'admin-auth.json');
const { chromium } = await import(
  join(REPO, 'node_modules/.bun/playwright-core@1.63.0/node_modules/playwright-core/index.mjs')
);

// libpq's ?host= / ?hostaddr= override the URL's host, so they are refused too
const dbUrl = new URL(DB);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname) ||
  dbUrl.searchParams.has('host') ||
  dbUrl.searchParams.has('hostaddr')
)
  throw new Error('dev database only');
const sql = (q) => execFileSync('psql', [DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const ts = (d) => `${lit(d.toISOString())}::timestamptz`;

// ── the evening of the shoot ─────────────────────────────────────────────────
// the latest São Paulo date whose 18:30 has already passed (Brazil has no DST since 2019)
const spDate = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function shootDay() {
  for (let d = new Date(); ; d = new Date(d.getTime() - 86_400_000)) {
    const day = spDate(d);
    if (new Date(`${day}T18:30:00-03:00`) <= new Date()) return day;
  }
}
const DAY = shootDay();
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00-03:00`);
const daysAgo = (n, hhmm) => new Date(at(hhmm).getTime() - n * 86_400_000);

// ── Core ─────────────────────────────────────────────────────────────────────
let cookie = '';
// Core may serve the admin API only on its own host (VENDUA_ADMIN_HOST, e.g. painel.vendua.com.br):
// then the admin API calls, here and from the browser, carry that Host
let ADMIN_HOST = process.env.VENDUA_ADMIN_HOST ?? '';

function core(method, path, { body, host, headers = {} } = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: CORE.hostname,
        port: CORE.port,
        path,
        method,
        headers: {
          host: host ?? CORE.host,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...headers,
          ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          let out = {};
          try {
            out = s ? JSON.parse(s) : {};
          } catch {
            out = { raw: s.slice(0, 200) };
          }
          resolve({ status: res.statusCode, headers: res.headers, body: out });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function api(method, path, body) {
  const r = await core(method, `/admin/v1${path}`, {
    body,
    host: ADMIN_HOST || undefined,
    headers: { 'x-vendua-admin': '1', ...(cookie ? { cookie } : {}) },
  });
  const set = r.headers['set-cookie'];
  if (set?.length) cookie = set[0].split(';')[0];
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** The storefront and checkout APIs, addressed to the store by its Host. */
async function shop(method, path, body, token) {
  const r = await core(method, path, {
    body,
    host: HOST,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');

// the same store the site's admin screens show (site/scripts/assets.ts MENU, NENA_HOURS)
const MENU = [
  [
    'Bolos inteiros',
    'Bolo de cenoura com brigadeiro - 45,00\nBolo de chocolate molhadinho - 48,00\nBolo de fubá com goiabada - 38,00\nBolo de milho cremoso - 40,00\nBolo de laranja com calda - 38,00\nBolo de banana com canela - 40,00',
  ],
  [
    'Fatias do dia',
    'Fatia de cenoura com brigadeiro - 9,00\nFatia de chocolate - 9,50\nFatia de fubá com goiabada - 8,00',
  ],
  [
    'Encomendas',
    'Bolo de aniversário 2 kg - 160,00\nBolo de aniversário 3 kg - 230,00\nKit festa: bolo + 50 docinhos - 210,00',
  ],
  ['Para acompanhar', 'Café coado 300 ml - 6,00\nSuco de laranja 400 ml - 9,00'],
];
const NENA_HOURS = [
  { days: [2, 3, 4, 5, 6], open: '08:00', close: '18:00' },
  { days: [0], open: '08:00', close: '12:00' },
];

// Caio and the store's other customers today (fictional; numbers in the demo seeds' style)
const CAIO = { name: 'Caio', phone: '22900000130' };
const CAIO_ADDRESS = { neighborhood: 'Parque Califórnia', street: 'Rua das Acácias', number: '120' };
const CAKE = 'Bolo de cenoura com brigadeiro';
const SLICE = 'Fatia de chocolate';
const THREAD_PREFIX = '552290000';

let TID = '';
const tenantId = () =>
  (TID ||= sql(
    `select id from tenants where slug in ('${SLUG}', 'quero-pudim') order by (slug = '${SLUG}') desc limit 1`,
  ));

async function signIn() {
  if (!ADMIN_HOST) {
    const probe = await core('GET', '/admin/v1/session', { headers: { 'x-vendua-admin': '1' } });
    if (probe.status === 404) ADMIN_HOST = 'painel.vendua.com.br';
  }
  // a session from an earlier run still good: sign-in codes are capped per hour
  try {
    const st = JSON.parse(readFileSync(AUTH, 'utf8'));
    cookie = st.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    if ((await core('GET', '/admin/v1/session', { host: ADMIN_HOST || undefined, headers: { 'x-vendua-admin': '1', cookie } })).status === 200) return;
  } catch {}
  cookie = '';
  // the seed store's owner (the seed's phone has changed over time)
  PHONE ||= sql(`select phone from merchant_users where tenant_id = '${tenantId()}' and role = 'owner' order by created_at limit 1`);
  const start = await api('POST', '/auth/otp/start', { phone: PHONE });
  const code = start.devCode ?? JSON.stringify(start).match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error('no dev sign-in code: start Core with VENDUA_ADMIN_DEV_OTP=1');
  await api('POST', '/auth/otp/verify', { phone: PHONE, code });
  const [name, value] = cookie.split('=');
  mkdirSync(TMP, { recursive: true });
  const state = {
    cookies: [
      { name, value, domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' },
    ],
    origins: [],
  };
  execFileSync('sh', ['-c', `cat > ${JSON.stringify(AUTH)}`], { input: JSON.stringify(state) });
}

let products = null;
async function product(name) {
  if (!products) {
    const { categories } = await shop('GET', '/storefront/v1/catalog');
    products = new Map(categories.flatMap((c) => c.products).map((p) => [p.name, p]));
  }
  const p = products.get(name);
  if (!p) throw new Error(`no product ${name}`);
  return p;
}

/** A cart through the real checkout API: items, then (optionally) where it goes. */
async function cart(lines, delivery) {
  const s = await shop('POST', '/checkout/v1/session');
  for (const [name, qty] of lines)
    await shop('POST', '/checkout/v1/cart/items', { productId: (await product(name)).id, qty }, s.sessionToken);
  if (delivery) await shop('POST', '/checkout/v1/cart/delivery', delivery, s.sessionToken);
  const { cart: view } = await shop('GET', '/checkout/v1/cart', undefined, s.sessionToken);
  return { token: s.sessionToken, cart: view };
}

async function placeOrder(lines, customer, delivery, method, notes) {
  const c = await cart(lines);
  const r = await shop(
    'POST',
    '/checkout/v1/checkout',
    {
      customer,
      delivery,
      payment: { method },
      ...(notes ? { notes } : {}),
    },
    c.token,
  );
  return { ...r.order, token: c.token };
}

/** Moves an order's steps back to the evening: each event to its time, the promise with it. */
function backdate(orderId, times) {
  const tid = tenantId();
  for (const [state, when] of Object.entries(times)) {
    if (state === 'placed') {
      // the checkout promised the window from the real clock: placed + the zone's eta
      sql(`update orders set delivery = delivery || jsonb_build_object(
             'promisedFrom', to_char((${ts(when)} + make_interval(mins => (delivery ->> 'etaMin')::int)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'promisedTo', to_char((${ts(when)} + make_interval(mins => (delivery ->> 'etaMax')::int)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           where tenant_id = '${tid}' and id = '${orderId}' and delivery ? 'promisedFrom' and delivery ? 'etaMin' and delivery ? 'etaMax'
             and state = 'placed'`);
      sql(`update orders set placed_at = ${ts(when)} where tenant_id = '${tid}' and id = '${orderId}';
           update order_events set at = ${ts(when)} where tenant_id = '${tid}' and order_id = '${orderId}' and to_state = 'placed'`);
      continue;
    }
    if (state === 'confirmed') {
      // the promise was made from the real clock at accept time: it moves by the same amount
      sql(`update orders o set delivery = o.delivery
             || case when o.delivery ? 'promisedFrom' then jsonb_build_object(
                  'promisedFrom', to_char(((o.delivery ->> 'promisedFrom')::timestamptz + (${ts(when)} - e.at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'promisedTo', to_char(((o.delivery ->> 'promisedTo')::timestamptz + (${ts(when)} - e.at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                else '{}'::jsonb end
           from order_events e
           where o.tenant_id = '${tid}' and o.id = '${orderId}' and e.order_id = o.id and e.to_state = 'confirmed'`);
    }
    sql(`update order_events set at = ${ts(when)} where tenant_id = '${tid}' and order_id = '${orderId}' and to_state = '${state}';
         update print_jobs set created_at = ${ts(when)}, finished_at = case when finished_at is null then null else ${ts(when)} + interval '4 seconds' end
           where tenant_id = '${tid}' and order_id = '${orderId}' and trigger = '${state}';
         update orders set updated_at = greatest(${ts(when)}, placed_at) where tenant_id = '${tid}' and id = '${orderId}'`);
  }
}

// ── seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  const id = tenantId();
  if (!id) throw new Error('no seed store: run `bun run seed` in packages/core first');
  // turn the seed store into Bolos da Nena (videos/vendua-audio-47s/scripts/storefront-shots.mjs)
  sql(`update tenants set slug = '${SLUG}', name = 'Bolos da Nena' where id = '${id}'`);
  sql(`insert into domains (host, tenant_id, is_primary) values ('${HOST}', '${id}', false) on conflict do nothing`);
  sql(`update merchant_users set name = 'Nena' where tenant_id = '${id}' and role = 'owner'`);
  await signIn();
  if (Number(sql(`select count(*) from products where tenant_id = '${id}'`)) === 0) {
    await api('PATCH', '/store', {
      profile: {
        name: 'Bolos da Nena',
        tagline: 'Bolo de vó, feito hoje.',
        description:
          'Bolos caseiros assados todo dia de manhã, na cozinha da Nena. Fatias no balcão e bolos inteiros por encomenda.',
        instagram: '@bolosdanena',
        city: 'Campos dos Goytacazes',
        address: 'Rua dos Goitacazes, 214, Centro',
      },
      hours: NENA_HOURS,
      operations: { pickupEnabled: true, deliveryEnabled: true, prepTimeMinutes: 30 },
    });
    for (const [name, hoods, feeCents] of [
      ['Centro', ['Centro', 'Parque Tamandaré', 'Pelinca'], 500],
      ['Bairros próximos', ['Parque Califórnia', 'Jardim Carioca', 'Turf Club'], 800],
    ])
      await api('POST', '/zones', { name, kind: 'neighborhood', neighborhoods: hoods, feeCents });
    for (const [name, text] of MENU) {
      const c = await api('POST', '/categories', { name });
      await api('POST', '/products/import', { text, categoryId: c.category.id });
    }
    console.log('seeded the Bolos da Nena menu');
  }
  // a fictional key: the Pix card and the order page build their static Pix code from it
  await api('PATCH', '/payments', {
    pix: { key: 'pedidos@bolosdanena.com.br', keyType: 'email', beneficiary: 'Bolos da Nena', city: 'Campos' },
  });

  // the store's WhatsApp and its Duá, as apps/admin/scripts/demo-vendedor.ts sets them
  sql(`insert into store_agent (tenant_id, enabled, settings, onboarding, enabled_at, first_sale_at)
       values ('${id}', true, ${json({ coverage: 'when_slow', slowAfterMin: 2 })},
               ${json({ started: true, finished: true, part: 'comecar', interviewDone: true })},
               now() - interval '6 days', now() - interval '5 days')
       on conflict (tenant_id) do update set enabled = true, settings = excluded.settings,
         onboarding = excluded.onboarding, enabled_at = excluded.enabled_at, first_sale_at = excluded.first_sale_at`);
  sql(`insert into store_whatsapp (tenant_id, wanted, state, phone, connected_at)
       values ('${id}', true, 'open', '22999999999', now())
       on conflict (tenant_id) do update set wanted = true, state = 'open'`);

  // one paired computer at the counter with its receipt printer, stored the way pairing and the
  // agent's report store them (modules/printing); it prints on accept
  if (Number(sql(`select count(*) from print_devices where tenant_id = '${id}'`)) === 0) {
    const version = readFileSync(join(REPO, 'apps/print-agents/VERSION'), 'utf8').trim();
    const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const dev = sql(`insert into print_devices (tenant_id, name, platform, agent_version, token_hash, connected_at, last_seen_at, created_at)
       values ('${id}', 'Balcão', 'windows', ${lit(version)}, '${hash}', now(), now(), now() - interval '12 days') returning id`)
      .split('\n')[0];
    sql(`insert into printers (tenant_id, device_id, key, kind, name, address, source, present, auto, paper, created_at)
       values ('${id}', '${dev}', 'spooler:EPSON TM-T20X', 'spooler', 'EPSON TM-T20X',
               'EPSON TM-T20X', 'agent', true, true, 80, now() - interval '12 days')`);
  }
  await api('PATCH', '/printers/settings', { printOn: 'confirmed' });

  const orders = Number(sql(`select count(*) from orders where tenant_id = '${id}'`));
  if (orders === 0) await seedOrders();
  else console.log(`${orders} orders already there: not seeding orders`);
}

// a month of history, then today's live board; #30 is Caio's (placed in the `conversa` phase)
async function seedOrders() {
  const tid = tenantId();
  await withOpenStore(async () => {
    let seedN = 7;
    const rnd = () => ((seedN = (seedN * 16807) % 2147483647) - 1) / 2147483646;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const PEOPLE = [
      ['Ana Paula Ribeiro', '22998761234'],
      ['Joana Lima', '22988887777'],
      ['Carlos Eduardo', '22991112222'],
      ['Pedro Henrique', '21996664444'],
      ['Juliana Rocha', '22990001111'],
      ['Tiago Nunes', '22981234567'],
      ['Camila Duarte', '22987654321'],
    ];
    const DISHES = [
      'Bolo de cenoura com brigadeiro',
      'Bolo de chocolate molhadinho',
      'Bolo de fubá com goiabada',
      'Bolo de milho cremoso',
      'Bolo de laranja com calda',
      'Bolo de banana com canela',
      'Fatia de cenoura com brigadeiro',
      'Fatia de chocolate',
      'Fatia de fubá com goiabada',
      'Café coado 300 ml',
    ];
    for (let i = 0; i < 24; i++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => [pick(DISHES), 1 + Math.floor(rnd() * 2)]);
      const [name, phone] = pick(PEOPLE);
      const delivery =
        rnd() < 0.55
          ? { mode: 'delivery', neighborhood: pick(['Centro', 'Pelinca', 'Jardim Carioca']), street: 'Rua das Flores', number: String(10 + i) }
          : { mode: 'pickup' };
      const o = await placeOrder(lines, { name, phone }, delivery, pick(['pix', 'pix', 'card_on_delivery', 'cash']));
      const placed = daysAgo(1 + (i % 27), pick(['10:20', '11:40', '12:15', '15:30', '17:10', '18:05', '19:20']));
      const state = i % 11 === 5 ? 'cancelled' : 'delivered';
      // demo-orders.ts walks the old ones to a final state the same way
      sql(`update orders set placed_at = ${ts(placed)}, updated_at = ${ts(placed)} + interval '50 minutes', state = '${state}',
             payment = payment || '{"status":"paid"}' where tenant_id = '${tid}' and id = '${o.id}';
           update order_events set at = ${ts(placed)} where tenant_id = '${tid}' and order_id = '${o.id}';
           insert into order_events (tenant_id, order_id, from_state, to_state, actor, at, meta)
             values ('${tid}', '${o.id}', 'placed', '${state}', 'merchant', ${ts(placed)} + interval '50 minutes', '{}')`);
    }

    // today's board, through the admin's own steps, then moved back to the evening
    const live = [
      // #25: delivered this afternoon (Concluídos)
      { lines: [['Bolo de banana com canela', 1]], who: ['Beatriz Costa', '22995556666'], d: { mode: 'pickup' }, pay: 'pix', steps: { placed: '16:20', confirmed: '16:22', preparing: '16:30', ready: '16:48', delivered: '17:02' } },
      // #26: ready at the counter (the pickup board's other number)
      { lines: [['Bolo de fubá com goiabada', 1], ['Café coado 300 ml', 2]], who: ['Fernanda Alves', '22993338888'], d: { mode: 'pickup' }, pay: 'pix', steps: { placed: '17:31', confirmed: '17:33', preparing: '17:41', ready: '17:59' } },
      // #27: late in the kitchen (red)
      { lines: [['Bolo de chocolate molhadinho', 1], ['Fatia de fubá com goiabada', 2]], who: ['Rafael Martins', '22992229999'], d: { mode: 'pickup' }, pay: 'cash', steps: { placed: '17:38', confirmed: '17:40', preparing: '17:44' }, done: ['Fatia de fubá com goiabada'] },
      // #28: the order in the site's screens, past 60% of its time (amber)
      { lines: [['Bolo de milho cremoso', 2]], who: ['Mariana Souza', '22997773333'], d: { mode: 'delivery', neighborhood: 'Centro', street: 'Rua Barão de Miracema', number: '45' }, pay: 'pix', steps: { placed: '17:56', confirmed: '17:58' } },
      // #29: Luiz's, the order in the site's screens (R$ 219,00); still new when Caio's lands
      { lines: [['Bolo de chocolate molhadinho', 2], ['Bolo de laranja com calda', 1], ['Bolo de milho cremoso', 2]], who: ['Luiz Fernando', '22994447777'], d: { mode: 'delivery', neighborhood: 'Centro', street: 'Rua Tenente Coronel Cardoso', number: '118' }, pay: 'pix', steps: { placed: '18:01' } },
    ];
    for (const l of live) {
      const o = await placeOrder(l.lines, { name: l.who[0], phone: l.who[1] }, l.d, l.pay);
      l.id = o.id;
      l.number = o.number;
    }
    for (const l of live) {
      if (l.pay === 'pix' && l.steps.confirmed) await api('POST', `/orders/${l.id}/payment`, { status: 'paid' });
      for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
        if (l.steps[to]) await api('POST', `/orders/${l.id}/transition`, { to, ...(to === 'confirmed' ? { prepMinutes: 30 } : {}) });
      if (l.done) {
        const ids = sql(`select i.id from order_items i where i.tenant_id = '${tid}' and i.order_id = '${l.id}' and i.name = any(${lit(`{${l.done.map((n) => `"${n}"`).join(',')}}`)}::text[])`).split('\n');
        await api('POST', `/kitchen/orders/${l.id}/items`, { items: ids, done: true });
        sql(`update kitchen_marks set done_at = ${ts(at('17:55'))} where tenant_id = '${tid}' and order_id = '${l.id}'`);
      }
      backdate(l.id, Object.fromEntries(Object.entries(l.steps).map(([k, v]) => [k, at(v)])));
      sql(`update orders set payment = payment || jsonb_build_object('paidAt', ${lit(at(l.steps.confirmed ?? l.steps.placed).toISOString())})
           where tenant_id = '${tid}' and id = '${l.id}' and payment ->> 'status' = 'paid'`);
      console.log(`order #${l.number} ${l.who[0]} → ${Object.keys(l.steps).at(-1)}`);
    }
    // the printer printed what it was sent on accept (the agent's report: jobs.ts recordJobResultTx)
    sql(`update print_jobs set status = 'done', attempts = 1, sent_at = created_at + interval '2 seconds', finished_at = created_at + interval '4 seconds'
         where tenant_id = '${tid}' and status in ('pending', 'sent')`);
  });
}

/** Checkout needs the store open: plausible bakery hours that cover "now", then Nena's back. */
async function withOpenStore(fn) {
  const hourNow = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const close = hourNow >= 21 ? '23:59' : `${String(Math.max(19, hourNow + 2)).padStart(2, '0')}:00`;
  const open = hourNow < 7 ? '00:00' : '07:00';
  await api('PATCH', '/store', { hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open, close }] });
  try {
    return await fn();
  } finally {
    await api('PATCH', '/store', { hours: NENA_HOURS }).catch((e) => console.error('hours not restored:', e.message));
  }
}

// ── the Vendedor threads ─────────────────────────────────────────────────────
const caioThread = () =>
  sql(`select id from shopper_threads where tenant_id = '${tenantId()}' and address = '${THREAD_PREFIX}0130@s.whatsapp.net'`);
const caioOrder = () => {
  const row = sql(`select id, number, total_cents, state from orders where tenant_id = '${tenantId()}'
    and customer ->> 'phone' = '${CAIO.phone}' order by number desc limit 1`);
  if (!row) return null;
  const [id, number, total, state] = row.split('|');
  return { id, number: Number(number), totalCents: Number(total), state };
};

function thread(o) {
  const phone = `2290000${o.n}`;
  return sql(`insert into shopper_threads (tenant_id, channel, address, phone, profile_name, owner, owner_reason, human_until,
      waiting_since, class, stage, last_in_at, updated_at, created_at)
    values ('${tenantId()}', 'whatsapp', '${THREAD_PREFIX}${o.n}@s.whatsapp.net', '${phone}', ${lit(o.name)}, ${lit(o.owner ?? 'agent')},
      ${lit(o.reason ?? null)}, ${o.humanUntil ? ts(o.humanUntil) : 'null'}, ${o.waiting ? ts(o.waiting) : 'null'},
      ${lit(o.cls ?? 'shopper')}, ${lit(o.stage ?? 'browsing')}, ${ts(o.lastIn)}, ${ts(o.updated)}, ${ts(o.created)})
    returning id`).split('\n')[0];
}

function say(threadId, author, body, when, extra = {}) {
  const kind = extra.kind ?? (author === 'core' ? 'card' : 'text');
  const status = extra.status ?? (author === 'shopper' ? 'received' : 'read');
  return sql(`insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, meta, transcript, created_at)
    values ('${tenantId()}', '${threadId}', '${author}', '${kind}', ${lit(body)}, '${status}', ${json(extra.meta ?? {})},
      ${lit(extra.transcript ?? null)}, ${ts(when)}) returning id`).split('\n')[0];
}

/** The store's other conversations this evening, for the inbox (apps/admin/scripts/demo-vendedor.ts). */
function otherThreads() {
  const tid = tenantId();
  sql(`delete from shopper_threads where tenant_id = '${tid}' and address like '${THREAD_PREFIX}%' and address <> '${THREAD_PREFIX}0130@s.whatsapp.net'`);
  const fernanda = caioOrderLike('Fernanda Alves');
  const j = thread({ n: '0101', name: 'Júlia Souza', owner: 'human', reason: 'alergia', waiting: at('17:52'), humanUntil: new Date(Date.now() + 27 * 60_000), lastIn: at('17:51'), updated: at('17:52'), created: at('17:51') });
  say(j, 'shopper', 'oi! o bolo de chocolate leva glúten? minha filha é celíaca', at('17:51'));
  say(j, 'core', 'Vou chamar alguém da loja para te ajudar com isso.', at('17:52'), { kind: 'text' });
  const m = thread({ n: '0102', name: 'Marcos Lima', stage: 'building', lastIn: at('18:03'), updated: at('18:03'), created: at('18:02') });
  say(m, 'shopper', 'boa noite! vcs entregam no Turf Club?', at('18:01'));
  say(m, 'agent', 'Boa noite, Marcos! Entregamos sim no Turf Club: a entrega fica R$ 8,00. O que vai ser hoje?', at('18:02'), { meta: { turnId: 'marcos-1' } });
  say(m, 'shopper', 'tem bolo de milho ainda?', at('18:03'));
  const f = thread({ n: '0103', name: 'Fernanda Alves', stage: 'ordered', lastIn: at('17:31'), updated: at('17:32'), created: at('17:28') });
  say(f, 'shopper', 'oi! queria um bolo de fubá com goiabada e dois cafés, pra retirar', at('17:28'));
  say(f, 'agent', 'Oi, Fernanda! Anotei 1× Bolo de fubá com goiabada e 2× Café coado 300 ml, para retirar. Pix, cartão ou dinheiro?', at('17:29'), { meta: { turnId: 'fernanda-1' } });
  say(f, 'shopper', 'pix', at('17:30'));
  if (fernanda) {
    sql(`update shopper_threads set order_id = '${fernanda.id}' where id = '${f}'`);
    say(f, 'agent', `Pedido #${fernanda.number} feito! A loja já recebeu. Obrigado, Fernanda!`, at('17:32'), { meta: { turnId: 'fernanda-2' } });
  }
  const r = thread({ n: '0104', name: 'Rafael', owner: 'human', reason: 'a loja respondeu', humanUntil: new Date(Date.now() + 18 * 60_000), lastIn: at('17:20'), updated: at('17:25'), created: at('17:20') });
  say(r, 'shopper', 'vocês fazem bolo pra festa de 40 pessoas?', at('17:20'));
  say(r, 'merchant', 'Fazemos sim, Rafael! Me fala a data que eu confirmo.', at('17:25'));
}
const caioOrderLike = (name) => {
  const row = sql(`select id, number from orders where tenant_id = '${tenantId()}' and customer ->> 'name' = ${lit(name)} and placed_at >= ${ts(at('00:00'))} order by number desc limit 1`);
  if (!row) return null;
  const [id, number] = row.split('|');
  return { id, number: Number(number) };
};

// Caio's conversation, one stage per shot. Words follow the Duá demo (site/src/lib/demos/vendedor/
// script.ts) and ADR 0031's opening; cards are Core's own (packages/core/src/vendedor/cards.ts).
const VOICE = 'Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?';
async function caioConversation(stage) {
  const tid = tenantId();
  sql(`delete from shopper_threads where tenant_id = '${tid}' and address = '${THREAD_PREFIX}0130@s.whatsapp.net'`);
  // a rerun after the order exists: until stage 5 the thread is from before it, so the order
  // doesn't count yet for Caio's customer line (stage 5 puts his phone back on it)
  if (stage < 5) sql(`update orders set customer_phone = null where tenant_id = '${tid}' and customer_phone = '${CAIO.phone}'`);
  const t = thread({ n: '0130', name: CAIO.name, stage: stage >= 4 ? 'confirming' : stage >= 3 ? 'building' : 'browsing', lastIn: at('17:58'), updated: at('17:58'), created: at('17:58') });
  const last = { t: new Date(at('17:58').getTime() - 1000) };
  // a second apart at least: the thread orders by the instant, and a tie shuffles the bubbles
  const msg = (author, body, hhmm, extra) => {
    last.t = new Date(Math.max(at(hhmm).getTime(), last.t.getTime() + 1000));
    return say(t, author, body, last.t, extra);
  };
  // 1. the voice note (the clip's own bytes, as the gateway stores media: chat.ts)
  const voice = msg('shopper', null, '17:58', { kind: 'audio', transcript: VOICE });
  const hex = readFileSync(join(PROJECT, 'audio/takes/C01-a.mp3')).toString('hex');
  sql(`insert into shopper_media (tenant_id, message_id, mime, bytes, seconds) values ('${tid}', '${voice}', 'audio/mpeg', decode('${hex}', 'hex'), 4)`);
  if (stage >= 2) {
    msg('agent', 'Oi! Sou o Duá, assistente virtual da Bolos da Nena.', '17:58', { meta: { turnId: 'caio-1' } });
    msg('agent', 'Tem sim! O bolo de cenoura com brigadeiro inteiro sai R$ 45,00.', '17:58', { meta: { turnId: 'caio-1' } });
  }
  if (stage >= 3) {
    msg('agent', 'Quer levar também uma fatia de chocolate para comer hoje? Sai R$ 9,50.', '17:58', { meta: { turnId: 'caio-1' } });
    msg('shopper', 'Quero a fatia também', '17:59');
    msg('agent', 'Anotei a fatia também. É para entregar ou você vem buscar?', '17:59', { meta: { turnId: 'caio-2' } });
    const withDelivery = stage >= 4 ? { mode: 'delivery', ...CAIO_ADDRESS } : undefined;
    const c = await withOpenStore(() => cart([[CAKE, 1], [SLICE, 1]], withDelivery));
    const cartId = sql(`select id from carts where tenant_id = '${tid}' order by created_at desc limit 1`);
    sql(`update shopper_threads set cart_id = '${cartId}' where id = '${t}'`);
    if (stage >= 4) {
      msg('shopper', `Entrega, na ${CAIO_ADDRESS.street}, ${CAIO_ADDRESS.number}, ${CAIO_ADDRESS.neighborhood}`, '18:00');
      msg('agent', 'A entrega aí fica R$ 8,00. Confere o resumo:', '18:00', { meta: { turnId: 'caio-3' } });
      const v = c.cart;
      const d = v.delivery;
      const data = {
        id: 'r-caio',
        lines: v.items.map((i) => ({ text: `${i.qty}× ${i.name}`, totalCents: i.lineTotalCents })),
        subtotalCents: v.totals.subtotalCents,
        feeCents: v.totals.deliveryFeeCents,
        discountCents: v.totals.discountCents,
        discountLabel: null,
        adjustmentCents: v.totals.paymentAdjustmentCents ?? 0,
        totalCents: v.totals.totalCents,
        mode: 'delivery',
        address: [`${d.street}, ${d.number}`, d.complement, d.neighborhood].filter(Boolean).join(' · '),
        eta: d.etaMin != null && d.etaMax != null ? `${d.etaMin}–${d.etaMax} min` : null,
        payment: 'Pix',
        changeForCents: null,
        scheduledFor: null,
        unusual: [],
        test: false,
      };
      const body = [
        '🧾 *Seu pedido* · calculado pela loja',
        ...data.lines.map((l) => `${l.text} — ${brl(l.totalCents)}`),
        `Subtotal — ${brl(data.subtotalCents)}`,
        `Entrega${data.eta ? ` (${data.eta})` : ''} — ${brl(data.feeCents)}`,
        `*Total — ${brl(data.totalCents)}*`,
        `Entrega em: ${data.address}`,
        'Pagamento: Pix',
        'Está tudo certo? Responda *sim* para confirmar.',
      ].join('\n');
      const card = msg('core', body, '18:00', { meta: { card: 'summary', data, turnId: 'caio-3' } });
      sql(`update shopper_threads set checkout = ${json({ payment: { method: 'pix' } })},
             summary = ${json({ id: 'r-caio', hash: 'caio', totalCents: data.totalCents, messageId: card, sentAt: at('18:00').toISOString(), unusual: false })}
           where id = '${t}'`);
      if (Math.abs(data.totalCents - (4500 + 950 + 800)) > 0) throw new Error(`unexpected total ${brl(data.totalCents)}`);
    }
  }
  if (stage >= 5) {
    msg('agent', 'O pagamento é por Pix. Posso fechar?', '18:00', { meta: { turnId: 'caio-3' } });
    msg('shopper', 'Pode fechar', '18:01');
    // the order: the same cart through the real checkout (Core's total), then tied to the thread
    // the way place_order and demo-vendedor.ts tie it
    let o = caioOrder();
    if (!o) {
      const placed = await withOpenStore(async () => {
        const c = await cart([[CAKE, 1], [SLICE, 1]], { mode: 'delivery', ...CAIO_ADDRESS });
        const r = await shop('POST', '/checkout/v1/checkout', { customer: { name: CAIO.name, phone: CAIO.phone }, delivery: { mode: 'delivery', ...CAIO_ADDRESS }, payment: { method: 'pix' } }, c.token);
        return { ...r.order, token: c.token };
      });
      mkdirSync(TMP, { recursive: true });
      execFileSync('sh', ['-c', `cat > ${JSON.stringify(join(TMP, 'caio-order.json'))}`], { input: JSON.stringify({ id: placed.id, token: placed.token }) });
      backdate(placed.id, { placed: at('18:01') });
      o = caioOrder();
      console.log(`Caio's order: #${o.number}, ${brl(o.totalCents)}`);
    }
    sql(`update orders set source = 'whatsapp_agent', thread_id = '${t}', customer_phone = '${CAIO.phone}' where id = '${o.id}';
         update shopper_threads set order_id = '${o.id}', cart_id = null, summary = null, stage = 'ordered' where id = '${t}'`);
    const view = await api('GET', `/orders/${o.id}`);
    const copyPaste = view.order.payment?.pix?.copyPaste;
    if (!copyPaste) throw new Error(`no Pix code on the order: ${JSON.stringify(view.order.payment)}`);
    msg('agent', 'Pedido feito! Aqui está o Pix:', '18:01', { meta: { turnId: 'caio-4' } });
    const pix = { orderNumber: o.number, totalCents: o.totalCents, copyPaste, expiresAt: null, timezone: TZ };
    msg('core', `💠 Pix do pedido #${o.number} · ${brl(o.totalCents)}\nCopie o código abaixo e cole no app do seu banco, em Pix copia e cola.`, '18:01', { kind: 'pix', meta: { card: 'pix', data: pix, turnId: 'caio-4' } });
    msg('core', copyPaste, '18:01', { kind: 'pix', meta: { card: 'pix', data: pix, turnId: 'caio-4' } });
    if (stage === 5 && view.order.payment?.status === 'paid')
      await api('POST', `/orders/${o.id}/payment`, { status: 'pending' });
    if (stage >= 6) {
      msg('shopper', 'Já paguei', '18:03');
      // Nena saw the Pix land and marked it paid (the admin's own button: POST /orders/:id/payment)
      if (view.order.payment?.status !== 'paid') await api('POST', `/orders/${o.id}/payment`, { status: 'paid' });
      sql(`update orders set payment = payment || ${json({ paidAt: at('18:03').toISOString() })} where id = '${o.id}'`);
      msg('agent', 'Pagamento confirmado! Seu pedido já foi para a loja.', '18:03', { meta: { turnId: 'caio-5' } });
    }
  }
  sql(`update shopper_threads set last_in_at = ${ts(last.t)}, last_out_at = ${ts(last.t)}, updated_at = ${ts(last.t)} where id = '${t}'`);
  return t;
}

// ── the admin, as the browser reaches it ─────────────────────────────────────
// The admin's dev server proxies /admin/v1 to Core with its own Host. When Core answers the admin
// API only on its admin host, the browser goes through this in-process proxy instead: the app's
// files from the dev server, the API (streams included) from Core with the admin Host.
let ADMIN_BASE = ADMIN;
async function adminProxy() {
  if (!ADMIN_HOST) return null;
  const dev = new URL(ADMIN);
  const server = http.createServer((req, res) => {
    const api = /^\/(admin\/v1|analytics\/v1|v1)(\/|\?|$)/.test(req.url);
    const to = api ? CORE : dev;
    const p = http.request(
      {
        host: to.hostname,
        port: to.port,
        path: req.url,
        method: req.method,
        // same-host Origin, as the dev server's own proxy gives Core (admin/auth.ts adminGate)
        headers: {
          ...req.headers,
          host: api ? ADMIN_HOST : dev.host,
          ...(api && req.headers.origin ? { origin: `http://${ADMIN_HOST}` } : {}),
        },
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    p.on('error', () => res.destroy());
    res.on('close', () => p.destroy());
    req.pipe(p);
  });
  // the dev server's hot-reload socket
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(Number(dev.port), dev.hostname, () => {
      const lines = Object.entries({ ...req.headers, host: dev.host }).map(([k, v]) => `${k}: ${v}`);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ADMIN_BASE = `http://localhost:${server.address().port}${dev.pathname}`;
  return server;
}

// ── the browser ──────────────────────────────────────────────────────────────
let browser;
async function webp(page, name) {
  mkdirSync(TMP, { recursive: true });
  const png = join(TMP, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '90', join(OUT, `${name}.webp`)]);
  rmSync(png);
  console.log('shot', name);
}

const PHONE_VP = { width: 375, height: 812 };
const TABLET_VP = { width: 1280, height: 800 };

async function adminPage(clock, { viewport = PHONE_VP, mobile = true, prefs = {} } = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    storageState: AUTH,
    locale: 'pt-BR',
    timezoneId: TZ,
  });
  // one-time teaching hints stay dismissed (site/scripts/assets.ts); screen prefs as a user set them
  await ctx.addInitScript((prefs) => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      return k.startsWith('vendua-hint:') ? '1' : get.call(this, k);
    };
    for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
  }, prefs);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(clock);
  return page;
}

async function open(page, route) {
  await page.goto(new URL(route.replace(/^\//, ''), ADMIN_BASE).href);
  await page.waitForSelector('main, #root > *', { timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const toBottom = async (page) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
};

// ── phases ───────────────────────────────────────────────────────────────────
/**
 * Scrolls a phone thread to its newest message, then back by the few pixels the floor leaves free
 * if that keeps a bubble from showing a sliver under the pinned bars.
 */
async function newest(page) {
  await page.evaluate(() => {
    const fig = document.querySelector('figure[aria-label^="áudio"]');
    const box = fig?.parentElement;
    const vh = innerHeight;
    const sMax = Math.max(0, document.documentElement.scrollHeight - vh);
    window.scrollTo(0, sMax);
    if (!box) return;
    let top = 0;
    let bottom = vh;
    for (const e of document.querySelectorAll('header, div, nav')) {
      const pos = getComputedStyle(e).position;
      if (pos !== 'sticky' && pos !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      if (r.height === 0 || r.bottom <= 0 || r.top >= vh) continue;
      if (r.top < vh / 2) top = Math.max(top, r.bottom);
      else bottom = Math.min(bottom, r.top);
    }
    const units = [...box.children].map((e) => {
      const r = e.getBoundingClientRect();
      return [r.top + scrollY, r.bottom + scrollY];
    });
    const last = units.at(-1);
    const sMin = Math.max(0, Math.ceil(last[1] - bottom + 2));
    let best = sMax;
    let bestCut = Infinity;
    for (let s = sMax; s >= sMin; s--) {
      const line = s + top;
      let cut = 0;
      for (const [a, b] of units) if (a < line && b > line) cut = Math.max(cut, b - line);
      if (cut < bestCut) [best, bestCut] = [s, cut];
      if (cut === 0) break;
    }
    window.scrollTo(0, best);
  });
  await page.waitForTimeout(500);
}

async function conversa() {
  otherThreads();
  const stages = [
    ['duá-conversa-1-audio', '17:58'],
    ['duá-conversa-2-preco', '17:58'],
    ['duá-conversa-3-adicional', '17:59'],
    ['duá-conversa-4-resumo', '18:00'],
    ['duá-conversa-5-pix', '18:01'],
    ['duá-conversa-5b-pago', '18:03'],
  ];
  for (const [i, [name, clock]] of stages.entries()) {
    const t = await caioConversation(i + 1);
    await withOpenStore(async () => {
      const page = await adminPage(at(clock));
      await open(page, `/vendedor/conversas/${t}`);
      await newest(page);
      await webp(page, name);
      if (i === stages.length - 1) {
        // the floor: who answers now, with "assumir", seen from the top of the thread
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        await webp(page, 'duá-conversa-6-assumir');
        const list = await adminPage(at(clock));
        await open(list, '/vendedor/conversas');
        await webp(list, 'duá-conversas-lista');
        await list.context().close();
        // Nena takes the conversation over
        await page.getByRole('button', { name: /assumir/i }).first().click();
        await page.waitForTimeout(3000);
        await newest(page);
        await webp(page, 'duá-conversa-7-assumido');
      }
      await page.context().close();
    });
  }
}

async function pedidos() {
  const o = caioOrder();
  if (!o) throw new Error('no order for Caio: run the conversa phase first');
  const tid = tenantId();
  await withOpenStore(async () => {
    if (o.state === 'placed') {
      const detail = await adminPage(at('18:04'));
      await open(detail, `/pedidos/${o.id}`);
      await webp(detail, 'pedido-30');
      // further down the same order: the customer, the delivery and how it was paid
      await detail.evaluate(() => {
        const el = [...document.querySelectorAll('main *')].find((e) => e.childElementCount === 0 && /primeiro pedido|pedidos?$/.test(e.textContent ?? '') && e.closest('a, div'));
        const card = el?.closest('[class*="rounded"]') ?? el;
        if (card) window.scrollBy(0, card.getBoundingClientRect().top - 160);
      });
      await detail.waitForTimeout(500);
      await webp(detail, 'pedido-30-entrega');
      await detail.context().close();
      const page = await adminPage(at('18:04'));
      await open(page, '/pedidos');
      await webp(page, 'pedidos-novo-30');
      // Nena accepts it with the preselected prep time, on the board
      const card = page.locator('article, li, section, div').filter({ hasText: '#30' }).filter({ has: page.getByRole('button', { name: /aceitar/i }) }).last();
      await card.getByRole('button', { name: /aceitar/i }).first().click();
      await page.waitForTimeout(1200);
      await webp(page, 'pedido-30-aceitar');
      await page.context().close();
      backdate(o.id, { confirmed: at('18:05') });
      // Luiz's (#29) too, a minute later: both are in the kitchen when it's shot
      const luiz = caioOrderLike('Luiz Fernando');
      const st = sql(`select state from orders where id = '${luiz.id}'`);
      if (st === 'placed') {
        await api('POST', `/orders/${luiz.id}/payment`, { status: 'paid' });
        await api('POST', `/orders/${luiz.id}/transition`, { to: 'confirmed', prepMinutes: 30 });
        backdate(luiz.id, { confirmed: at('18:06') });
        sql(`update orders set payment = payment || ${json({ paidAt: at('18:02').toISOString() })} where id = '${luiz.id}'`);
      }
      // the counter's printer printed both tickets (the agent's report: jobs.ts recordJobResultTx)
      sql(`update print_jobs set status = 'done', attempts = 1, sent_at = created_at + interval '2 seconds', finished_at = created_at + interval '4 seconds'
           where tenant_id = '${tid}' and status in ('pending', 'sent');
           update printers set last_ok_at = (select max(finished_at) from print_jobs j where j.printer_id = printers.id), last_error = null, last_error_at = null
           where tenant_id = '${tid}'`);
    }
  });
}

async function impressoras() {
  const tid = tenantId();
  // the agent's stream is open and beat just now (devices.ts: online within 70 s)
  sql(`update print_devices set connected_at = coalesce(connected_at, now()), disconnected_at = null, last_seen_at = now() where tenant_id = '${tid}'`);
  await withOpenStore(async () => {
    const page = await adminPage(at('18:07'));
    await open(page, '/impressoras');
    await webp(page, 'impressoras');
    await page.screenshot({ path: join(TMP, 'impressoras-full.png'), fullPage: true });
    await page.context().close();
  });
}

const sec = (hhmm, s) => new Date(at(hhmm).getTime() + s * 1000);

/** The kitchen display (tablet, landscape) and the pickup board, as Caio's order is made. */
async function cozinha() {
  const o = caioOrder();
  if (!o || o.state === 'placed') throw new Error("Caio's order isn't accepted: run the pedidos phase first");
  const tid = tenantId();
  const ticket = (page, n) =>
    page.locator('article, section, li, div').filter({ hasText: `#${n}` }).filter({ has: page.getByRole('button', { name: /pronto|começar/i }) }).last();
  await withOpenStore(async () => {
    const page = await adminPage(sec('18:19', 37), { viewport: TABLET_VP, mobile: false });
    await open(page, '/cozinha');
    if (o.state === 'confirmed') {
      await webp(page, 'cozinha');
      // the cake is done: the first tick starts the order (em preparo)
      await ticket(page, o.number).getByText(CAKE).first().click();
      await page.waitForTimeout(1500);
      backdate(o.id, { preparing: at('18:11') });
      sql(`update kitchen_marks set done_at = ${ts(at('18:18'))} where tenant_id = '${tid}' and order_id = '${o.id}'`);
      await open(page, '/cozinha');
      await webp(page, 'cozinha-itens');
    }
    if (caioOrder().state === 'preparing') {
      // the customers' board is up before the order turns ready, so it calls the number
      const board = await adminPage(sec('18:21', 12), { viewport: TABLET_VP, mobile: false, prefs: { 'vendua-painel-entregas': 'true' } });
      await open(board, '/cozinha/painel');
      await page.clock.setFixedTime(sec('18:21', 8));
      await page.waitForTimeout(800);
      const t = ticket(page, o.number);
      const slice = t.getByText(SLICE).first();
      await slice.click();
      await page.waitForTimeout(1200);
      await t.getByRole('button', { name: /^pronto/i }).first().click();
      await page.waitForTimeout(500);
      await webp(page, 'cozinha-pronto');
      // the held "pronto" goes out after its undo window (data.ts UNDO_MS) and the board calls it
      await page.waitForTimeout(5500);
      await board.waitForTimeout(2500);
      await webp(board, 'painel-chamada');
      await board.waitForTimeout(8000);
      backdate(o.id, { ready: at('18:21') });
      sql(`update kitchen_marks set done_at = ${ts(sec('18:21', 4))} where tenant_id = '${tid}' and order_id = '${o.id}' and done_at > ${ts(at('18:19'))}`);
      await board.context().close();
    }
    await page.context().close();
    const board = await adminPage(sec('18:22', 5), { viewport: TABLET_VP, mobile: false, prefs: { 'vendua-painel-entregas': 'true' } });
    await open(board, '/cozinha/painel');
    // the board asks for a first tap to turn its calls' sound on; the tap answers it
    const hint = board.getByText(/ligar o som/i).first();
    if (await hint.isVisible().catch(() => false)) await hint.click();
    await board.waitForTimeout(800);
    await webp(board, 'painel');
    await board.context().close();
    // the kitchen on a phone: Caio's order among the ready ones
    const phone = await adminPage(sec('18:22', 5));
    await open(phone, '/cozinha');
    await phone.getByText(/^Prontos$/).first().click();
    await phone.waitForTimeout(800);
    await webp(phone, 'cozinha-phone');
    await phone.context().close();
  });
}

/** Caio's side: the storefront's order page, opened with the checkout's own order token. */
async function vitrine() {
  const placed = JSON.parse(readFileSync(join(TMP, 'caio-order.json'), 'utf8'));
  const ctx = await browser.newContext({
    viewport: PHONE_VP,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'pt-BR',
    timezoneId: TZ,
  });
  // the Kernel keeps the token of an order this browser placed in sessionStorage (api.ts)
  await ctx.addInitScript((o) => {
    sessionStorage.setItem('vendua.orderTokens', JSON.stringify({ [o.id]: o.token }));
  }, placed);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(sec('18:22', 30));
  await withOpenStore(async () => {
    await page.goto(`${STORE}/pedido/${placed.id}`, { waitUntil: 'networkidle', timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await webp(page, 'vitrine-pedido-pronto');
    await page.screenshot({ path: join(TMP, 'vitrine-full.png'), fullPage: true });
  });
  await ctx.close();
}

async function main() {
  const phases = process.argv.slice(2);
  const all = ['seed', 'conversa', 'pedidos', 'impressoras', 'cozinha', 'vitrine'];
  const run = phases.length ? phases : all;
  for (const p of run) if (!all.includes(p)) throw new Error(`unknown phase ${p}`);
  mkdirSync(OUT, { recursive: true });
  console.log(`shoot day ${DAY}`);
  if (run.includes('seed')) await seed();
  else await signIn();
  const proxy = await adminProxy();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--disable-gpu', '--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  });
  try {
    if (run.includes('conversa')) await conversa();
    if (run.includes('pedidos')) await pedidos();
    if (run.includes('impressoras')) await impressoras();
    if (run.includes('cozinha')) await cozinha();
    if (run.includes('vitrine')) await vitrine();
  } finally {
    await browser.close();
    proxy?.close();
    proxy?.closeAllConnections?.();
  }
}

await main();
