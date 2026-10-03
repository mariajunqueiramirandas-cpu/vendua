// Fills the dev store with Vendedor data so its screens have something to show (ADR 0031):
// conversations in each state (selling, waiting for you, an order closed, Ensaio drafts, a
// supplier under "outros"), knowledge, suggestions, demand and a Cliente oculto run. Run after
// `bun scripts/demo-orders.ts`; it re-creates its own rows each time.
//   bun scripts/demo-vendedor.ts
// Env: DATABASE_URL (owner, dev only), STORE (quero-pudim)
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua', {
  onnotice: () => {},
});
const slug = process.env.STORE ?? 'quero-pudim';
const [tenant] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
if (!tenant) throw new Error(`no store ${slug}`);
const tid = tenant.id;

const ago = (min: number) => new Date(Date.now() - min * 60_000);
const json = (v: unknown) => sql.json(v as never);

await sql`delete from shopper_threads where tenant_id = ${tid} and address like '5521900%'`;
await sql`delete from store_knowledge where tenant_id = ${tid}`;
await sql`delete from vendedor_demand where tenant_id = ${tid}`;
await sql`delete from vendedor_runs where tenant_id = ${tid}`;
await sql`delete from suggestion_events where tenant_id = ${tid}`;

await sql`
  insert into store_agent (tenant_id, enabled, settings, onboarding, enabled_at, first_sale_at)
  values (${tid}, true, ${json({ coverage: 'when_slow', slowAfterMin: 2 })},
          ${json({ started: true, finished: true, part: 'comecar', interviewDone: true })}, ${ago(60 * 24 * 6)}, ${ago(60 * 24 * 5)})
  on conflict (tenant_id) do update set enabled = true, settings = excluded.settings,
    onboarding = excluded.onboarding, enabled_at = excluded.enabled_at, first_sale_at = excluded.first_sale_at`;
await sql`
  insert into store_whatsapp (tenant_id, wanted, state, phone, connected_at)
  values (${tid}, true, 'open', '22999999999', now())
  on conflict (tenant_id) do update set wanted = true, state = 'open'`;

const products = await sql<{ id: string; name: string; base_price_cents: number }[]>`
  select id, name, base_price_cents from products where tenant_id = ${tid} and status = 'active' order by sort, name limit 8`;
const p = (i: number) => products[i % products.length]!;
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

async function thread(o: {
  n: number;
  name: string;
  owner?: string;
  reason?: string | null;
  waitingMin?: number | null;
  stage?: string;
  cls?: string;
  humanMin?: number;
}) {
  const phone = `219000${String(o.n).padStart(5, '0')}`;
  const [t] = await sql<{ id: string }[]>`
    insert into shopper_threads (tenant_id, channel, address, phone, profile_name, owner, owner_reason, human_until,
      waiting_since, class, stage, last_in_at, updated_at)
    values (${tid}, 'whatsapp', ${`55${phone}@s.whatsapp.net`}, ${phone}, ${o.name}, ${o.owner ?? 'agent'},
      ${o.reason ?? null}, ${o.humanMin ? new Date(Date.now() + o.humanMin * 60_000) : null},
      ${o.waitingMin != null ? ago(o.waitingMin) : null}, ${o.cls ?? 'shopper'}, ${o.stage ?? 'browsing'}, now(), now())
    returning id`;
  return { id: t!.id, phone };
}

async function say(
  threadId: string,
  author: string,
  body: string,
  min: number,
  extra: Record<string, unknown> = {},
) {
  const [m] = await sql<{ id: string }[]>`
    insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, meta, transcript, created_at)
    values (${tid}, ${threadId}, ${author}, ${String(extra.kind ?? (author === 'core' ? 'card' : 'text'))}, ${body},
      ${String(extra.status ?? (author === 'shopper' ? 'received' : 'read'))}, ${json(extra.meta ?? {})},
      ${(extra.transcript as string | undefined) ?? null}, ${ago(min)})
    returning id`;
  return m!.id;
}

// 1. selling right now
const a = await thread({ n: 1, name: 'Marcos Lima', stage: 'building' });
await say(a.id, 'shopper', 'boa noite! vcs entregam no centro?', 9);
await say(
  a.id,
  'agent',
  `Boa noite, Marcos! Entregamos sim no Centro: taxa de ${brl(700)} e chega em 40–50 min. O que vai ser hoje?`,
  9,
);
await say(a.id, 'shopper', `quero 2 ${p(0).name.toLowerCase()} e 1 ${p(1).name.toLowerCase()}`, 7);
await say(
  a.id,
  'agent',
  `Anotei: 2× ${p(0).name} e 1× ${p(1).name}. Quer levar um ${p(2).name} junto? Quem pede esses costuma levar.`,
  7,
  { meta: { turnId: 'demo-sugg' } },
);
await say(a.id, 'shopper', 'pode ser', 6, {
  kind: 'audio',
  transcript: 'pode ser, manda um também',
  meta: { seconds: 4 },
});

// 2. waiting for you (allergy)
const b = await thread({
  n: 2,
  name: 'Júlia Souza',
  owner: 'human',
  reason: 'alergia',
  waitingMin: 3,
  humanMin: 27,
});
await say(b.id, 'shopper', 'oi! o pudim de coco tem lactose? meu filho é alérgico', 4);
await say(b.id, 'core', 'Vou chamar alguém da loja para te ajudar com isso.', 4, { kind: 'text' });

// 3. order closed by Ana
const c = await thread({ n: 3, name: 'Carla Mendes', stage: 'ordered' });
const [order] = await sql<{ id: string; number: number; total_cents: number }[]>`
  select id, number, total_cents from orders where tenant_id = ${tid} and state in ('placed', 'confirmed', 'preparing')
  order by placed_at desc limit 1`;
await say(c.id, 'shopper', `oi, queria fazer um pedido: 1 ${p(3).name}, pra retirar`, 30);
await say(
  c.id,
  'agent',
  `Oi, Carla! Anotei 1× ${p(3).name} para retirar. Pix, cartão ou dinheiro?`,
  30,
);
await say(c.id, 'shopper', 'pix', 28);
await say(
  c.id,
  'core',
  `🧾 *Seu pedido* · calculado pela loja\n1× ${p(3).name} — ${brl(p(3).base_price_cents)}\n*Total — ${brl(p(3).base_price_cents)}*`,
  28,
  {
    meta: {
      card: 'summary',
      data: {
        id: 'r-demo',
        lines: [{ text: `1× ${p(3).name}`, totalCents: p(3).base_price_cents }],
        subtotalCents: p(3).base_price_cents,
        feeCents: 0,
        discountCents: 0,
        discountLabel: null,
        adjustmentCents: 0,
        totalCents: p(3).base_price_cents,
        mode: 'pickup',
        address: null,
        eta: null,
        payment: 'Pix',
        changeForCents: null,
        scheduledFor: null,
        unusual: [],
        test: false,
      },
    },
  },
);
await say(c.id, 'agent', 'Está tudo certo? Posso confirmar?', 28);
await say(c.id, 'shopper', 'sim', 27);
if (order) {
  await sql`update orders set source = 'whatsapp_agent', thread_id = ${c.id}, customer_phone = ${c.phone} where id = ${order.id}`;
  await sql`update shopper_threads set order_id = ${order.id} where id = ${c.id}`;
  await say(
    c.id,
    'agent',
    `Pedido #${order.number} feito! A loja já recebeu. Obrigada, Carla!`,
    27,
  );
}
const more = await sql<{ id: string }[]>`
  select id from orders where tenant_id = ${tid} and source = 'storefront' and placed_at > now() - interval '7 days'
  order by placed_at desc offset 1 limit 6`;
for (const o of more) await sql`update orders set source = 'whatsapp_agent' where id = ${o.id}`;

// 4. taken over from the phone
const d = await thread({
  n: 4,
  name: 'Rafael',
  owner: 'human',
  reason: 'a loja respondeu',
  humanMin: 18,
});
await say(d.id, 'shopper', 'vocês fazem pudim pra festa de 40 pessoas?', 20);
await say(d.id, 'merchant', 'Fazemos sim, Rafael! Me fala a data que eu confirmo.', 15);

// 5. outros
const e = await thread({ n: 5, name: 'Distribuidora Leite Bom', owner: 'open', cls: 'other' });
await say(e.id, 'shopper', 'Bom dia, segue o boleto da entrega de ontem', 120);

// Ensaio drafts against what the store said
const f = await thread({ n: 6, name: 'Beatriz', owner: 'human', humanMin: 5 });
await say(f.id, 'shopper', 'até que horas vocês ficam abertos hoje?', 200);
await say(f.id, 'agent', 'Hoje ficamos abertos até as 22h!', 199, { status: 'draft' });
await say(f.id, 'merchant', 'Oi Bia, hoje até as 22h!', 198);
await say(f.id, 'shopper', 'tem desconto pra retirada?', 190);
await say(f.id, 'agent', 'Não temos desconto para retirada, mas fica pronto em 30 min.', 189, {
  status: 'draft',
});
await say(f.id, 'merchant', 'Pra retirada eu faço 5% no Pix!', 188);

await sql`insert into store_knowledge (tenant_id, kind, status, source, question, answer, asked_count, used_count, last_asked_at) values
  (${tid}, 'question', 'open', 'unanswered', 'Vocês têm opção vegana?', null, 4, 0, now()),
  (${tid}, 'question', 'open', 'unanswered', 'Aceitam encomenda para casamento?', null, 2, 0, now()),
  (${tid}, 'answer', 'proposed', 'learned', 'Vocês fazem pudim pra festa?', 'Fazemos sim! Encomendas com 2 dias de antecedência.', 0, 0, null),
  (${tid}, 'answer', 'live', 'merchant', 'Tem estacionamento?', 'Temos 3 vagas na frente da loja.', 0, 9, null),
  (${tid}, 'answer', 'live', 'interview', 'Os pudins levam leite condensado?', 'Sim, todos levam leite condensado.', 0, 3, null)`;
await sql`insert into store_knowledge (tenant_id, kind, status, source, answer, guard) values
  (${tid}, 'rule', 'live', 'merchant', 'Não aceite dinheiro acima de R$ 200', ${json({ kind: 'cash_max', cents: 20000 })}),
  (${tid}, 'rule', 'live', 'interview', 'Nunca prometa entrega antes das 18h', null)`;

for (let i = 0; i < 6; i++)
  await sql`insert into suggestion_events (tenant_id, thread_id, product_id, source, reason, price_cents, outcome, created_at)
    values (${tid}, ${a.id}, ${p(2).id}, 'basket', 'pedido junto em 31% dos pedidos', ${p(2).base_price_cents},
      ${i < 2 ? 'taken' : 'offered'}, ${ago(60 * i)})`;
for (const [kind, term, n] of [
  ['unmet', 'acai', 4],
  ['unmet', 'torta de limao', 2],
  ['out_of_zone', 'jardim america', 3],
] as const)
  for (let i = 0; i < n; i++)
    await sql`insert into vendedor_demand (tenant_id, kind, term) values (${tid}, ${kind}, ${term})`;

const results = Array.from({ length: 20 }, (_, i) => ({
  name:
    i === 7
      ? `1× ${p(1).name} · entrega`
      : `${i % 3 === 0 ? 2 : 1}× ${p(i).name} · ${i % 2 ? 'entrega' : 'retirada'}`,
  check:
    i === 18
      ? 'chamou você quando pediram'
      : i === 19
        ? 'fora da área, explicou com calma'
        : 'pedido certo',
  passed: i !== 7,
  why:
    i === 7
      ? `itens: esperado 1×${p(1).name.toLowerCase()}[broto]; fechou 1×${p(1).name.toLowerCase()}[p]`
      : 'pedido igual ao escondido',
  turns: 4 + (i % 4),
  threadId: a.id,
}));
await sql`insert into vendedor_runs (tenant_id, trigger, status, results, passed, total, started_at, finished_at, created_at)
  values (${tid}, 'menu_change', 'done', ${json(results)}, 19, 20, ${ago(600)}, ${ago(590)}, ${ago(600)})`;

console.log('vendedor demo data in place');
await sql.end();
