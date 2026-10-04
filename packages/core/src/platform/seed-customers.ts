// Fills the dev stores with a customer fleet to judge the CRM's Visão, Lojas and IA: plans and
// subscriptions in every state (active, a trial ending in 3 days, past due, cancelled), 30 days of
// orders, Duá's conversations, a paid pack, model costs over two providers, a store WhatsApp in
// error and a print agent.
//   bun run seed:customers     (after seed:fleet; no Core needed)
// Env: DATABASE_URL (postgres://vendua:vendua@localhost:5433/vendua).
// Re-runnable: it replaces what it wrote before (rows marked `seed-customers`), dated from now.
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua', {
  onnotice: () => {},
});
const MARK = 'seed-customers';
const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);

interface Plan {
  slug: string;
  plan: 'mirim' | 'bandeira' | 'pangolim';
  sub: 'active' | 'trialing' | 'past_due' | 'cancelled';
  /** days since signup */
  age: number;
  /** orders a day, roughly */
  perDay: number;
  /** no order in the last n days */
  quietDays?: number;
  adminSeenDaysAgo: number | null;
  /** Duá's conversations this month (trial: over the trial) and model calls a day */
  ai?: { conversations: number; callsPerDay: number };
}

const PLANS: Plan[] = [
  {
    slug: 'cantina-da-nona',
    plan: 'mirim',
    sub: 'active',
    age: 75,
    perDay: 6,
    adminSeenDaysAgo: 2,
  },
  {
    slug: 'acai-do-porto',
    plan: 'bandeira',
    sub: 'active',
    age: 50,
    perDay: 14,
    adminSeenDaysAgo: 0.05,
    ai: { conversations: 238, callsPerDay: 40 },
  },
  {
    slug: 'brigadeiros-bia',
    plan: 'pangolim',
    sub: 'past_due',
    age: 90,
    perDay: 3,
    adminSeenDaysAgo: 20,
    ai: { conversations: 41, callsPerDay: 8 },
  },
  {
    slug: 'marmitas-fit-sp',
    plan: 'mirim',
    sub: 'cancelled',
    age: 120,
    perDay: 2,
    quietDays: 19,
    adminSeenDaysAgo: null,
  },
  {
    slug: 'padaria-sao-jorge',
    plan: 'bandeira',
    sub: 'trialing',
    age: 11,
    perDay: 5,
    adminSeenDaysAgo: 0.15,
    ai: { conversations: 50, callsPerDay: 12 },
  },
];

const PRICES = { mirim: 6990, bandeira: 16900, pangolim: 44900 } as const;
const NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elisa',
  'Fábio',
  'Gabi',
  'Heitor',
  'Iara',
  'João',
];

// deterministic, so a re-run draws the same fleet (shifted to today)
let state = 42;
const rand = () => (state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;

const tenants = await db<{ id: string; slug: string }[]>`
  select id, slug from tenants where slug in ${db(PLANS.map((p) => p.slug))}
`;
const idOf = new Map(tenants.map((t) => [t.slug, t.id]));
const missing = PLANS.filter((p) => !idOf.has(p.slug)).map((p) => p.slug);
if (missing.length) {
  console.error(`missing dev stores: ${missing.join(', ')} — run seed:fleet first`);
  process.exit(1);
}

await db.begin(async (tx) => {
  const ids = [...idOf.values()];
  // what an earlier run wrote
  await tx`
    delete from orders where tenant_id in ${tx(ids)}
      and cart_id in (select id from carts where session_hash like ${MARK + '-%'})
  `;
  await tx`delete from carts where tenant_id in ${tx(ids)} and session_hash like ${MARK + '-%'}`;
  await tx`delete from ai_conversations where tenant_id in ${tx(ids)} and subject_key like ${MARK + ':%'}`;
  await tx`delete from invoices where tenant_id in ${tx(ids)} and number >= 9001`;
  await tx`delete from agent_actors where tenant_id in ${tx(ids)} and subject_id = ${MARK}`;
  await tx`delete from print_devices where tenant_id in ${tx(ids)} and name like '%(seed)'`;

  for (const p of PLANS) {
    const id = idOf.get(p.slug)!;
    const created = ago(p.age);
    await tx`update tenants set plan = ${p.plan}, created_at = ${created} where id = ${id}`;
    const trialEnd = p.sub === 'trialing' ? ago(-3) : null;
    const periodStart = p.sub === 'trialing' ? created : ago(p.age % 30);
    const periodEnd = trialEnd ?? new Date(periodStart.getTime() + 30 * DAY);
    await tx`
      insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                                 current_period_start, current_period_end, trial_ends_at,
                                 created_at, status_changed_at)
      values (${id}, ${p.plan}, 'pix', ${p.sub}, 'fake', ${`${p.slug}@example.com`},
              ${periodStart}, ${periodEnd}, ${trialEnd}, ${created},
              ${p.sub === 'cancelled' ? ago(9) : p.sub === 'past_due' ? ago(6) : created})
      on conflict (tenant_id) do update set
        plan_id = excluded.plan_id, method = excluded.method, status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end, trial_ends_at = excluded.trial_ends_at,
        created_at = excluded.created_at, status_changed_at = excluded.status_changed_at,
        pending_plan_id = null, upgrade_plan_id = null, upgrade_invoice_id = null,
        cancel_at_period_end = false, updated_at = now()
    `;
    await tx`
      update store_settings set billing_hold = ${p.sub === 'cancelled'} where tenant_id = ${id}
    `;
    await tx`
      update merchant_users set last_seen_at = ${
        p.adminSeenDaysAgo === null ? null : ago(p.adminSeenDaysAgo)
      }
      where tenant_id = ${id}
    `;

    // the plan's invoices: paid months, and what is owed or voided
    const price = PRICES[p.plan];
    const invoice = (n: number, start: Date, status: string, paid: boolean) => tx`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                            method, status, provider, due_at, paid_at, created_at)
      values (${id}, ${n}, ${p.plan}, ${price}, ${start}, ${new Date(start.getTime() + 30 * DAY)},
              'pix', ${status}, 'fake', ${start}, ${paid ? start : null}, ${start})
    `;
    if (p.sub === 'active') {
      await invoice(9001, ago((p.age % 30) + 30), 'paid', true);
      await invoice(9002, periodStart, 'paid', true);
    } else if (p.sub === 'past_due') {
      await invoice(9001, ago(36), 'paid', true);
      await invoice(9002, ago(6), 'open', false);
    } else if (p.sub === 'cancelled') {
      await invoice(9001, ago(39), 'paid', true);
      await invoice(9002, ago(9), 'void', false);
    }

    // 30 days of orders (and a few before), some cancelled
    let n = (
      await tx<
        { n: number }[]
      >`select coalesce(max(number), 0)::int as n from orders where tenant_id = ${id}`
    )[0]!.n;
    for (let d = 34; d >= 0; d--) {
      if (p.quietDays && d < p.quietDays) continue;
      if (d > p.age) continue;
      const count = Math.round(p.perDay * (0.5 + rand()));
      for (let i = 0; i < count; i++) {
        n += 1;
        const at = new Date(now - d * DAY - Math.floor(rand() * 10 * 3600_000));
        if (at.getTime() > now) continue;
        const total = 2500 + Math.round(rand() * 120) * 100;
        const state = rand() < 0.06 ? 'cancelled' : 'delivered';
        const name = NAMES[Math.floor(rand() * NAMES.length)]!;
        const phone = `2199${String(10_000_000 + Math.floor(rand() * 89_999_999)).slice(0, 7)}`;
        const cart = (
          await tx<{ id: string }[]>`
            insert into carts (tenant_id, session_hash) values (${id}, ${`${MARK}-${p.slug}-${n}`})
            returning id
          `
        )[0]!.id;
        await tx`
          insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery,
                              payment, state, subtotal_cents, total_cents, placed_at)
          values (${id}, ${cart}, ${n}, ${tx.json({ name, phone })}, ${phone},
                  ${tx.json({ mode: rand() < 0.6 ? 'delivery' : 'pickup' })},
                  ${tx.json({ provider: 'sandbox', method: 'pix', status: 'paid' })},
                  ${state}, ${total}, ${total}, ${at})
        `;
      }
    }

    if (!p.ai) continue;
    // Duá: conversations this month (a trial's over the trial), and the month before
    const monthStart = (
      await tx<{ start: Date }[]>`
        select date_trunc('month', now() at time zone 'America/Sao_Paulo')
          at time zone 'America/Sao_Paulo' as start
      `
    )[0]!.start;
    const from = p.sub === 'trialing' ? created : monthStart;
    await tx`
      insert into ai_conversations (tenant_id, subject_key, source, started_at)
      select ${id}, ${MARK + ':'} || ${p.slug} || ':' || g, ${p.sub === 'trialing' ? 'trial' : 'plan'},
             ${from}::timestamptz + (now() - ${from}::timestamptz) * random()
      from generate_series(1, ${p.ai.conversations}) g
    `;
    if (p.sub !== 'trialing')
      await tx`
        insert into ai_conversations (tenant_id, subject_key, source, started_at)
        select ${id}, ${MARK + ':'} || ${p.slug} || ':prev:' || g, 'plan',
               ${monthStart}::timestamptz - interval '26 days' * random()
        from generate_series(1, ${Math.round(p.ai.conversations * 0.8)}) g
      `;
    // a pack on the store that runs out of its month first
    if (p.slug === 'acai-do-porto') {
      const inv = (
        await tx<{ id: string }[]>`
          insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                                method, status, provider, due_at, paid_at, kind, ai_pack_id,
                                ai_conversations, created_at)
          values (${id}, 9010, ${p.plan}, 3990, ${ago(8)}, ${ago(8)}, 'pix', 'paid', 'fake',
                  ${ago(8)}, ${ago(8)}, 'ai_pack', 'ai_100', 100, ${ago(8)})
          returning id
        `
      )[0]!.id;
      const credit = (
        await tx<{ id: string }[]>`
          insert into ai_credits (tenant_id, invoice_id, conversations, created_at, expires_at)
          values (${id}, ${inv}, 100, ${ago(8)}, ${ago(8 - 30)}) returning id
        `
      )[0]!.id;
      await tx`
        insert into ai_conversations (tenant_id, subject_key, source, started_at, credit_id)
        select ${id}, ${MARK + ':'} || ${p.slug} || ':pack:' || g, 'pack',
               now() - interval '2 days' * random(), ${credit}
        from generate_series(1, 12) g
      `;
    }
    // what the model calls cost, over two providers and both tiers
    const actor = (
      await tx<{ id: string }[]>`
        insert into agent_actors (tenant_id, agent_id, subject_kind, subject_id, lane)
        values (${id}, 'vendedor', 'shopper_thread', ${MARK}, 'interactive')
        returning id
      `
    )[0]!.id;
    const calls = Math.min(p.age, 30) * p.ai.callsPerDay;
    await tx`
      insert into agent_events (tenant_id, actor_id, seq, type, payload, version, at)
      select ${id}, ${actor}, g, 'model.responded',
        jsonb_build_object(
          'tier', m.tier, 'provider', m.provider, 'model', m.model,
          'usage', jsonb_build_object(
            'inputTokens', m.input, 'outputTokens', m.output,
            'cacheReadTokens', m.input / 2, 'cacheWriteTokens', 0,
            'costUsd', round((m.cost * (0.7 + random() * 0.6))::numeric, 6)
          )
        ),
        'v_seed', now() - interval '30 days' * (g::float8 / ${calls})
      from generate_series(1, ${calls}) g
      cross join lateral (
        select * from (values
          ('fast', 'anthropic', 'claude-haiku-4-5', 6200, 180, 0.0041),
          ('fast', 'openrouter', 'google/gemini-2.5-flash', 6400, 210, 0.0016),
          ('strong', 'openrouter', 'anthropic/claude-sonnet-4.5', 7100, 320, 0.0262)
        ) v(tier, provider, model, input, output, cost)
        offset (case when g % 9 = 0 then 2 when g % 3 = 0 then 1 else 0 end) limit 1
      ) m
    `;
    await tx`update agent_actors set seq = ${calls} where id = ${actor}`;
  }

  const acai = idOf.get('acai-do-porto')!;
  await tx`
    insert into store_whatsapp (tenant_id, wanted, state, detail, phone, connected_at,
                                state_changed_at, outage_since)
    values (${acai}, false, 'error', 'stream_errored', '21988887777', ${ago(12)}, ${ago(0.1)},
            ${ago(0.1)})
    on conflict (tenant_id) do update set state = 'error', detail = excluded.detail,
      state_changed_at = excluded.state_changed_at, outage_since = excluded.outage_since,
      updated_at = now()
  `;
  await tx`
    insert into print_devices (tenant_id, name, platform, agent_version, connected_at, last_seen_at)
    values (${acai}, 'Balcão (seed)', 'windows', '1.4.0', ${ago(0.2)}, ${ago(0.002)}),
           (${idOf.get('cantina-da-nona')!}, 'Cozinha (seed)', 'android', '1.3.2', ${ago(9)}, ${ago(9)})
  `;
});

const summary = await db<{ slug: string; status: string; orders: number }[]>`
  select t.slug, s.status,
    (select count(*)::int from orders o where o.tenant_id = t.id and o.placed_at > now() - interval '30 days') as orders
  from tenants t join subscriptions s on s.tenant_id = t.id
  where t.slug in ${db(PLANS.map((p) => p.slug))} order by t.slug
`;
for (const r of summary)
  console.log(`${r.slug.padEnd(20)} ${r.status.padEnd(10)} ${r.orders} orders/30d`);
await db.end();
