import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createGateway, type ModelGateway, type ScriptedOutput } from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { createSession } from '../src/admin/auth.ts';
import { pushAsk } from '../src/admin/workers.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { configureVendedor } from '../src/vendedor/deps.ts';
import { ingestPass } from '../src/vendedor/ingest.ts';
import { withDefaults } from '../src/vendedor/settings.ts';
import { SUBJECT_KIND } from '../src/vendedor/threads.ts';
import { decide, parseVerdict, triagePass, triageSweep } from '../src/vendedor/triage.ts';

// ADR 0033: who Duá answers on a number that is also the owner's own. The gateway's side is
// played by SQL here (its answers to store_wa_history_requests); the model is scripted.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

describe('the verdict table', () => {
  test('codes per status and verdict', () => {
    expect(decide('empty', null)).toEqual({
      cls: 'shopper',
      source: 'new_contact',
      reason: 'no_prior_chat',
    });
    // no prior chat: a stranger is answered (even "oi"), one who reads like a friend is asked about
    expect(decide('empty', 'unsure')).toMatchObject({ cls: 'shopper', reason: 'no_prior_chat' });
    expect(decide('empty', 'customer')).toMatchObject({ cls: 'shopper', reason: 'no_prior_chat' });
    expect(decide('empty', 'personal')).toEqual({
      cls: 'ask',
      source: 'message',
      reason: 'looks_personal',
    });
    expect(decide('failed', 'personal')).toMatchObject({ cls: 'personal', source: 'message' });
    expect(decide('done', 'personal')).toMatchObject({ cls: 'personal', source: 'history' });
    expect(decide('done', 'customer')).toMatchObject({ cls: 'shopper', reason: 'looks_customer' });
    expect(decide('done', 'unparseable')).toMatchObject({ cls: 'ask', reason: 'unclear' });
    expect(decide('done', null)).toMatchObject({
      source: 'message',
      reason: 'history_unavailable',
    });
    expect(decide('failed', 'customer')).toMatchObject({ cls: 'shopper', source: 'message' });
    expect(decide('failed', 'unsure')).toMatchObject({ cls: 'ask', reason: 'history_unavailable' });
    expect(parseVerdict('```json\n{"verdict":"personal"}\n```')).toBe('personal');
    expect(parseVerdict('{"verdict":"amigo"}')).toBe('unparseable');
    expect(parseVerdict('não sei')).toBe('unparseable');
  });

  test('legacy settings read as answerWho', () => {
    expect(withDefaults({}).answerWho).toBe('known_and_new');
    expect(withDefaults({ unknownNumbers: 'all' }).answerWho).toBe('everyone');
    expect(withDefaults({ unknownNumbers: 'shoppers_only' }).answerWho).toBe('known_and_new');
    expect(withDefaults({ answerWho: 'known_only', unknownNumbers: 'all' }).answerWho).toBe(
      'known_only',
    );
    expect('unknownNumbers' in withDefaults({ unknownNumbers: 'all' })).toBe(false);
  });
});

describe.skipIf(!OWNER_URL)('who Duá answers on Postgres', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const app = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const http = createApp({
    sql: app,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const tenants: string[] = [];
  const nonce = crypto.randomUUID().slice(0, 6);
  let n = 0;
  let idem = 0;

  configureVendedor({ sql: app, sessionSecret: 'test', storeDomain: 'vendua.test' });

  // the scripted model: each call answers what `verdicts` says next, and is recorded
  let next: ScriptedOutput[] = [];
  let during: (() => Promise<void>) | null = null;
  const adapter = scriptedAdapter(() => next.shift() ?? { text: '' });
  const base = createGateway({
    adapters: [adapter],
    routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
  });
  const gateway: ModelGateway = {
    ...base,
    generate: async (req, opts) => {
      const out = await base.generate(req, opts);
      if (during) await during();
      return out;
    },
  };
  const said = () => {
    const r = adapter.requests[adapter.requests.length - 1]!;
    const m = r.messages[0]!;
    const user = 'parts' in m ? m.parts.map((p) => ('text' in p ? p.text : '')).join('') : '';
    return { system: r.system.map((s) => s.text).join(' '), user };
  };

  const admin: Record<string, string[]> = {};
  let unlisten: (() => Promise<void>) | null = null;

  async function store(settings: Record<string, unknown> = {}) {
    const slug = `vt-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, 'Forno da Vila') returning id`;
    const tenantId = t!.id;
    tenants.push(tenantId);
    await sql`insert into store_settings ${sql({
      tenant_id: tenantId,
      hours: sql.json({
        timezone: 'America/Sao_Paulo',
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
      }),
      prep_time_minutes: 30,
      min_order_cents: 0,
      currency: 'BRL',
      vocabulary: sql.json({}),
    })}`;
    await sql`insert into store_agent (tenant_id, enabled, settings) values
      (${tenantId}, true, ${sql.json({ coverage: 'always', ...settings } as never)})`;
    return tenantId;
  }

  const phoneOf = () => `21${String(Date.now() + ++n).slice(-9)}`;

  async function newThread(
    tenantId: string,
    o: { cls?: string; channel?: string; phone?: string; name?: string } = {},
  ) {
    const phone = o.phone ?? phoneOf();
    const [t] = await sql<{ id: string }[]>`
      insert into shopper_threads (tenant_id, channel, address, phone, profile_name, class, test_kind)
      values (${tenantId}, ${o.channel ?? 'whatsapp'}, ${`55${phone}@s.whatsapp.net`},
        ${o.channel === 'test' ? null : phone}, ${o.name ?? 'Marina'}, ${o.cls ?? 'unknown'},
        ${o.channel === 'test' ? 'owner' : null})
      returning id`;
    return t!.id;
  }

  /** What the gateway writes for a message: inbound from the contact, or typed on the phone. */
  async function inbound(
    tenantId: string,
    threadId: string,
    body: string,
    o: { author?: 'shopper' | 'merchant'; kind?: string } = {},
  ) {
    const [m] = await sql<{ id: string }[]>`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, wa_id, ingest)
      values (${tenantId}, ${threadId}, ${o.author ?? 'shopper'}, ${o.kind ?? 'text'}, ${body},
        ${`WT${++n}${Math.random().toString(36).slice(2, 8)}`}, 'pending')
      returning id`;
    await sql`update shopper_threads set last_in_at = now(), pending_since = coalesce(pending_since, now())
      where id = ${threadId}`;
    return m!.id;
  }

  const ingest = async () => {
    while ((await ingestPass({ sql: app, media: null, gateway: null })) > 0);
  };
  const triage = async (g: ModelGateway | null = gateway) => {
    while ((await triagePass({ sql: app, gateway: g })) > 0);
  };
  const threadRow = async (id: string) =>
    (
      await sql<
        {
          class: string;
          class_source: string | null;
          class_reason: string | null;
          asked_at: Date | null;
          owner: string;
          human_until: Date | null;
        }[]
      >`select class, class_source, class_reason, asked_at, owner, human_until from shopper_threads where id = ${id}`
    )[0]!;
  const states = async (threadId: string) =>
    (
      await sql<{ ingest: string | null }[]>`
        select ingest from shopper_messages where thread_id = ${threadId} and author = 'shopper'
        order by created_at`
    ).map((r) => r.ingest);
  const requests = (threadId: string) =>
    sql<
      {
        id: string;
        status: string;
        failure: string | null;
        anchor_wa_id: string;
        address: string;
        messages: unknown;
        triaged_at: Date | null;
      }[]
    >`select * from store_wa_history_requests where thread_id = ${threadId} order by created_at`;
  const mailbox = async (threadId: string) =>
    (
      await sql<{ kind: string }[]>`
        select m.kind from agent_mailbox m join agent_actors a on a.id = m.actor_id
        where a.subject_id = ${threadId} order by m.created_at`
    ).map((r) => r.kind);
  /** The gateway's answer to Core's request. */
  const answer = async (
    requestId: string,
    status: 'done' | 'empty' | 'failed',
    messages: { fromMe: boolean; at: string; text: string }[] | null = null,
    failure: string | null = null,
  ) => {
    await sql`update store_wa_history_requests set status = ${status}, failure = ${failure},
      messages = ${messages ? sql.json(messages) : null}, finished_at = now(), updated_at = now()
      where id = ${requestId}`;
  };
  const chat = [
    { fromMe: false, at: '2026-10-01T22:00:00Z', text: 'bora no churrasco sábado?' },
    { fromMe: true, at: '2026-10-01T22:05:00Z', text: 'bora! levo a cerveja' },
  ];
  const settle = () => new Promise((r) => setTimeout(r, 150));

  /** A thread in `checking` with one held message and its open request. */
  async function checking(tenantId: string, body = 'oi, tudo bem?') {
    const threadId = await newThread(tenantId);
    await inbound(tenantId, threadId, body);
    await ingest();
    const [req] = await requests(threadId);
    return { threadId, requestId: req!.id };
  }

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const sub = await sql.listen('vendua_admin', (p) => {
      const [tenantId, topic, id] = p.split('|');
      if (topic === 'vendedor.ask') (admin[tenantId!] ??= []).push(id!);
    });
    unlisten = sub.unlisten;
  });

  afterAll(async () => {
    await unlisten?.();
    for (const t of tenants) await sql`delete from tenants where id = ${t}`;
    await sql.end();
    await (app as unknown as ReturnType<typeof postgres>).end();
  });

  // ── deterministic signals ─────────────────────────────────────────────────

  test('a number that ordered before is a shopper, and Duá hears it', async () => {
    const tenantId = await store();
    const phone = phoneOf();
    const [cart] = await sql<{ id: string }[]>`
      insert into carts (tenant_id, session_hash) values (${tenantId}, ${`vt-${nonce}-${++n}`}) returning id`;
    await sql`insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
        state, subtotal_cents, total_cents)
      values (${tenantId}, ${cart!.id}, 1, ${sql.json({ name: 'Bia', phone })}, ${phone},
        ${sql.json({ mode: 'pickup' })}, ${sql.json({ provider: 'sandbox', method: 'pix', status: 'pending' })},
        'ready', 1000, 1000)`;
    const threadId = await newThread(tenantId, { phone });
    await inbound(tenantId, threadId, 'oi, tudo bem?');
    await ingest();
    expect(await threadRow(threadId)).toMatchObject({
      class: 'shopper',
      class_source: 'orders',
      class_reason: 'ordered_before',
    });
    expect(await states(threadId)).toEqual(['done']);
    expect(await mailbox(threadId)).toContain('message.inbound');
    expect(await requests(threadId)).toHaveLength(0);
  });

  test('"todo mundo": every number but obvious non-shoppers', async () => {
    const tenantId = await store({ answerWho: 'everyone' });
    const a = await newThread(tenantId);
    await inbound(tenantId, a, 'oi, tudo bem?');
    const b = await newThread(tenantId);
    await inbound(tenantId, b, 'segue o boleto do fornecedor');
    await ingest();
    expect(await threadRow(a)).toMatchObject({ class: 'shopper', class_reason: 'everyone' });
    expect(await threadRow(b)).toMatchObject({
      class: 'other',
      class_source: 'content',
      class_reason: 'not_a_shopper',
    });
    expect(await states(b)).toEqual(['skipped']);
    expect(await mailbox(b)).toEqual([]);
  });

  test('"só quem já é cliente": a new number waits for the owner, asked once a day', async () => {
    const tenantId = await store({ answerWho: 'known_only' });
    const threadId = await newThread(tenantId);
    await inbound(tenantId, threadId, 'oi, tudo bem?');
    await ingest();
    const first = await threadRow(threadId);
    expect(first).toMatchObject({
      class: 'ask',
      class_source: 'setting',
      class_reason: 'known_only',
    });
    expect(first.asked_at).not.toBeNull();
    expect(await states(threadId)).toEqual(['held']);
    expect(await mailbox(threadId)).toEqual([]);
    await inbound(tenantId, threadId, 'tá aí?');
    await ingest();
    expect((await threadRow(threadId)).asked_at!.getTime()).toBe(first.asked_at!.getTime());
    await settle();
    expect(admin[tenantId]).toEqual([threadId]);
    // a day later, a new message asks again
    await sql`update shopper_threads set asked_at = now() - interval '25 hours' where id = ${threadId}`;
    await inbound(tenantId, threadId, 'alô?');
    await ingest();
    await settle();
    expect(admin[tenantId]).toEqual([threadId, threadId]);
    expect(await states(threadId)).toEqual(['held', 'held', 'held']);
    // the push: once per asked_at, never for a personal contact
    await pushAsk(app, tenantId, threadId);
    await pushAsk(app, tenantId, threadId);
    const [{ count }] = (await sql`
      select count(*)::int as count from push_deliveries
      where tenant_id = ${tenantId} and key like ${`vendedor.ask:${threadId}:%`}`) as unknown as [
      { count: number },
    ];
    expect(count).toBe(1);
    const friend = await newThread(tenantId, { cls: 'personal' });
    await sql`update shopper_threads set asked_at = now() where id = ${friend}`;
    await pushAsk(app, tenantId, friend);
    expect(
      await sql`select 1 from push_deliveries where tenant_id = ${tenantId} and key like ${`vendedor.ask:${friend}:%`}`,
    ).toHaveLength(0);
  });

  // ── the chat check ────────────────────────────────────────────────────────

  test('a new number is checked: held, one request anchored on its message', async () => {
    const tenantId = await store();
    const threadId = await newThread(tenantId);
    const msgId = await inbound(tenantId, threadId, 'oi, tudo bem?');
    await ingest();
    expect(await threadRow(threadId)).toMatchObject({ class: 'checking', class_source: null });
    const [m] = await sql<
      { wa_id: string }[]
    >`select wa_id from shopper_messages where id = ${msgId}`;
    const reqs = await requests(threadId);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      status: 'pending',
      anchor_wa_id: m!.wa_id,
      address: expect.stringContaining('@s.whatsapp.net'),
    });
    await inbound(tenantId, threadId, 'queria saber uma coisa');
    await ingest();
    expect(await requests(threadId)).toHaveLength(1);
    expect(await states(threadId)).toEqual(['held', 'held']);
    expect(await mailbox(threadId)).toEqual([]);
  });

  test('no prior chat: the message is read with what the store sells, a stranger goes to Duá', async () => {
    const tenantId = await store();
    await sql`insert into categories (tenant_id, slug, name, sort)
      values (${tenantId}, 'paes', 'Pães', 1), (${tenantId}, 'bolos', 'Bolos', 2)`;
    const { threadId, requestId } = await checking(
      tenantId,
      'oi, vocês fazem bolo de aniversário?',
    );
    next = [{ text: '{"verdict":"customer"}' }];
    await answer(requestId, 'empty');
    await triage();
    const { system, user } = said();
    expect(system).toContain('continua uma conversa anterior');
    expect(user).toContain('<loja>Forno da Vila — vende: Pães, Bolos</loja>');
    expect(user).toContain('<situacao>sem_historico</situacao>');
    expect(user).not.toContain('<conversa>');
    expect(await threadRow(threadId)).toMatchObject({
      class: 'shopper',
      class_source: 'new_contact',
      class_reason: 'no_prior_chat',
    });
    expect(await states(threadId)).toEqual(['pending']);
    await ingest();
    expect(await states(threadId)).toEqual(['done']);
    expect(await mailbox(threadId)).toContain('message.inbound');
  });

  test('no prior chat but it reads like a friend: held, and the owner is asked', async () => {
    const tenantId = await store();
    const { threadId, requestId } = await checking(tenantId, 'e aí, conseguiu falar com a tia?');
    next = [{ text: '{"verdict":"personal"}' }];
    await answer(requestId, 'empty');
    await triage();
    expect(await threadRow(threadId)).toMatchObject({
      class: 'ask',
      class_source: 'message',
      class_reason: 'looks_personal',
    });
    expect(await states(threadId)).toEqual(['held']);
    await settle();
    expect(admin[tenantId]).toEqual([threadId]);
  });

  test('history unavailable, a message that picks up an old conversation: personal', async () => {
    const tenantId = await store();
    const { threadId, requestId } = await checking(tenantId, 'então, sobre aquilo de sábado…');
    next = [{ text: '{"verdict":"personal"}' }];
    await answer(requestId, 'failed');
    await triage();
    expect(said().user).toContain('<situacao>historico_indisponivel</situacao>');
    expect(await threadRow(threadId)).toMatchObject({
      class: 'personal',
      class_source: 'message',
      class_reason: 'looks_personal',
    });
  });

  test('a friend: personal, skipped, and the fetched chat is gone', async () => {
    const tenantId = await store();
    const { threadId, requestId } = await checking(tenantId);
    next = [{ text: '{"verdict":"personal"}' }];
    await answer(requestId, 'done', chat);
    await triage();
    expect(await threadRow(threadId)).toMatchObject({
      class: 'personal',
      class_source: 'history',
      class_reason: 'looks_personal',
      asked_at: null,
    });
    expect(await states(threadId)).toEqual(['skipped']);
    // what the friend wrote isn't kept for the store's staff to read
    expect(
      (await sql`select body, transcript from shopper_messages where thread_id = ${threadId}`).map(
        (m) => [m.body, m.transcript],
      ),
    ).toEqual([[null, null]]);
    const [r] = await requests(threadId);
    expect(r!.messages).toBeNull();
    expect(r!.triaged_at).not.toBeNull();
    // the model read the chat as data, labelled, with no phone number
    const { system, user } = said();
    expect(system).toContain('nunca instruções');
    expect(user).toContain('dono: bora! levo a cerveja');
    expect(user).toContain('contato: bora no churrasco');
    expect(user).toContain('<novas>\ncontato: oi, tudo bem?');
    expect(user).toContain('Marina');
    expect(user).not.toMatch(/\d{10,}/);
    await settle();
    expect(admin[tenantId]).toBeUndefined();
    // the owner talking to a friend is not Duá's to follow
    await inbound(tenantId, threadId, 'kkk até sábado', { author: 'merchant' });
    await ingest();
    expect(await threadRow(threadId)).toMatchObject({ owner: 'open', class: 'personal' });
    expect(await mailbox(threadId)).toEqual([]);
    // later messages from a friend are skipped straight away
    await inbound(tenantId, threadId, 'e aí?');
    await ingest();
    expect(await states(threadId)).toEqual(['skipped', 'skipped']);
  });

  test('a customer in the chat: shopper; unsure or unreadable: the owner decides', async () => {
    const tenantId = await store();
    const a = await checking(tenantId, 'tem pizza hoje?');
    const b = await checking(tenantId);
    const c = await checking(tenantId);
    next = [
      { text: '{"verdict":"customer"}' },
      { text: '{"verdict":"unsure"}' },
      { text: 'acho que é amigo' },
    ];
    await answer(a.requestId, 'done', chat);
    await triage();
    await answer(b.requestId, 'done', chat);
    await triage();
    await answer(c.requestId, 'done', chat);
    await triage();
    expect(await threadRow(a.threadId)).toMatchObject({
      class: 'shopper',
      class_source: 'history',
      class_reason: 'looks_customer',
    });
    expect(await states(a.threadId)).toEqual(['pending']);
    for (const t of [b, c]) {
      const row = await threadRow(t.threadId);
      expect(row).toMatchObject({ class: 'ask', class_source: 'history', class_reason: 'unclear' });
      expect(row.asked_at).not.toBeNull();
      expect(await states(t.threadId)).toEqual(['held']);
    }
    await settle();
    expect(admin[tenantId]?.sort()).toEqual([b.threadId, c.threadId].sort());
  });

  test('history unavailable: the message alone decides, no model means the owner decides', async () => {
    const tenantId = await store();
    const a = await checking(tenantId, 'vocês entregam no centro?');
    const b = await checking(tenantId);
    const c = await checking(tenantId);
    next = [{ text: '{"verdict":"customer"}' }, { text: '{"verdict":"unsure"}' }];
    await answer(a.requestId, 'failed', null, 'offline');
    await triage();
    await answer(b.requestId, 'failed', null, 'offline');
    await triage();
    expect(said().user).not.toContain('<conversa>');
    expect(await threadRow(a.threadId)).toMatchObject({
      class: 'shopper',
      class_source: 'message',
      class_reason: 'looks_customer',
    });
    expect(await threadRow(b.threadId)).toMatchObject({
      class: 'ask',
      class_source: 'message',
      class_reason: 'history_unavailable',
    });
    await answer(c.requestId, 'done', chat);
    await triage(null);
    expect(await threadRow(c.threadId)).toMatchObject({
      class: 'ask',
      class_source: 'message',
      class_reason: 'history_unavailable',
    });
    expect((await requests(c.threadId))[0]!.messages).toBeNull();
  });

  test('the owner decides while the model thinks: the owner wins', async () => {
    const tenantId = await store();
    const { threadId, requestId } = await checking(tenantId);
    next = [{ text: '{"verdict":"customer"}' }];
    during = async () => {
      await sql`update shopper_threads set class = 'personal', class_source = 'owner',
        class_reason = 'owner_marked' where id = ${threadId}`;
      await sql`update shopper_messages set ingest = 'skipped' where thread_id = ${threadId} and ingest = 'held'`;
    };
    await answer(requestId, 'done', chat);
    try {
      await triage();
    } finally {
      during = null;
    }
    expect(await threadRow(threadId)).toMatchObject({ class: 'personal', class_source: 'owner' });
    expect(await states(threadId)).toEqual(['skipped']);
    const [r] = await requests(threadId);
    expect(r!.messages).toBeNull();
    expect(r!.triaged_at).not.toBeNull();
  });

  test('the sweeper: an unanswered request times out, fetched text expires', async () => {
    const tenantId = await store();
    const { threadId, requestId } = await checking(tenantId);
    await sql`update store_wa_history_requests set created_at = now() - interval '2 minutes',
      status = 'fetching' where id = ${requestId}`;
    await triageSweep(app);
    expect((await requests(threadId))[0]).toMatchObject({ status: 'failed', failure: 'timeout' });
    next = [{ text: '{"verdict":"personal"}' }];
    await triage();
    expect(await threadRow(threadId)).toMatchObject({
      class: 'personal',
      class_source: 'message',
    });
    // a chat nobody classified (the thread was decided meanwhile) still never outlives 10 min
    const other = await checking(tenantId);
    await answer(other.requestId, 'done', chat);
    await sql`update store_wa_history_requests set finished_at = now() - interval '11 minutes'
      where id = ${other.requestId}`;
    await triageSweep(app);
    expect((await requests(other.threadId))[0]!.messages).toBeNull();
  });

  // ── the owner's phone commands ────────────────────────────────────────────

  test('#pessoal, #cliente, #dua: decisions, never a takeover, never learned', async () => {
    const tenantId = await store();
    const p = await checking(tenantId);
    const knowledge = async () =>
      (await sql`select 1 from store_knowledge where tenant_id = ${tenantId}`).length;
    await inbound(tenantId, p.threadId, 'pessoal', { author: 'merchant', kind: 'command' });
    await ingest();
    expect(await threadRow(p.threadId)).toMatchObject({
      class: 'personal',
      class_source: 'command',
      class_reason: 'owner_marked',
      owner: 'open',
    });
    expect(await states(p.threadId)).toEqual(['skipped']);
    expect(await mailbox(p.threadId)).toEqual([]);
    // the gateway's answer lands after the owner's word: nothing changes
    await answer(p.requestId, 'done', chat);
    await triage();
    expect((await threadRow(p.threadId)).class).toBe('personal');

    const askStore = await store({ answerWho: 'known_only' });
    const c = await newThread(askStore);
    await inbound(askStore, c, 'oi');
    await ingest();
    expect((await threadRow(c)).class).toBe('ask');
    await inbound(askStore, c, 'cliente', { author: 'merchant', kind: 'command' });
    await ingest();
    expect(await threadRow(c)).toMatchObject({ class: 'shopper', class_source: 'command' });
    expect(await mailbox(c)).toEqual(['message.inbound']);

    const d = await newThread(tenantId, { cls: 'shopper' });
    await sql`update shopper_threads set owner = 'human', human_until = now() + interval '30 minutes'
      where id = ${d}`;
    await inbound(tenantId, d, 'dua', { author: 'merchant', kind: 'command' });
    await ingest();
    const row = await threadRow(d);
    expect(row).toMatchObject({ class: 'shopper', owner: 'agent', human_until: null });
    expect(await mailbox(d)).toEqual(['timer.handback']);
    expect(await knowledge()).toBe(0);
    const cmds = await sql<{ ingest: string }[]>`
      select ingest from shopper_messages where thread_id = ${d} and kind = 'command'`;
    expect(cmds.map((r) => r.ingest)).toEqual(['done']);
  });

  // ── the admin ─────────────────────────────────────────────────────────────

  describe('the admin API', () => {
    let tenantId = '';
    let attendant: (m: string, p: string, b?: unknown, key?: string) => Promise<any>;
    let manager: typeof attendant;

    beforeAll(async () => {
      tenantId = await store({ unknownNumbers: 'all' });
      const session = async (role: 'manager' | 'attendant') => {
        const [u] = await sql<{ id: string }[]>`
          insert into merchant_users (tenant_id, name, phone, role)
          values (${tenantId}, ${role}, ${`2198${String(Date.now() + ++n).slice(-7)}`}, ${role}) returning id`;
        const cookie = await createSession(
          app,
          { tenant_id: tenantId, user_id: u!.id, slug: 'x', name: role, role },
          'test',
        );
        return async (method: string, path: string, body?: unknown, key?: string) => {
          const res = await http.request(`http://core.localhost/admin/v1${path}`, {
            method,
            headers: {
              host: 'core.localhost',
              'content-type': 'application/json',
              cookie: `vendua_admin=${cookie}`,
              ...(method === 'GET'
                ? {}
                : { 'idempotency-key': key ?? `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          });
          return { status: res.status, body: (await res.json().catch(() => null)) as any };
        };
      };
      attendant = await session('attendant');
      manager = await session('manager');
    });

    test('settings: legacy unknownNumbers reads and writes as answerWho', async () => {
      const s = await manager('GET', '/vendedor/settings');
      expect(s.body.settings.answerWho).toBe('everyone');
      expect(s.body.settings.unknownNumbers).toBeUndefined();
      const legacy = await manager('PATCH', '/vendedor/settings', {
        unknownNumbers: 'shoppers_only',
      });
      expect(legacy.status).toBe(200);
      expect(legacy.body.settings.answerWho).toBe('known_and_new');
      const now = await manager('PATCH', '/vendedor/settings', { answerWho: 'known_only' });
      expect(now.body.settings.answerWho).toBe('known_only');
      expect((await manager('PATCH', '/vendedor/settings', { answerWho: 'friends' })).status).toBe(
        422,
      );
      expect(
        (await attendant('PATCH', '/vendedor/settings', { answerWho: 'everyone' })).status,
      ).toBe(403);
      const [row] = await sql<{ settings: Record<string, unknown> }[]>`
        select settings from store_agent where tenant_id = ${tenantId}`;
      expect(row!.settings.answerWho).toBe('known_only');
      expect(row!.settings.unknownNumbers).toBeUndefined();
    });

    test('classify: the owner marks a number, held messages follow', async () => {
      const a = await newThread(tenantId, { cls: 'ask' });
      await inbound(tenantId, a, 'oi');
      await ingest();
      expect(await states(a)).toEqual(['held']);
      const key = `${nonce}-classify-${a}`;
      const ok = await attendant('POST', `/vendedor/threads/${a}/classify`, { as: 'shopper' }, key);
      expect(ok.status).toBe(200);
      expect(ok.body.thread).toMatchObject({
        class: 'shopper',
        classSource: 'owner',
        classReason: 'owner_marked',
      });
      expect(await states(a)).toEqual(['pending']);
      // a retried tap replays, it doesn't classify twice
      const again = await attendant(
        'POST',
        `/vendedor/threads/${a}/classify`,
        { as: 'shopper' },
        key,
      );
      expect(again.status).toBe(200);
      expect(
        await sql`select 1 from audit_log where tenant_id = ${tenantId} and action = 'vendedor.classify'`,
      ).toHaveLength(1);

      const b = await newThread(tenantId, { cls: 'ask' });
      await inbound(tenantId, b, 'oi');
      await ingest();
      // "pessoal" erases the contact's messages: an attendant can't, a manager can
      const denied = await attendant('POST', `/vendedor/threads/${b}/classify`, { as: 'personal' });
      expect(denied.status).toBe(403);
      expect(await states(b)).toEqual(['held']);
      const p = await manager('POST', `/vendedor/threads/${b}/classify`, { as: 'personal' });
      expect(p.body.thread).toMatchObject({ class: 'personal', classReason: 'owner_marked' });
      // the conversation shows the decision, never the friend's (erased) messages
      expect(p.body.messages).toEqual([]);
      expect(await states(b)).toEqual(['skipped']);

      const test = await newThread(tenantId, { channel: 'test', cls: 'shopper' });
      expect(
        (await attendant('POST', `/vendedor/threads/${test}/classify`, { as: 'shopper' })).status,
      ).toBe(409);
      expect(
        (await attendant('POST', `/vendedor/threads/${a}/classify`, { as: 'friend' })).status,
      ).toBe(422);
      expect((await attendant('POST', `/vendedor/threads/${a}/classify`, 'x')).status).toBe(400);
      expect(
        (await attendant('POST', '/vendedor/threads/nope/classify', { as: 'shopper' })).status,
      ).toBe(400);
      expect(
        (
          await attendant('POST', `/vendedor/threads/${crypto.randomUUID()}/classify`, {
            as: 'shopper',
          })
        ).status,
      ).toBe(404);
    });

    test('pessoal after Duá spoke: the queued reply is dropped and Duá forgets the chat', async () => {
      const t = await newThread(tenantId, { cls: 'shopper' });
      const { address } = (
        await sql<{ address: string }[]>`select address from shopper_threads where id = ${t}`
      )[0]!;
      const [reply] = await sql<{ id: string }[]>`
        insert into shopper_messages (tenant_id, thread_id, author, kind, body, status)
        values (${tenantId}, ${t}, 'agent', 'text', 'Oi! Quer ver o cardápio?', 'queued') returning id`;
      await sql`insert into store_wa_messages (tenant_id, kind, jid, body, shopper_message_id, expires_at)
        values (${tenantId}, 'chat', ${address}, 'Oi! Quer ver o cardápio?', ${reply!.id},
                now() + interval '30 minutes')`;
      await sql`insert into agent_actors (tenant_id, agent_id, subject_kind, subject_id, lane)
        values (${tenantId}, 'vendedor', ${SUBJECT_KIND}, ${t}, 'interactive')`;
      const p = await manager('POST', `/vendedor/threads/${t}/classify`, { as: 'personal' });
      expect(p.status).toBe(200);
      const [out] = await sql<{ status: string }[]>`
        select status from store_wa_messages where shopper_message_id = ${reply!.id}`;
      expect(out!.status).toBe('skipped');
      expect(
        await sql`select 1 from agent_actors where tenant_id = ${tenantId} and subject_id = ${t}`,
      ).toHaveLength(0);
    });

    test('the owner answered by hand while undecided: Duá skips what was answered', async () => {
      const t = await newThread(tenantId, { cls: 'ask' });
      await inbound(tenantId, t, 'vocês abrem amanhã?');
      await ingest();
      expect(await states(t)).toEqual(['held']);
      await inbound(tenantId, t, 'abrimos às 10h!', { author: 'merchant' });
      await sql`update shopper_threads set last_merchant_at = now() where id = ${t}`;
      await ingest();
      expect(await threadRow(t)).toMatchObject({ owner: 'human', class: 'ask' });
      await inbound(tenantId, t, 'e tem pudim?');
      await ingest();
      const ok = await attendant('POST', `/vendedor/threads/${t}/classify`, { as: 'shopper' });
      expect(ok.status).toBe(200);
      // the question the owner answered stays answered; the newer one goes to Duá
      expect(await states(t)).toEqual(['skipped', 'pending']);
    });

    test('the sweeper forgets decided requests after a day', async () => {
      // a store of its own: this block's store answers everyone by now
      const { threadId, requestId } = await checking(await store());
      await sql`update store_wa_history_requests set status = 'empty', finished_at = now() - interval '2 days',
        triaged_at = now() - interval '2 days' where id = ${requestId}`;
      await triageSweep(app);
      expect((await requests(threadId)).length).toBe(0);
    });

    test('filters: para decidir with its count, pessoais, rows carry the codes', async () => {
      const ask = await newThread(tenantId, { cls: 'ask' });
      await sql`update shopper_threads set class_source = 'history', class_reason = 'unclear' where id = ${ask}`;
      const friend = await newThread(tenantId, { cls: 'personal' });
      const list = await attendant('GET', '/vendedor/threads?filter=ask');
      expect(list.status).toBe(200);
      const row = list.body.threads.find((t: { id: string }) => t.id === ask);
      expect(row).toMatchObject({ class: 'ask', classSource: 'history', classReason: 'unclear' });
      expect(list.body.threads.every((t: { class: string }) => t.class === 'ask')).toBe(true);
      expect(list.body.counts.ask).toBe(list.body.threads.length);
      const personal = await attendant('GET', '/vendedor/threads?filter=personal');
      expect(personal.body.threads.map((t: { id: string }) => t.id)).toContain(friend);
      const all = await attendant('GET', '/vendedor/threads?filter=all');
      expect(all.body.threads.map((t: { id: string }) => t.id)).not.toContain(friend);
      expect((await attendant('GET', '/vendedor/threads?filter=friends')).status).toBe(422);
      const detail = await attendant('GET', `/vendedor/threads/${ask}`);
      expect(detail.body.thread).toMatchObject({ class: 'ask', classReason: 'unclear' });
    });
  });
});
