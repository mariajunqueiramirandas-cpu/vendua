import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { copilot } from '../src/agent-host/agents/copilot/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { copilotView } from '../src/copilot/view.ts';
import { copilotTransport } from '../src/copilot/view.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { routeToDua, type InboxRow } from '../src/platform-whatsapp/dua.ts';
import {
  DUA,
  HEARD_UNSURE,
  parseChoice,
  parseReply,
  renderCards,
  toWhatsApp,
} from '../src/platform-whatsapp/dua-text.ts';
import { consumeRow, socketMessageToInbox } from '../src/platform-whatsapp/inbox.ts';

// Duá by WhatsApp (docs/features/dua-no-whatsapp.md §5): a merchant's message to Venduá's number
// reaches their Copilot conversation; the reply and its cards go back as text; a "SIM" is matched
// by Core and applied through decideTx, as the admin's tap — as vendua_app under RLS.

describe('Duá by WhatsApp: words Core writes', () => {
  test('the SIM grammar is closed, and anything else is a message', () => {
    expect(parseReply('Sim')).toEqual({ decision: 'confirm', n: null });
    expect(parseReply('s')).toEqual({ decision: 'confirm', n: null });
    expect(parseReply('ok!')).toEqual({ decision: 'confirm', n: null });
    expect(parseReply('pode')).toEqual({ decision: 'confirm', n: null });
    expect(parseReply('SIM 2')).toEqual({ decision: 'confirm', n: 2 });
    expect(parseReply('não')).toEqual({ decision: 'decline', n: null });
    expect(parseReply('nao 1')).toEqual({ decision: 'decline', n: 1 });
    expect(parseReply('#loja')).toEqual({ command: 'store' });
    expect(parseReply('sim, mas muda o horário')).toBeNull();
    expect(parseReply('simples')).toBeNull();
    expect(parseReply('n')).toBeNull();
    expect(parseChoice('2', 2)).toBe(2);
    expect(parseChoice('3', 2)).toBeNull();
    expect(parseChoice('2 lojas', 2)).toBeNull();
  });

  test('cards read as text, numbered when several, money ones sent to the panel', () => {
    expect(toWhatsApp('Hoje: **R$ 10,00**. Veja [Relatórios](/relatorios).')).toBe(
      'Hoje: *R$ 10,00*. Veja Relatórios.',
    );
    const at = new Date('2026-10-07T00:40:00Z'); // 21h40 in São Paulo
    const one = renderCards(
      [
        {
          ref: 1,
          title: 'Pausar a loja',
          lines: [{ label: 'Loja', from: 'Aberta', to: 'Pausada' }],
          money: false,
        },
      ],
      { expiresAt: at, tz: 'America/Sao_Paulo', appLink: null },
    );
    expect(one).toBe(
      '*Pausar a loja*\n- Loja: Aberta → Pausada\n\nResponda SIM para aplicar (vale até 21h40).',
    );
    const two = renderCards(
      [
        { ref: 1, title: 'A', lines: [], money: false },
        { ref: 2, title: 'B', lines: [{ label: 'Preço', from: 'R$ 1', to: 'R$ 2' }], money: true },
      ],
      { expiresAt: at, tz: 'America/Sao_Paulo', appLink: 'https://p.test/admin/copiloto' },
    );
    expect(two).toContain('1) *A*');
    expect(two).toContain('2) *B*');
    expect(two).toContain('confirme no painel, em https://p.test/admin/copiloto');
    expect(two).toContain('Responda SIM 1 para aplicar');
    expect(two).not.toContain('SIM 2');
  });
});

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));

describe.skipIf(!OWNER_URL)('Duá by WhatsApp (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-6);
  const tenants: string[] = [];
  let heard: { text: string; confidence: number | null } | null = null;
  const deps = {
    sql: appSql,
    jobsSql: appSql,
    origin: 'https://painel.test',
    media: { transcribe: async () => (heard ? { ...heard, language: 'pt' } : null) },
  };

  let phones = 0;
  /** an 11-digit mobile, unique to this run */
  const phone = () => `219${stamp}${String(++phones).padStart(2, '0')}`;

  interface Store {
    tenantId: string;
    userId: string;
    phone: string;
    productId: string;
  }

  async function store(
    o: { phone?: string; role?: string; on?: boolean; plan?: string; name?: string } = {},
  ): Promise<Store> {
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan)
      values (${`dw-${nonce}-${tenants.length}`}, ${o.name ?? 'Quero Pudim'}, ${o.plan ?? 'pangolim'})
      returning id`;
    const tenantId = t!.id;
    tenants.push(tenantId);
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, pickup_enabled)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, true)`;
    const [c] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${tenantId}, 'pudins', 'Pudins') returning id`;
    const [p] = await sql<{ id: string }[]>`
      insert into products (tenant_id, category_id, slug, name, base_price_cents)
      values (${tenantId}, ${c!.id}, 'pudim-de-leite', 'Pudim de Leite', 4500) returning id`;
    const ph = o.phone ?? phone();
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role, prefs)
      values (${tenantId}, 'Rita Souza', ${ph}, ${o.role ?? 'owner'},
              ${sql.json(o.on === false ? {} : { duaWhatsapp: true })})
      returning id`;
    return { tenantId, userId: u!.id, phone: ph, productId: p!.id };
  }

  /** A message to Venduá's number, as the gateway writes it, then consumed. */
  async function inbound(ph: string, body: string, extra: { media_id?: string } = {}) {
    const [row] = await sql<{ id: string }[]>`
      insert into platform_wa_inbox (session, kind, from_jid, phone, push_name, body, provider_id, media_id)
      values ('vendua', 'message', ${`55${ph}@s.whatsapp.net`}, ${`55${ph}`}, 'Rita', ${body},
              ${`p-${crypto.randomUUID()}`}, ${extra.media_id ?? null})
      returning id`;
    const [r] = await sql<InboxRow[]>`
      update platform_wa_inbox set attempts = attempts + 1 where id = ${row!.id}
      returning id, session, kind, from_jid, alt_jid, phone, push_name, body, media_id, provider_id,
                from_me, sent_at, pairs, attempts`;
    await consumeRow(deps, r!);
    return row!.id;
  }

  const sent = (ph: string) =>
    sql<{ body: string; purpose: string; dedupe_key: string }[]>`
      select body, purpose, dedupe_key from platform_wa_outbox
      where to_jid = ${`55${ph}@s.whatsapp.net`} or to_jid = ${`55${ph}`}
      order by created_at, id`;
  const lastSent = async (ph: string) => (await sent(ph)).at(-1)?.body;
  const inboxRow = (id: string) =>
    sql<{ status: string; next_attempt_at: Date }[]>`
      select status, next_attempt_at from platform_wa_inbox where id = ${id}`.then((r) => r[0]!);
  const mailbox = (tenantId: string) =>
    sql<{ source: string; dedupe_key: string; payload: any }[]>`
      select source, dedupe_key, payload from agent_mailbox
      where tenant_id = ${tenantId} order by created_at, id`;

  function runtime(script: ScriptedOutput[]) {
    const adapter = scriptedAdapter(script);
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    return new Runtime<Sql>({
      agents: [copilot],
      store: new PgActorStore(appSql),
      gateway,
      transports: [copilotTransport],
      owner: `w-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
      log: (level, msg, data) => {
        if (level === 'error') console.error(msg, data);
      },
    });
  }

  async function settle(rt: Runtime<Sql>, tenantId: string) {
    for (let i = 0; i < 20; i++) {
      await sql`update agent_actors set next_wake_at = null where tenant_id <> ${tenantId} and agent_id = 'copilot'`;
      if ((await rt.pump('interactive', { limit: 10, perTenantCap: 10 })) === 0) break;
    }
  }

  const audits = (tenantId: string, action: string) =>
    sql<{ actor_label: string }[]>`
      select actor_label from audit_log where tenant_id = ${tenantId} and action = ${action}`;

  const view = (s: Store, role: 'owner' | 'manager' = 'owner') =>
    withTenant(appSql, s.tenantId, (tx) =>
      copilotView(tx, s.tenantId, {
        userId: s.userId,
        sessionId: '',
        name: 'Rita',
        phone: s.phone,
        role,
      }),
    );

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // a card applies through the admin's own route handlers, registered when the app mounts
    createApp({
      sql: appSql,
      sessionSecret: 's',
      autoDrain: false,
      cepLookup: async () => null,
      storeDomain: 'vendua.test',
    });
  });

  afterAll(async () => {
    for (const t of tenants) await sql`delete from tenants where id = ${t}`;
    await sql`delete from platform_wa_dua_senders where phone like ${`219${stamp}%`}`;
    await sql`delete from platform_wa_outbox where to_jid like ${`55219${stamp}%`}`;
    await sql`delete from platform_wa_inbox where phone like ${`55219${stamp}%`}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('someone who is not a merchant stays the CRM’s', async () => {
    const out = await routeToDua(deps, {
      id: crypto.randomUUID(),
      session: 'vendua',
      kind: 'message',
      from_jid: '5511999990000@s.whatsapp.net',
      alt_jid: null,
      phone: `55${phone()}`,
      push_name: null,
      body: 'oi, quero saber da Venduá',
      media_id: null,
      provider_id: null,
      from_me: false,
      sent_at: null,
      pairs: null,
      attempts: 1,
    });
    expect(out).toEqual({ route: 'crm' });
  });

  test('a merchant with the switch off gets one pointer to Perfil a day, then silence', async () => {
    const s = await store({ on: false });
    const a = await inbound(s.phone, 'acabou o pudim');
    expect(await lastSent(s.phone)).toBe(DUA.turnOn('Rita', 'https://painel.test/admin/perfil'));
    expect((await inboxRow(a)).status).toBe('done');
    const b = await inbound(s.phone, 'oi?');
    expect(await sent(s.phone)).toHaveLength(1);
    expect((await inboxRow(b)).status).toBe('done');
    expect(await mailbox(s.tenantId)).toHaveLength(0);
  });

  test('a manager the owner kept out, and a plan without Copilot, are not let in', async () => {
    const m = await store({ role: 'manager' });
    await sql`update store_settings set dua_whatsapp_managers = false where tenant_id = ${m.tenantId}`;
    await inbound(m.phone, 'quanto vendi hoje?');
    expect(await lastSent(m.phone)).toBe(DUA.notForYou('https://painel.test/admin/'));
    const basic = await store({ plan: 'basic' });
    await inbound(basic.phone, 'quanto vendi hoje?');
    expect(await lastSent(basic.phone)).toBe(DUA.notForYou('https://painel.test/admin/'));
    expect(await mailbox(m.tenantId)).toHaveLength(0);
    expect(await mailbox(basic.tenantId)).toHaveLength(0);
  });

  test('a message joins the person’s Copilot conversation, marked as WhatsApp', async () => {
    const s = await store();
    const id = await inbound(s.phone, 'quanto vendi hoje?');
    expect((await inboxRow(id)).status).toBe('done');
    const box = await mailbox(s.tenantId);
    expect(box).toHaveLength(1);
    expect(box[0]!.source).toBe(`whatsapp:${s.userId}`);
    expect(box[0]!.dedupe_key).toBe(`copilot-wa:${id}`);
    expect(box[0]!.payload.text).toBe('quanto vendi hoje?');
    const v = await view(s);
    expect(v.items[0]).toMatchObject({ author: 'merchant', channel: 'whatsapp', voice: false });
    expect(v.busy).toBe(true);
  });

  test('a turn’s reply and card go back by WhatsApp, and SIM applies it as the tap would', async () => {
    const s = await store();
    await inbound(s.phone, 'pausa a loja meia hora');
    const rt = runtime([
      tools(call('propose_pause', { minutes: 30, message: 'Cozinha cheia!' })),
      reply('Preparei a pausa. Confere e me responde.'),
    ]);
    await settle(rt, s.tenantId);
    const out = (await sent(s.phone)).at(-1)!;
    expect(out.purpose).toBe('dua');
    expect(out.body).toContain('Preparei a pausa.');
    expect(out.body).toContain('*Pausar a loja*');
    expect(out.body).toMatch(/Responda SIM para aplicar \(vale até \d{2}h\d{2}\)\./);
    const v = await view(s);
    expect(v.items.find((i) => i.type === 'message' && i.author === 'dua')).toMatchObject({
      channel: 'whatsapp',
    });

    const yes = await inbound(s.phone, 'Sim');
    expect((await inboxRow(yes)).status).toBe('done');
    const [st] = await sql<{ status_override: string | null }[]>`
      select status_override from store_settings where tenant_id = ${s.tenantId}`;
    expect(st!.status_override).toBe('paused');
    expect(await lastSent(s.phone)).toMatch(/^Feito: Loja pausada até hoje às \d{2}:\d{2}$/);
    expect((await audits(s.tenantId, 'store.pause'))[0]!.actor_label).toBe(
      'Rita Souza pelo Duá (WhatsApp)',
    );
    const card = (await view(s)).items.find((i) => i.type === 'action')!;
    expect(card).toMatchObject({ status: 'applied' });

    // the yes never reached the model, and a second one finds nothing open
    expect((await mailbox(s.tenantId)).filter((m) => m.payload.text === 'Sim')).toHaveLength(0);
    await inbound(s.phone, 'sim');
    expect(await lastSent(s.phone)).toBe(DUA.nothingOpen);
    expect(await audits(s.tenantId, 'store.pause')).toHaveLength(1);
  });

  test('several cards are numbered; a bare SIM asks which, and money stays in the panel', async () => {
    const s = await store();
    await inbound(s.phone, 'acabou o pudim, e sobe o preço dele pra 49,90');
    const rt = runtime([
      tools(call('menu')),
      tools(
        call('propose_product_change', { product: 'p1', availability: 'sold_out_today' }),
        call('propose_product_change', { product: 'p1', priceCents: 4990 }),
      ),
      reply('Preparei as duas.'),
    ]);
    await settle(rt, s.tenantId);
    const out = (await lastSent(s.phone))!;
    expect(out).toContain('1) *');
    expect(out).toContain('2) *');
    expect(out).toContain('Responda SIM 1 para aplicar');

    await inbound(s.phone, 'sim');
    expect(await lastSent(s.phone)).toBe(DUA.whichOne([1, 2]));
    await inbound(s.phone, 'sim 2');
    expect(await lastSent(s.phone)).toBe(DUA.moneyInApp('https://painel.test/admin/copiloto'));
    await inbound(s.phone, 'sim 1');
    expect(await lastSent(s.phone)).toMatch(/^Feito: /);
    const [p] = await sql<{ base_price_cents: number }[]>`
      select base_price_cents from products where id = ${s.productId}`;
    expect(p!.base_price_cents).toBe(4500);
    await inbound(s.phone, 'não');
    expect(await lastSent(s.phone)).toBe(DUA.declined);
    const cards = (await view(s)).items.filter((i) => i.type === 'action');
    expect(cards.map((c) => (c as { status: string }).status)).toEqual(['applied', 'declined']);
  });

  test('an “ok” after Duá moved on is a message for Duá, not a yes to the older card', async () => {
    const s = await store();
    const rt = runtime([
      tools(call('propose_pause', { minutes: 30, message: 'Já voltamos' })),
      reply('Preparei a pausa.'),
      reply('Quer que eu mude o horário de amanhã?'),
    ]);
    await inbound(s.phone, 'pausa a loja meia hora');
    await settle(rt, s.tenantId);
    await inbound(s.phone, 'e o horário de amanhã?');
    await settle(rt, s.tenantId);
    expect(await lastSent(s.phone)).toBe('Quer que eu mude o horário de amanhã?');
    await inbound(s.phone, 'ok');
    const [st] = await sql<{ status_override: string | null }[]>`
      select status_override from store_settings where tenant_id = ${s.tenantId}`;
    expect(st!.status_override).toBeNull();
    expect((await mailbox(s.tenantId)).map((m) => m.payload.text)).toContain('ok');
  });

  test('values that changed since the card refuse the SIM', async () => {
    const s = await store();
    await inbound(s.phone, 'muda o preparo pra 40 minutos');
    const rt = runtime([
      tools(call('propose_operations', { prepTimeMinutes: 40 })),
      reply('Preparei.'),
    ]);
    await settle(rt, s.tenantId);
    expect(await lastSent(s.phone)).toContain('Responda SIM');
    await sql`update store_settings set prep_time_minutes = 30 where tenant_id = ${s.tenantId}`;
    await inbound(s.phone, 'ok');
    expect(await lastSent(s.phone)).toBe(DUA.drifted);
  });

  test('several stores: a numbered choice that sticks until #loja', async () => {
    const ph = phone();
    const a = await store({ phone: ph, name: 'Quero Pudim' });
    const b = await store({ phone: ph, name: 'Quero Pudim Centro' });
    await inbound(ph, 'quanto vendi hoje?');
    expect(await lastSent(ph)).toBe(DUA.chooseStore(['Quero Pudim', 'Quero Pudim Centro']));
    await inbound(ph, '2');
    expect(await lastSent(ph)).toBe(DUA.chosen('Quero Pudim Centro'));
    await inbound(ph, 'quanto vendi hoje?');
    expect(await mailbox(b.tenantId)).toHaveLength(1);
    expect(await mailbox(a.tenantId)).toHaveLength(0);
    await inbound(ph, '#loja');
    expect(await lastSent(ph)).toBe(DUA.chooseStore(['Quero Pudim', 'Quero Pudim Centro']));
    await inbound(ph, '1');
    await inbound(ph, 'e agora?');
    expect(await mailbox(a.tenantId)).toHaveLength(1);
  });

  test('a voice note is transcribed with the store’s names; an unsure one is marked for Duá', async () => {
    const s = await store();
    const media = async () =>
      (
        await sql<{ id: string }[]>`
          insert into platform_wa_media (session, mime, bytes, seconds)
          values ('vendua', 'audio/ogg; codecs=opus', ${Buffer.from([1, 2, 3])}, 4) returning id`
      )[0]!.id;
    heard = { text: 'acabou o pudim de leite', confidence: 0.92 };
    await inbound(s.phone, '[áudio]', { media_id: await media() });
    heard = { text: 'acabou o pudim de leite', confidence: 0.3 };
    await inbound(s.phone, '[áudio]', { media_id: await media() });
    heard = null;
    await inbound(s.phone, '[áudio]', { media_id: await media() });
    expect(await lastSent(s.phone)).toBe(DUA.voiceUnheard);
    const box = await mailbox(s.tenantId);
    expect(box.map((m) => m.payload.text)).toEqual([
      'acabou o pudim de leite',
      `${HEARD_UNSURE} acabou o pudim de leite`,
    ]);
    expect(box[0]!.payload.kind).toBe('voice');
    const v = await view(s);
    expect(v.items.filter((i) => i.type === 'message' && i.voice)).toHaveLength(2);
    // over the cap the gateway keeps no media: the tag alone asks for a shorter one
    await inbound(s.phone, '[áudio]');
    expect(await lastSent(s.phone)).toBe(DUA.voiceTooLong);
  });

  test('past 30 messages in 10 minutes: one “calma”, and the rest wait', async () => {
    const s = await store();
    await sql`
      insert into platform_wa_dua_senders (phone, window_start, window_count)
      values (${s.phone}, now(), 30)
      on conflict (phone) do update set window_start = now(), window_count = 30, calm_sent = false`;
    const a = await inbound(s.phone, 'mais uma');
    const b = await inbound(s.phone, 'e outra');
    expect((await sent(s.phone)).map((m) => m.body)).toEqual([DUA.calm]);
    for (const id of [a, b]) {
      const r = await inboxRow(id);
      expect(r.status).toBe('pending');
      expect(r.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    }
    expect(await mailbox(s.tenantId)).toHaveLength(0);
  });

  test('Core’s socket hands merchant messages to the inbox, and keeps everyone else', async () => {
    const s = await store();
    const jid = `55${s.phone}@s.whatsapp.net`;
    expect(await socketMessageToInbox(appSql, { jid, text: 'oi', providerId: `x-${nonce}` })).toBe(
      true,
    );
    const rows = await sql`select 1 from platform_wa_inbox where provider_id = ${`x-${nonce}`}`;
    expect(rows).toHaveLength(1);
    expect(
      await socketMessageToInbox(appSql, {
        jid: `55${phone()}@s.whatsapp.net`,
        text: 'oi',
        providerId: `y-${nonce}`,
      }),
    ).toBe(false);
    expect(
      await socketMessageToInbox(appSql, {
        jid: '12345@lid',
        text: 'oi',
        providerId: `z-${nonce}`,
      }),
    ).toBe(false);
  });
});
