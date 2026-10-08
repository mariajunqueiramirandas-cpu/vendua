import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pino from 'pino';
import postgres from 'postgres';
import { migrate } from '../src/platform/db.ts';
import { seal } from '../src/platform/secrets.ts';
import { parseContent } from '../src/store-whatsapp/content.ts';
import { Gateway, type GatewayOptions } from '../src/store-whatsapp/gateway.ts';
import type {
  ConnectionUpdate,
  Creds,
  OutContent,
  SocketKeys,
  WaMessage,
  WaRuntime,
  WaSocket,
} from '../src/store-whatsapp/session.ts';
import { messageIdFor, threadPhoneForJid, userJid } from '../src/store-whatsapp/text.ts';

// ADR 0031 on top of ADR 0026: a store with the Vendedor on records every 1:1 conversation,
// paces the Vendedor's replies per conversation and mirrors their fate back.

describe('vendedor gateway: pure rules', () => {
  test('a thread phone keeps foreign numbers; LIDs and device parts resolve', () => {
    expect(threadPhoneForJid('5511987654321@s.whatsapp.net')).toBe('11987654321');
    expect(threadPhoneForJid('14155550100:2@s.whatsapp.net')).toBe('+14155550100');
    expect(threadPhoneForJid('123456789012345@lid')).toBeNull();
    expect(userJid('5511987654321:3@s.whatsapp.net')).toBe('5511987654321@s.whatsapp.net');
    expect(userJid('120363000000000000@g.us')).toBeNull();
    expect(userJid('status@broadcast')).toBeNull();
  });

  test('content kinds, captions and bounds', () => {
    expect(parseContent({ conversation: 'x'.repeat(5000) })!.body!.length).toBe(4000);
    const quoted = parseContent({
      extendedTextMessage: { text: 'esse', contextInfo: { stanzaId: 'Q1' } },
    })!;
    expect(quoted.quotedId).toBe('Q1');
    const doc = parseContent({
      documentMessage: { caption: 'cardápio', mimetype: 'application/pdf' },
    })!;
    expect([doc.kind, doc.body]).toEqual(['document', 'cardápio']);
    expect(parseContent({ stickerMessage: {} })!.kind).toBe('sticker');
    expect(parseContent({ contactMessage: { displayName: 'Zé' } })!.body).toBeNull();
    expect(parseContent({ videoMessage: { caption: 'olha' } })!.body).toBe('olha');
    expect(parseContent({ protocolMessage: { type: 0 } })).toBeNull();
    expect(parseContent({ senderKeyDistributionMessage: {} })).toBeNull();
    const r = parseContent({ reactionMessage: { text: '👍', key: { id: 'T1' } } })!;
    expect([r.kind, r.meta.emoji, r.meta.target]).toEqual(['reaction', '👍', 'T1']);
  });
});

type Handler = (payload: never) => void;
interface Sent {
  jid: string;
  content: OutContent;
  id?: string | undefined;
  at: number;
}

class FakeSocket implements WaSocket {
  private handlers = new Map<string, Handler[]>();
  sent: Sent[] = [];
  probes: string[][] = [];
  subscribed: string[] = [];
  presence: [string, string][] = [];
  user: WaSocket['user'] = undefined;
  signalRepository = {
    lidMapping: { getPNForLID: async (lid: string) => this.world.lids.get(lid) ?? null },
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
  ) {}

  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload as never);
  }
  connection(u: ConnectionUpdate) {
    this.emit('connection.update', u);
  }
  inbound(type: 'notify' | 'append', ...messages: WaMessage[]) {
    this.emit('messages.upsert', { type, messages });
  }
  async requestPairingCode() {
    return 'ABCD1234';
  }
  async onWhatsApp(...jids: string[]) {
    this.probes.push(jids);
    return jids.map((jid) => ({ jid, exists: this.world.registered.has(jid) }));
  }
  async sendMessage(jid: string, content: OutContent, opts?: { messageId?: string }) {
    this.sent.push({ jid, content, id: opts?.messageId, at: Date.now() });
    return { key: { id: opts?.messageId ?? 'x' } };
  }
  async updateMediaMessage(m: WaMessage) {
    return m;
  }
  async presenceSubscribe(jid: string) {
    this.subscribed.push(jid);
  }
  async sendPresenceUpdate(type: string, jid: string) {
    this.presence.push([type, jid]);
  }
  async logout() {}
  end() {}
}

class FakeWorld {
  sockets: FakeSocket[] = [];
  registered = new Set<string>();
  lids = new Map<string, string>();
  /** media bytes by message id */
  media = new Map<string, Uint8Array>();
  get last(): FakeSocket {
    return this.sockets[this.sockets.length - 1]!;
  }
  runtime(): WaRuntime {
    return {
      codec: { replacer: (_k, v) => v, reviver: (_k, v) => v },
      initCreds: () => ({}),
      normalize: (m) => m,
      download: async (m) => {
        const b = this.media.get(m.key?.id ?? '');
        if (!b) throw new Error('media gone');
        return b;
      },
      connect: async ({ creds, keys }) => {
        const s = new FakeSocket(creds, keys, this);
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('vendedor gateway (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const shopperPhone = `219${stamp}1`;
  const shopperJid = `55${shopperPhone}@s.whatsapp.net`;
  const otherJid = `55219${stamp}2@s.whatsapp.net`;
  const silent = pino({ level: 'silent' });
  const world = new FakeWorld();
  const notes: string[] = [];
  let unlisten: (() => Promise<void>) | null = null;
  let tenantId = '';
  let gw: Gateway | null = null;
  let seq = 0;

  const text = (jid: string, body: string, extra: Partial<WaMessage> = {}): WaMessage => ({
    key: { remoteJid: jid, id: `in-${nonce}-${++seq}` },
    message: { conversation: body },
    pushName: 'Bia',
    ...extra,
  });
  const threads = () =>
    sql<Record<string, any>[]>`
      select * from shopper_threads where tenant_id = ${tenantId} order by created_at`;
  const convo = () =>
    sql<Record<string, any>[]>`
      select m.*, t.address, d.bytes, d.seconds as media_seconds, d.mime as media_mime
      from shopper_messages m join shopper_threads t on t.id = m.thread_id
        left join shopper_media d on d.message_id = m.id
      where m.tenant_id = ${tenantId} order by m.created_at`;
  const outbox = () =>
    sql<Record<string, any>[]>`
      select * from store_wa_messages where tenant_id = ${tenantId} order by created_at`;

  const startGateway = async (opts: Partial<GatewayOptions> = {}) => {
    if (gw) await gw.stop();
    gw = new Gateway({
      sql: appSql,
      runtime: world.runtime(),
      sealSecret: 's',
      id: `gw-${nonce}-${++seq}`,
      listen: false,
      tickMs: 3_600_000,
      leaseMs: 600_000,
      minSendGapMs: 1,
      conversationGapMs: 1,
      chatGapMs: 1,
      agentGateMs: 0,
      reconnectDelay: () => 5,
      tenants: [tenantId],
      log: silent,
      ...opts,
    });
    const n = world.sockets.length;
    await gw.tick();
    await until(() => world.sockets.length > n);
    world.last.user = { id: '5521999990000:7@s.whatsapp.net', name: 'Loja' };
    world.last.connection({ connection: 'open' });
    await until(
      async () =>
        (await sql`select 1 from store_whatsapp where tenant_id = ${tenantId} and state = 'open'`)
          .length > 0,
    );
    return gw;
  };

  const chatRow = async (o: {
    jid?: string | null;
    phone?: string | null;
    body?: string;
    mediaId?: string | null;
    threadId?: string;
  }) => {
    const sm = o.threadId
      ? (
          await sql<{ id: string }[]>`
            insert into shopper_messages (tenant_id, thread_id, author, kind, body, status)
            values (${tenantId}, ${o.threadId}, 'agent', ${o.mediaId ? 'audio' : 'text'},
                    ${o.body ?? 'oi'}, 'queued')
            returning id`
        )[0]!.id
      : null;
    return (
      await sql<{ id: string }[]>`
        insert into store_wa_messages (tenant_id, kind, jid, phone, body, media_id, shopper_message_id)
        values (${tenantId}, 'chat', ${o.jid ?? null}, ${o.phone ?? null}, ${o.body ?? 'oi'},
                ${o.mediaId ?? null}, ${sm})
        returning id`
    )[0]!.id;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`wav-${nonce}`}, ${'Doce ' + nonce}) returning id`
    )[0]!.id;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'open')`;
    await sql`
      insert into store_wa_auth (tenant_id, category, name, data)
      values (${tenantId}, 'creds', 'main', ${JSON.stringify(seal(JSON.stringify({ registered: true }), 's'))})`;
    world.registered.add(shopperJid);
    const sub = await sql.listen('vendua_shopper', (p) => {
      if (p.startsWith(tenantId)) notes.push(p);
    });
    unlisten = () => sub.unlisten();
    await startGateway();
  });

  afterAll(async () => {
    await gw?.stop();
    await unlisten?.();
    await sql`delete from wa_gateways where id like ${'gw-' + nonce + '%'}`;
    if (tenantId) {
      await sql`delete from staff_events where tenant_id = ${tenantId}`;
      await sql`delete from tenants where id = ${tenantId}`;
    }
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('Vendedor off: nothing is recorded, SAIR still works', async () => {
    await sql`
      insert into store_wa_messages (tenant_id, kind, event, phone, body, status, sent_at)
      values (${tenantId}, 'order', 'placed', ${shopperPhone}, 'pedido', 'sent', now())`;
    const s = world.last;
    s.inbound('notify', text(shopperJid, 'tem bolo?'));
    s.inbound('notify', {
      key: { remoteJid: shopperJid, id: `img-${nonce}-0` },
      message: { imageMessage: { mimetype: 'image/jpeg' } },
    });
    s.inbound(
      'notify',
      text(shopperJid, 'oi', { key: { remoteJid: shopperJid, fromMe: true, id: `me-${nonce}-0` } }),
    );
    s.inbound('notify', text(shopperJid, 'SAIR'));
    await until(async () =>
      (await outbox()).some((m) => m.kind === 'opt_out' && m.status === 'sent'),
    );
    expect((await threads()).length).toBe(0);
    expect((await convo()).length).toBe(0);
    expect(s.subscribed).toEqual([]);
    const outs = await sql`select phone from store_wa_optouts where tenant_id = ${tenantId}`;
    expect(outs.map((o) => o.phone)).toEqual([shopperPhone]);
    await sql`delete from store_wa_optouts where tenant_id = ${tenantId}`;
    await sql`delete from store_wa_messages where tenant_id = ${tenantId} and kind = 'opt_out'`;
  });

  test('Vendedor on: text, audio, image and location land in one thread, with media', async () => {
    await sql`insert into store_agent (tenant_id, enabled) values (${tenantId}, true)`;
    const s = world.last;
    const first = text(shopperJid, 'tem bolo de cenoura?');
    s.inbound('notify', first);
    world.media.set(`aud-${nonce}`, new Uint8Array([1, 2, 3, 4]));
    s.inbound('notify', {
      key: { remoteJid: shopperJid, id: `aud-${nonce}` },
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 7, ptt: true } },
      pushName: 'Bia',
    });
    world.media.set(`img-${nonce}`, new Uint8Array([9, 9]));
    s.inbound('notify', {
      key: { remoteJid: shopperJid, id: `img-${nonce}` },
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'esse aqui', fileLength: 2 } },
    });
    s.inbound('notify', {
      key: { remoteJid: shopperJid, id: `loc-${nonce}` },
      message: {
        locationMessage: {
          degreesLatitude: -22.9,
          degreesLongitude: -43.2,
          name: 'Casa',
          address: 'Rua A, 1',
        },
      },
    });
    // too long a voice note keeps its place, without the bytes
    world.media.set(`long-${nonce}`, new Uint8Array([1]));
    s.inbound('notify', {
      key: { remoteJid: shopperJid, id: `long-${nonce}` },
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 200 } },
    });
    await until(async () => (await convo()).length === 5);
    const [t] = await threads();
    expect(t!.address).toBe(shopperJid);
    expect(t!.phone).toBe(shopperPhone);
    expect(t!.profile_name).toBe('Bia');
    expect(t!.last_in_at).not.toBeNull();
    expect(t!.pending_since).not.toBeNull();
    const rows = await convo();
    expect(rows.map((r) => r.kind)).toEqual(['text', 'audio', 'image', 'location', 'audio']);
    expect(rows.every((r) => r.author === 'shopper' && r.status === 'received')).toBe(true);
    expect(rows.every((r) => r.ingest === 'pending')).toBe(true);
    expect(rows[0]!.body).toBe('tem bolo de cenoura?');
    expect(rows[0]!.wa_id).toBe(first.key!.id);
    expect([...rows[1]!.bytes]).toEqual([1, 2, 3, 4]);
    expect(rows[1]!.media_seconds).toBe(7);
    expect(rows[1]!.meta).toMatchObject({ mime: 'audio/ogg; codecs=opus', seconds: 7 });
    expect(rows[2]!.body).toBe('esse aqui');
    expect([...rows[2]!.bytes]).toEqual([9, 9]);
    expect(rows[3]!.meta).toEqual({ lat: -22.9, lng: -43.2, name: 'Casa', address: 'Rua A, 1' });
    expect(rows[4]!.bytes).toBeNull();
    expect(rows[4]!.meta.skipped).toBe('too_long');
    // Core's ingest hears each one; the shopper's typing is watched
    await until(() => notes.filter((n) => !n.includes('|presence|')).length >= 5);
    expect(notes).toContain(`${tenantId}|${rows[0]!.id}`);
    expect(s.subscribed).toEqual([shopperJid]);
  });

  test('a fourth photo within a minute is recorded but not downloaded', async () => {
    const s = world.last;
    for (let i = 1; i <= 3; i++) {
      world.media.set(`img-${nonce}-${i}`, new Uint8Array([i]));
      s.inbound('notify', {
        key: { remoteJid: shopperJid, id: `img-${nonce}-${i}` },
        message: { imageMessage: { mimetype: 'image/jpeg' } },
      });
    }
    await until(async () => (await convo()).length === 8);
    const imgs = (await convo()).filter((r) => r.kind === 'image');
    expect(imgs.length).toBe(4);
    expect(imgs.filter((r) => r.bytes).length).toBe(3);
    expect(imgs.at(-1)!.meta.skipped).toBe('rate');
  });

  test('a re-delivered message is stored once', async () => {
    const m = text(shopperJid, 'de novo');
    world.last.inbound('notify', m);
    world.last.inbound('append', m);
    await until(async () => (await convo()).some((r) => r.body === 'de novo'));
    await pause(100);
    expect((await convo()).filter((r) => r.body === 'de novo').length).toBe(1);
  });

  test('typed on the store phone: stored as merchant; our own echo is not', async () => {
    const [t] = await threads();
    const id = await chatRow({ jid: shopperJid, body: 'temos sim!', threadId: t!.id });
    gw!.pump(tenantId);
    await until(async () => (await outbox()).find((m) => m.id === id)?.status === 'sent');
    const s = world.last;
    // baileys echoes what we sent with the id we chose
    s.inbound('append', {
      key: { remoteJid: shopperJid, fromMe: true, id: messageIdFor(id) },
      message: { conversation: 'temos sim!' },
    });
    s.inbound('notify', {
      key: { remoteJid: shopperJid, fromMe: true, id: `me-${nonce}-1` },
      message: { conversation: 'aqui é a Rita, já separo pra você' },
      pushName: 'Rita (loja)',
    });
    await until(async () => (await convo()).some((r) => r.author === 'merchant'));
    await pause(100);
    const rows = await convo();
    expect(rows.filter((r) => r.author === 'merchant').map((r) => r.body)).toEqual([
      'aqui é a Rita, já separo pra você',
    ]);
    // the agent's row is the only copy of the reply, now carrying its WhatsApp id
    const agent = rows.filter((r) => r.author === 'agent');
    expect(agent.map((r) => [r.body, r.status, r.wa_id])).toEqual([
      ['temos sim!', 'sent', messageIdFor(id)],
    ]);
    const [after] = await threads();
    expect(after!.profile_name).toBe('Bia');
    expect(after!.last_merchant_at).not.toBeNull();
    expect(after!.pending_since).toBeNull();
    // ticks move the reply on
    s.emit('messages.update', [
      { key: { id: messageIdFor(id), fromMe: true }, update: { status: 3 } },
    ]);
    await until(
      async () => (await convo()).find((r) => r.author === 'agent')!.status === 'delivered',
    );
    s.emit('messages.update', [
      { key: { id: messageIdFor(id), fromMe: true }, update: { status: 4 } },
    ]);
    await until(async () => (await convo()).find((r) => r.author === 'agent')!.status === 'read');
    s.emit('messages.update', [
      { key: { id: messageIdFor(id), fromMe: true }, update: { status: 3 } },
    ]);
    await pause(100);
    expect((await convo()).find((r) => r.author === 'agent')!.status).toBe('read');
  });

  test('a LID-only shopper gets a thread with no phone and is answered by jid', async () => {
    const lid = `${stamp}12345678@lid`;
    world.last.inbound('notify', text(lid, 'boa noite'));
    await until(async () => (await threads()).some((t) => t.address === lid));
    const t = (await threads()).find((x) => x.address === lid)!;
    expect(t.phone).toBeNull();
    const probes = world.last.probes.length;
    const id = await chatRow({ jid: lid, body: 'boa noite! em que posso ajudar?', threadId: t.id });
    gw!.pump(tenantId);
    await until(async () => (await outbox()).find((m) => m.id === id)?.status === 'sent');
    expect(world.last.sent.at(-1)!.jid).toBe(lid);
    expect(world.last.probes.length).toBe(probes);

    // once WhatsApp maps it, the same conversation moves to the number
    world.lids.set(lid, `55219${stamp}3:0@s.whatsapp.net`);
    world.last.inbound('notify', text(lid, 'quero um bolo'));
    await until(async () => (await threads()).some((x) => x.id === t.id && x.phone));
    const moved = (await threads()).find((x) => x.id === t.id)!;
    expect(moved.address).toBe(`55219${stamp}3@s.whatsapp.net`);
    expect(moved.phone).toBe(`219${stamp}3`);
  });

  test('a foreign number keeps its country code', async () => {
    const jid = `1415${stamp}0@s.whatsapp.net`;
    world.last.inbound('notify', text(jid, 'hello'));
    await until(async () => (await threads()).some((t) => t.address === jid));
    expect((await threads()).find((t) => t.address === jid)!.phone).toBe(`+1415${stamp}0`);
  });

  test('typing: the shopper\'s marks the thread (throttled), Core\'s shows "digitando"', async () => {
    const [t] = await threads();
    const before = notes.length;
    const s = world.last;
    const composing = {
      id: shopperJid,
      presences: { [shopperJid]: { lastKnownPresence: 'composing' } },
    };
    s.emit('presence.update', composing);
    s.emit('presence.update', composing);
    s.emit('presence.update', {
      id: shopperJid,
      presences: { [shopperJid]: { lastKnownPresence: 'paused' } },
    });
    await until(() => notes.length > before);
    await pause(150);
    expect(notes.slice(before)).toEqual([`${tenantId}|presence|${t!.id}`]);
    expect((await threads())[0]!.typing_at).not.toBeNull();

    (gw as unknown as { onNotify(p: string): void }).onNotify(`${tenantId}|typing|${t!.id}`);
    (gw as unknown as { onNotify(p: string): void }).onNotify(`${tenantId}|typing|not-a-uuid`);
    await until(() => s.presence.length > 0);
    expect(s.presence).toEqual([['composing', shopperJid]]);
  });

  test('SAIR from a shopper still opts out with the Vendedor on, and is in the thread', async () => {
    world.last.inbound('notify', text(shopperJid, 'sair'));
    await until(async () =>
      (await outbox()).some((m) => m.kind === 'opt_out' && m.status === 'sent'),
    );
    expect((await sql`select 1 from store_wa_optouts where tenant_id = ${tenantId}`).length).toBe(
      1,
    );
    expect((await convo()).some((r) => r.body === 'sair' && r.author === 'shopper')).toBe(true);
    await sql`delete from store_wa_optouts where tenant_id = ${tenantId}`;
  });

  test('SAIR after only Vendedor messages (a nudge, a reply) opts out too', async () => {
    await sql`delete from store_wa_messages where tenant_id = ${tenantId} and kind = 'order'`;
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, jid, body, status, sent_at)
      values (${tenantId}, 'chat', ${shopperPhone}, ${shopperJid}, 'Sua sacola ainda está aqui', 'sent', now())`;
    world.last.inbound('notify', text(shopperJid, 'SAIR'));
    await until(
      async () =>
        (await sql`select 1 from store_wa_optouts where tenant_id = ${tenantId}`).length > 0,
    );
    await sql`delete from store_wa_optouts where tenant_id = ${tenantId}`;
  });

  test('pacing: replies skip the hourly ceiling, keep a gap per conversation, and share the line', async () => {
    gw = await startGateway({
      maxPerHour: 2,
      chatGapMs: 400,
      conversationGapMs: 20,
      minSendGapMs: 100,
    });
    world.registered.add(otherJid);
    const [t] = await threads();
    await sql`delete from store_wa_messages where tenant_id = ${tenantId}`;
    for (let i = 0; i < 4; i++)
      await sql`
        insert into store_wa_messages (tenant_id, kind, phone, body)
        values (${tenantId}, 'test', ${shopperPhone}, ${'aviso ' + i})`;
    const a = [
      await chatRow({ jid: shopperJid, body: 'a1', threadId: t!.id }),
      await chatRow({ jid: shopperJid, body: 'a2', threadId: t!.id }),
      await chatRow({ jid: shopperJid, body: 'a3', threadId: t!.id }),
    ];
    await chatRow({ jid: otherJid, body: 'b1' });
    await chatRow({ jid: otherJid, body: 'b2' });
    gw.pump(tenantId);
    await until(
      async () =>
        (await outbox()).filter((m) => m.kind === 'chat' && m.status === 'sent').length === 5,
    );
    await pause(300);
    const rows = await outbox();
    // the ceiling held the notices, not the replies
    expect(rows.filter((m) => m.kind === 'test' && m.status === 'sent').length).toBe(2);
    expect(rows.filter((m) => m.kind === 'test' && m.status === 'pending').length).toBe(2);
    const sent = world.last.sent;
    const textOf = (x: Sent) => ('text' in x.content ? x.content.text : '');
    const at = (body: string) => sent.find((x) => textOf(x) === body)!.at;
    expect(at('a2') - at('a1')).toBeGreaterThanOrEqual(390);
    expect(at('a3') - at('a2')).toBeGreaterThanOrEqual(390);
    // another conversation doesn't wait for this one's gap
    expect(Math.abs(at('b1') - at('a1'))).toBeLessThan(390);
    // a notice went out between the replies, not after all of them
    const order = sent.map(textOf);
    expect(order.indexOf('aviso 0')).toBeLessThan(order.indexOf('a3'));
    // each reply's conversation message says it went
    const mirrored = await sql<{ status: string }[]>`
      select status from shopper_messages where id in (
        select shopper_message_id from store_wa_messages where id = any(${a}::uuid[]))`;
    expect(mirrored.map((m) => m.status)).toEqual(['sent', 'sent', 'sent']);
  });

  test('a voice reply goes as a voice note; an unreachable number fails its message', async () => {
    gw = await startGateway();
    const [t] = await threads();
    const voiceMsg = (
      await sql<{ id: string }[]>`
        insert into shopper_messages (tenant_id, thread_id, author, kind, status)
        values (${tenantId}, ${t!.id}, 'agent', 'audio', 'queued') returning id`
    )[0]!.id;
    const media = (
      await sql<{ id: string }[]>`
        insert into shopper_media (tenant_id, message_id, mime, bytes, seconds)
        values (${tenantId}, ${voiceMsg}, 'audio/ogg; codecs=opus', ${Buffer.from([7, 7, 7])}, 3)
        returning id`
    )[0]!.id;
    const voice = (
      await sql<{ id: string }[]>`
        insert into store_wa_messages (tenant_id, kind, jid, body, media_id, shopper_message_id)
        values (${tenantId}, 'chat', ${shopperJid}, 'voz', ${media}, ${voiceMsg}) returning id`
    )[0]!.id;
    const nowhere = await chatRow({ phone: '+4930123456', body: 'hallo', threadId: t!.id });
    gw.pump(tenantId);
    await until(async () => {
      const r = await outbox();
      return (
        r.find((m) => m.id === voice)?.status === 'sent' &&
        r.find((m) => m.id === nowhere)?.status === 'failed'
      );
    });
    const note = world.last.sent.find((x) => x.id === messageIdFor(voice))!;
    expect(note.jid).toBe(shopperJid);
    expect('audio' in note.content && note.content.ptt).toBe(true);
    expect('audio' in note.content && note.content.mimetype).toBe('audio/ogg; codecs=opus');
    expect('audio' in note.content && [...note.content.audio]).toEqual([7, 7, 7]);
    // a foreign number is probed as itself, no Brazilian 9th-digit guessing
    expect(world.last.probes.at(-1)).toEqual(['4930123456@s.whatsapp.net']);
    const st = await sql<{ id: string; status: string }[]>`
      select m.id, m.status from shopper_messages m
      where m.id in (${voiceMsg}, (select shopper_message_id from store_wa_messages where id = ${nowhere}))`;
    expect(
      Object.fromEntries(st.map((r) => [r.id === voiceMsg ? 'voice' : 'nowhere', r.status])),
    ).toEqual({
      voice: 'sent',
      nowhere: 'failed',
    });
  });
});
