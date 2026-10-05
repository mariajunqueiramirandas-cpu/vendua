import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pino from 'pino';
import postgres from 'postgres';
import { migrate } from '../src/platform/db.ts';
import { seal } from '../src/platform/secrets.ts';
import { phoneCommand } from '../src/store-whatsapp/content.ts';
import { Gateway } from '../src/store-whatsapp/gateway.ts';
import {
  answerFor,
  historyLines,
  sweepRequests,
  type HistorySet,
} from '../src/store-whatsapp/history.ts';
import type {
  ConnectionUpdate,
  Creds,
  OutContent,
  SocketKeys,
  WaKey,
  WaMessage,
  WaRuntime,
  WaSocket,
} from '../src/store-whatsapp/session.ts';

// Who Duá answers, the gateway's side: a new contact's chat history fetched on demand for Core's
// check (and kept nowhere but the request row), and the owner's #pessoal / #cliente / #dua.

type Msg = WaMessage & { messageTimestamp?: unknown };
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const msg = (jid: string, id: string, at: number, message: unknown, fromMe = false): Msg => ({
  key: { remoteJid: jid, id, fromMe },
  message,
  messageTimestamp: at,
});

describe('who Duá answers: pure rules', () => {
  test('a phone command is the whole message, any case, with or without the accent', () => {
    expect(phoneCommand('#pessoal')).toBe('pessoal');
    expect(phoneCommand('  #Cliente \n')).toBe('cliente');
    expect(phoneCommand('#DUÁ')).toBe('dua');
    expect(phoneCommand('#dua')).toBe('dua');
    expect(phoneCommand('#duá')).toBe('dua');
    for (const t of ['#pessoal sim', 'pessoal', '##dua', '#duo', '', null])
      expect(phoneCommand(t)).toBeNull();
  });

  test('history lines: before the anchor, oldest first, ≤10, bounded, media as placeholders', () => {
    const jid = '5521900000001@s.whatsapp.net';
    const anchorAt = new Date('2026-10-05T12:00:00Z');
    const t0 = sec(anchorAt) - 3600;
    const lines = historyLines(
      [
        msg(jid, 'b', t0 + 2, { imageMessage: { caption: 'olha' } }),
        msg(jid, 'a', t0 + 1, { conversation: 'oi sumida' }, true),
        msg(jid, 'c', t0 + 3, { audioMessage: { seconds: 3 } }),
        msg(jid, 'd', t0 + 4, { stickerMessage: {} }),
        msg(jid, 'e', t0 + 5, { reactionMessage: { text: '❤', key: { id: 'a' } } }),
        msg(jid, 'f', t0 + 6, { protocolMessage: { type: 0 } }),
        msg(jid, 'g', t0 + 7, { locationMessage: { degreesLatitude: 1 } }),
        msg(jid, 'h', t0 + 8, { conversation: 'x'.repeat(900) }),
        msg(jid, 'ANCHOR', sec(anchorAt), { conversation: 'oi' }),
        msg(jid, 'later', sec(anchorAt) + 60, { conversation: 'depois' }),
      ],
      (m) => m,
      { anchorId: 'ANCHOR', anchorAt },
    );
    expect(lines.map((l) => [l.fromMe, l.text.slice(0, 11)])).toEqual([
      [true, 'oi sumida'],
      [false, 'olha'],
      [false, '[áudio]'],
      [false, '[figurinha]'],
      [false, '[outro]'],
      [false, 'xxxxxxxxxxx'],
    ]);
    expect(lines[0]!.at).toBe(new Date((t0 + 1) * 1000).toISOString());
    expect(lines.at(-1)!.text.length).toBe(500);

    const many = Array.from({ length: 14 }, (_, i) =>
      msg(jid, `m${i}`, t0 + i, { conversation: `m${i}` }),
    );
    const ten = historyLines(many, (m) => m, { anchorId: 'x', anchorAt });
    expect(ten.map((l) => l.text)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i + 4}`));
    const emoji = Array.from({ length: 10 }, (_, i) =>
      msg(jid, `e${i}`, t0 + i, { conversation: '😀'.repeat(500) }),
    );
    const capped = historyLines(emoji, (m) => m, { anchorId: 'x', anchorAt });
    expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(16_000);
    expect(capped.at(-1)!.at).toBe(new Date((t0 + 9) * 1000).toISOString());
  });

  test('an on-demand set answers a wait by its request id or its chat, never another chat', () => {
    const pn = '5521900000001@s.whatsapp.net';
    const lid = '99887766554433@lid';
    const other = '5521900000002@s.whatsapp.net';
    const wait = { jids: new Set([pn]), sessionId: 'REQ1' };
    const mine = msg(lid, 'x', 1, { conversation: 'a' });
    const theirs = msg(other, 'y', 1, { conversation: 'b' });
    // the phone filed it under the LID: still ours, by the request id
    expect(
      answerFor({ syncType: 6, peerDataRequestSessionId: 'REQ1', messages: [mine] }, wait),
    ).toEqual([mine]);
    const byChat = msg(`${pn.split('@')[0]}:2@s.whatsapp.net`, 'z', 1, { conversation: 'c' });
    expect(answerFor({ messages: [theirs, byChat] }, { ...wait, sessionId: null })).toEqual([
      byChat,
    ]);
    expect(answerFor({ chats: [{ id: pn }], messages: [] }, wait)).toEqual([]);
    expect(answerFor({ chats: [{ id: other }], messages: [theirs] }, wait)).toBeNull();
    // our request answered with nothing: no prior chat
    expect(
      answerFor({ syncType: 6, peerDataRequestSessionId: 'REQ1', messages: [] }, wait),
    ).toEqual([]);
    // our request answered with two other chats: can't tell which is ours, so none is taken
    expect(
      answerFor({ syncType: 6, peerDataRequestSessionId: 'REQ1', messages: [mine, theirs] }, wait),
    ).toBeNull();
  });
});

type Handler = (payload: never) => void;
interface Fetch {
  count: number;
  key: { remoteJid: string; id: string; fromMe: boolean };
  ts: number;
  id: string;
}

class FakeSocket implements WaSocket {
  private handlers = new Map<string, Handler[]>();
  sent: { jid: string; content: OutContent | { delete: WaKey } }[] = [];
  fetches: Fetch[] = [];
  user: WaSocket['user'] = undefined;
  failDeletes = false;
  signalRepository = {
    lidMapping: {
      getPNForLID: async (lid: string) => this.world.lids.get(lid) ?? null,
      getLIDForPN: async (pn: string) =>
        [...this.world.lids].find(([, p]) => p === pn)?.[0] ?? null,
    },
  };
  ev = {
    on: (event: string, cb: Handler) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    },
  } as WaSocket['ev'];

  constructor(
    readonly creds: Creds,
    readonly keys: SocketKeys,
    private world: FakeWorld,
    /** baileys' shouldSyncHistoryMessage for ON_DEMAND */
    readonly wantsOnDemand: () => boolean,
  ) {}

  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload as never);
  }
  connection(u: ConnectionUpdate) {
    this.emit('connection.update', u);
  }
  inbound(...messages: WaMessage[]) {
    this.emit('messages.upsert', { type: 'notify', messages });
  }
  /** what the phone sends back, through baileys' gate like the real socket */
  historyAnswer(h: HistorySet) {
    if (this.wantsOnDemand()) this.emit('messaging-history.set', { syncType: 6, ...h });
  }
  async fetchMessageHistory(
    count: number,
    key: { remoteJid: string; id: string; fromMe: boolean },
    ts: number,
  ) {
    const f = { count, key, ts, id: `PDO${this.fetches.length + 1}` };
    this.fetches.push(f);
    const answer = this.world.answer;
    if (answer) setTimeout(() => this.historyAnswer(answer(f)), 20);
    return f.id;
  }
  async requestPairingCode() {
    return 'ABCD1234';
  }
  async onWhatsApp(...jids: string[]) {
    return jids.map((jid) => ({ jid, exists: true }));
  }
  async sendMessage(jid: string, content: OutContent | { delete: WaKey }) {
    this.sent.push({ jid, content });
    if ('delete' in content && this.failDeletes) throw new Error('revoke refused');
    return { key: { id: 'x' } };
  }
  async updateMediaMessage(m: WaMessage) {
    return m;
  }
  async presenceSubscribe() {}
  async sendPresenceUpdate() {}
  async logout() {}
  end() {}
}

class FakeWorld {
  sockets: FakeSocket[] = [];
  lids = new Map<string, string>();
  answer: ((f: Fetch) => HistorySet) | null = null;
  get last(): FakeSocket {
    return this.sockets[this.sockets.length - 1]!;
  }
  runtime(): WaRuntime {
    return {
      codec: { replacer: (_k, v) => v, reviver: (_k, v) => v },
      initCreds: () => ({}),
      normalize: (m) => m,
      download: async () => new Uint8Array(),
      connect: async ({ creds, keys, wantsOnDemand }) => {
        const s = new FakeSocket(creds, keys, this, () => !!wantsOnDemand?.());
        this.sockets.push(s);
        return s;
      },
    };
  }
}

async function until(cond: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.TEST_DATABASE_URL)('who Duá answers: gateway (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const jidA = `55218${stamp}1@s.whatsapp.net`;
  const jidB = `55218${stamp}2@s.whatsapp.net`;
  const pnC = `55218${stamp}3@s.whatsapp.net`;
  const lidC = `${stamp}87654321@lid`;
  const world = new FakeWorld();
  const notes: string[] = [];
  let unlisten: (() => Promise<void>) | null = null;
  let tenantId = '';
  let loneTenant = '';
  let gw: Gateway | null = null;
  let seq = 0;

  const text = (jid: string, body: string, fromMe = false): WaMessage => ({
    key: { remoteJid: jid, id: `h-${nonce}-${++seq}`, fromMe },
    message: { conversation: body },
    pushName: fromMe ? null : 'Bia',
  });
  const convo = () =>
    sql<Record<string, any>[]>`
      select m.*, t.address, t.last_merchant_at from shopper_messages m
        join shopper_threads t on t.id = m.thread_id
      where m.tenant_id = ${tenantId} order by m.created_at`;
  const request = (id: string) =>
    sql<Record<string, any>[]>`select * from store_wa_history_requests where id = ${id}`.then(
      (r) => r[0]!,
    );

  /** Core's side, as the spec has it: a shopper's message arrives, Core asks for its chat */
  const ask = async (jid: string, body: string, opts: { createdAgo?: number } = {}) => {
    const m = text(jid, body);
    const waId = m.key!.id!;
    world.last.inbound(m);
    await until(async () => (await convo()).some((r) => r.wa_id === waId));
    const row = (await convo()).find((r) => r.wa_id === waId)!;
    const id = (
      await sql<{ id: string }[]>`
        insert into store_wa_history_requests (tenant_id, thread_id, address, anchor_wa_id,
                                               anchor_at, created_at)
        values (${tenantId}, ${row.thread_id}, ${row.address}, ${waId}, ${row.created_at},
                now() - ${`${opts.createdAgo ?? 0} seconds`}::interval)
        returning id`
    )[0]!.id;
    return { id, anchor: m, anchorAt: row.created_at as Date };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`wah-${nonce}`}, ${'Doce ' + nonce}) returning id`
    )[0]!.id;
    loneTenant = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`wah2-${nonce}`}, ${'Bolo ' + nonce}) returning id`
    )[0]!.id;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'open')`;
    await sql`
      insert into store_wa_auth (tenant_id, category, name, data)
      values (${tenantId}, 'creds', 'main', ${JSON.stringify(seal(JSON.stringify({ registered: true }), 's'))})`;
    const sub = await sql.listen('vendua_history', (p) => notes.push(p));
    unlisten = () => sub.unlisten();
    gw = new Gateway({
      sql: appSql,
      runtime: world.runtime(),
      sealSecret: 's',
      id: `gwh-${nonce}`,
      listen: false,
      tickMs: 3_600_000,
      leaseMs: 600_000,
      agentGateMs: 0,
      historyTimeoutMs: 300,
      reconnectDelay: () => 5,
      tenants: [tenantId],
      log: pino({ level: 'silent' }),
    });
    await gw.tick();
    await until(() => world.sockets.length > 0);
    world.last.user = { id: '5521999990000:7@s.whatsapp.net', name: 'Loja' };
    world.last.connection({ connection: 'open' });
    await until(
      async () =>
        (await sql`select 1 from store_whatsapp where tenant_id = ${tenantId} and state = 'open'`)
          .length > 0,
    );
  });

  afterAll(async () => {
    await gw?.stop();
    await unlisten?.();
    await sql`delete from wa_gateways where id = ${`gwh-${nonce}`}`;
    for (const t of [tenantId, loneTenant].filter(Boolean)) {
      await sql`delete from staff_events where tenant_id = ${t}`;
      await sql`delete from tenants where id = ${t}`;
    }
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('Vendedor off: a phone command is left alone', async () => {
    const s = world.last;
    s.inbound(text(jidA, '#pessoal', true));
    await pause(150);
    expect(s.sent).toEqual([]);
    expect((await convo()).length).toBe(0);
  });

  test('a command is stored for Core and revoked at once; other texts from the phone are not', async () => {
    await sql`insert into store_agent (tenant_id, enabled) values (${tenantId}, true)`;
    const s = world.last;
    const cmd = text(jidA, ' #Duá ', true);
    s.inbound(cmd);
    await until(async () => (await convo()).length === 1);
    await until(() => s.sent.length === 1);
    const [row] = await convo();
    expect([row!.author, row!.kind, row!.body, row!.ingest]).toEqual([
      'merchant',
      'command',
      'dua',
      'pending',
    ]);
    // deciding who Duá answers isn't the owner answering the contact
    expect(row!.last_merchant_at).toBeNull();
    expect(s.sent[0]).toEqual({
      jid: jidA,
      content: { delete: { remoteJid: jidA, id: cmd.key!.id!, fromMe: true } },
    });

    s.inbound(text(jidA, '#pessoal depois falo', true));
    await until(async () => (await convo()).length === 2);
    await pause(100);
    const plain = (await convo())[1]!;
    expect([plain.kind, plain.body]).toEqual(['text', '#pessoal depois falo']);
    expect(plain.last_merchant_at).not.toBeNull();
    expect(s.sent.length).toBe(1);

    // a revoke WhatsApp refuses is logged, the command still counts, and nothing loops
    s.failDeletes = true;
    s.inbound(text(jidA, '#cliente', true));
    await until(async () => (await convo()).some((r) => r.body === 'cliente'));
    await pause(150);
    expect(s.sent.filter((x) => 'delete' in x.content).length).toBe(2);
    s.failDeletes = false;
  });

  test('a personal contact: nothing they send is stored, owner commands still are', async () => {
    await sql`insert into store_agent (tenant_id, enabled) values (${tenantId}, true)
      on conflict (tenant_id) do update set enabled = true`;
    const s = world.last;
    const jidD = `55218${stamp}4@s.whatsapp.net`;
    const mine = async () => (await convo()).filter((r) => r.address === jidD);
    s.inbound(text(jidD, 'oi, tudo bem?'));
    await until(async () => (await mine()).length === 1);
    await sql`update shopper_threads set class = 'personal'
      where tenant_id = ${tenantId} and address = ${jidD}`;
    s.inbound(text(jidD, 'bora no churrasco sábado?'));
    s.inbound(text(jidD, 'kkk fechado', true));
    await pause(200);
    expect((await mine()).length).toBe(1);
    s.inbound(text(jidD, '#cliente', true));
    await until(async () => (await mine()).some((r) => r.kind === 'command'));
    expect((await mine()).length).toBe(2);
  });

  test('history: the chat answer lands on the request row only, oldest first', async () => {
    const s = world.last;
    const before = (await convo()).length;
    expect(s.wantsOnDemand()).toBe(false);
    world.answer = (f) => {
      const t = sec(new Date()) - 600;
      return {
        peerDataRequestSessionId: f.id,
        chats: [{ id: jidB }],
        messages: [
          msg(jidB, 'old2', t + 2, { conversation: 'bora no churrasco sábado?' }, true),
          msg(jidB, 'old1', t + 1, { conversation: 'oi primo' }),
          msg(jidB, f.key.id, sec(new Date()), { conversation: 'oi, tudo bem?' }),
        ],
      };
    };
    const { id, anchor, anchorAt } = await ask(jidB, 'oi, tudo bem?');
    await gw!.tick();
    await until(async () => (await request(id)).status === 'done');
    const r = await request(id);
    expect(r.failure).toBeNull();
    expect(r.finished_at).not.toBeNull();
    expect(r.messages.map((m: any) => [m.fromMe, m.text])).toEqual([
      [false, 'oi primo'],
      [true, 'bora no churrasco sábado?'],
    ]);
    const f = s.fetches.at(-1)!;
    expect(f.count).toBe(10);
    expect(f.key).toEqual({ remoteJid: jidB, id: anchor.key!.id!, fromMe: false });
    expect(f.ts).toBe(anchorAt.getTime());
    expect(notes).toContain(`${tenantId}|${id}`);
    // nothing of the answer became a conversation message, and the gate is shut again
    expect((await convo()).length).toBe(before + 1);
    expect(s.wantsOnDemand()).toBe(false);
  });

  test('history: no prior chat is empty; a LID chat is asked for as delivered', async () => {
    world.answer = (f) => ({ peerDataRequestSessionId: f.id, chats: [], messages: [] });
    const a = await ask(jidA, 'vocês entregam?');
    await gw!.tick();
    await until(async () => (await request(a.id)).status === 'empty');
    expect((await request(a.id)).messages).toBeNull();

    // the shopper writes on a LID the device maps to a number: the thread is the number's, the
    // phone files the chat under the LID
    world.lids.set(lidC, pnC);
    world.answer = (f) => ({
      peerDataRequestSessionId: 'something-else',
      messages: [msg(lidC, 'c1', sec(new Date()) - 60, { conversation: 'mãe, chego às 8' }, true)],
    });
    const c = await ask(lidC, 'ok filho');
    const [thread] = await sql`
      select t.address from shopper_threads t join store_wa_history_requests r on r.thread_id = t.id
      where r.id = ${c.id}`;
    expect(thread!.address).toBe(pnC);
    await gw!.tick();
    await until(async () => (await request(c.id)).status === 'done');
    expect(world.last.fetches.at(-1)!.key.remoteJid).toBe(lidC);
    expect((await request(c.id)).messages.map((m: any) => m.text)).toEqual(['mãe, chego às 8']);
  });

  test('history: no answer in time fails as timeout; a late answer is dropped', async () => {
    world.answer = null;
    const { id } = await ask(jidB, 'alô?');
    await gw!.tick();
    await until(async () => (await request(id)).status === 'failed');
    expect((await request(id)).failure).toBe('timeout');
    expect(world.last.wantsOnDemand()).toBe(false);
    // WhatsApp answering after we gave up goes nowhere: the gate is shut
    world.last.historyAnswer({ messages: [msg(jidB, 'late', 1, { conversation: 'oi' })] });
    await pause(50);
    expect((await request(id)).messages).toBeNull();
    expect(notes.filter((n) => n === `${tenantId}|${id}`).length).toBe(1);
  });

  test('history: a store no gateway holds fails no_session; a dropped socket fails offline', async () => {
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${loneTenant}, true, 'open')`;
    const t = (
      await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address)
        values (${loneTenant}, 'whatsapp', ${jidA}) returning id`
    )[0]!.id;
    const lone = (
      await sql<{ id: string }[]>`
        insert into store_wa_history_requests (tenant_id, thread_id, address, anchor_wa_id, anchor_at,
                                               created_at)
        values (${loneTenant}, ${t}, ${jidA}, 'X1', now(), now() - interval '20 seconds')
        returning id`
    )[0]!.id;
    await sweepRequests(appSql, [], [loneTenant]);
    const r = await request(lone);
    expect([r.status, r.failure]).toEqual(['failed', 'no_session']);
    expect(notes).toContain(`${loneTenant}|${lone}`);

    // the store's socket dropped and hasn't come back within the answer's time: offline
    const { id } = await ask(jidB, 'tem bolo?', { createdAgo: 1 });
    world.last.connection({
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    await until(() => gw!.sessionOf(tenantId)?.state === 'connecting');
    await gw!.tick();
    await until(async () => (await request(id)).status === 'failed');
    expect((await request(id)).failure).toBe('offline');
  });
});
