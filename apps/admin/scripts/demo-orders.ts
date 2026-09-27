// Fills a dev store with a month of orders so the admin has something to show:
// orders go through the real checkout API (totals are Core's), then get spread
// over the last 30 days and walked through states. A few stay live on the board.
//   bun scripts/demo-orders.ts [count=60]
// Env: CORE (http://localhost:8787), HOST (quero-pudim.localhost), DATABASE_URL (owner, dev only)
import postgres from 'postgres';

const CORE = process.env.CORE ?? 'http://localhost:8787';
const HOST = process.env.HOST ?? 'quero-pudim.localhost';
const N = Number(process.argv[2] ?? 60);
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua', {
  onnotice: () => {},
});

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: {
      host: HOST,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const PEOPLE = [
  ['Ana Paula Ribeiro', '22998761234'],
  ['Joana Lima', '22988887777'],
  ['Carlos Eduardo', '22991112222'],
  ['Mariana Souza', '22997773333'],
  ['Pedro Henrique', '21996664444'],
  ['Beatriz Costa', '22995556666'],
  ['Luiz Fernando', '22994447777'],
  ['Fernanda Alves', '22993338888'],
  ['Rafael Martins', '22992229999'],
  ['Juliana Rocha', '22990001111'],
  ['Tiago Nunes', '22981234567'],
  ['Camila Duarte', '22987654321'],
];
const NOTES = [
  null,
  null,
  null,
  'Sem granulado, por favor',
  'Tocar o interfone 12',
  'É presente! Caprichem no laço 💝',
  null,
];

const catalog = (await call('GET', '/storefront/v1/catalog')).body.categories as {
  products: any[];
}[];
const products = catalog
  .flatMap((c) => c.products)
  .filter(
    (p) =>
      p.status === 'active' &&
      !p.requiresPreorder &&
      p.kind === 'simple' &&
      (p.stockQuantity === null || p.stockQuantity > 5),
  );
const zones = (await call('GET', '/storefront/v1/zones')).body.zones as {
  neighborhoods: string[];
}[];
const store = (await call('GET', '/storefront/v1/store')).body;
if (store.status === 'paused') throw new Error('store is paused — resume it in the admin first');
const tenant = (
  await sql<
    { id: string }[]
  >`select t.id from tenants t join domains d on d.tenant_id = t.id where d.host = ${HOST}`
)[0]!.id;
// make sure checkout is open for the seeding run
const hours = (await sql`select hours from store_settings where tenant_id = ${tenant}`)[0]!.hours;
await sql`update store_settings set hours = ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })}, status_override = null where tenant_id = ${tenant}`;

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
let placed = 0;
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const s = await call('POST', '/checkout/v1/session');
  const token = s.body.sessionToken as string;
  const lines = 1 + Math.floor(Math.random() * 3);
  for (let l = 0; l < lines; l++) {
    const p = pick(products);
    const detail = (await call('GET', `/storefront/v1/products/${p.slug}`)).body.product;
    const modifierIds = (detail.modifierGroups as any[]).flatMap((g) =>
      g.minSelect > 0 ? g.modifiers.slice(0, g.minSelect).map((m: any) => m.id) : [],
    );
    await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: p.id, qty: 1 + Math.floor(Math.random() * 2), modifierIds },
      token,
    );
  }
  const [name, phone] = pick(PEOPLE);
  const delivery = Math.random() < 0.6 && zones.length && store.deliveryEnabled;
  const r = await call(
    'POST',
    '/checkout/v1/checkout',
    {
      customer: { name, phone },
      delivery: delivery
        ? {
            mode: 'delivery',
            neighborhood: pick(zones).neighborhoods[0] ?? 'Centro',
            street: 'Rua das Flores',
            number: String(10 + i),
          }
        : { mode: 'pickup' },
      payment: { method: pick(['pix', 'pix', 'card_on_delivery', 'cash']) },
      ...(pick(NOTES) ? { notes: pick(NOTES) } : {}),
    },
    token,
  );
  if (r.status === 201) {
    placed++;
    ids.push(r.body.order.id);
  } else console.log('checkout failed', r.status, r.body.error?.code);
}

// spread over 30 days, busier at lunch and evening; walk the old ones to a final state
const live = ids.slice(-5);
for (const id of ids.slice(0, -5)) {
  const days = Math.floor(Math.random() * 30);
  const hour = pick([11, 12, 12, 13, 15, 18, 19, 19, 20, 21]);
  await sql`
    update orders set
      placed_at = date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
                  - make_interval(days => ${days}) + make_interval(hours => ${hour}, mins => ${Math.floor(Math.random() * 60)}),
      state = ${Math.random() < 0.08 ? 'cancelled' : 'delivered'},
      payment = payment || '{"status":"paid"}'
    where id = ${id}
  `;
  await sql`update orders set updated_at = placed_at + interval '50 minutes' where id = ${id}`;
  await sql`
    insert into order_events (tenant_id, order_id, from_state, to_state, actor, at, meta)
    select tenant_id, id, 'placed', state, 'merchant', updated_at, '{}' from orders where id = ${id}
  `;
}
// the live ones: a new one, one accepted, one preparing, one ready
const states = ['placed', 'placed', 'confirmed', 'preparing', 'ready'];
for (const [k, id] of live.entries()) {
  if (states[k] === 'placed') continue;
  await sql`update orders set state = ${states[k]!}, updated_at = now() where id = ${id}`;
  await sql`insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta) values (${tenant}, ${id}, 'placed', ${states[k]!}, 'merchant', '{}')`;
}
// funnel events for Relatórios
await sql`
  insert into analytics_events (tenant_id, name, at, session_id, props)
  select ${tenant}, n, now() - make_interval(days => (random() * 29)::int, hours => (random() * 12)::int), 's' || g, '{}'
  from generate_series(1, 900) g,
       lateral (select case when g % 10 < 10 then 'page_view' end as n
                union all select 'product_view' where g % 10 < 6
                union all select 'add_to_cart' where g % 10 < 3
                union all select 'checkout_start' where g % 10 < 2) x
  where n is not null
`;
await sql`update store_settings set hours = ${sql.json(hours)} where tenant_id = ${tenant}`;
console.log(`placed ${placed} orders (${live.length} live on the board)`);
await sql.end();
