import { AUDIO_NOT_FETCHED } from '../src/platform-whatsapp/dua-text.ts';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pino from 'pino';
import postgres from 'postgres';
import { recordChannelState } from '../src/modules/system-events.ts';
import { crmAuthRows, cutover } from '../src/platform-whatsapp/cutover-cli.ts';
import { migrate } from '../src/platform/db.ts';
import { unseal } from '../src/platform/secrets.ts';
import {
  LeaseLost,
  openAuthValue,
  platformAuthStore,
  type BufferCodec,
} from '../src/store-whatsapp/auth-store.ts';
import { channelStep, platformHousekeeping } from '../src/store-whatsapp/platform-state.ts';
import {
  platformAddress,
  platformPairPhone,
  PlatformGateway,
} from '../src/store-whatsapp/platform.ts';
import type {
  ConnectionUpdate,
  Creds,
  SocketKeys,
  WaRuntime,
  WaSocket,
} from '../src/store-whatsapp/session.ts';
import { messageIdFor } from '../src/store-whatsapp/text.ts';

// Venduá's own number on the wa-gateway (docs/features/dua-no-whatsapp.md §4).

// Baileys' BufferJSON wire format, written out: another test file mocks the 'baileys' module, and
// bun's module mocks outlive their file
const BufferJSON: BufferCodec = {
  replacer: (_k, v) => {
    const b = v as { type?: string; data?: unknown } | null;
    if (Buffer.isBuffer(v) || v instanceof Uint8Array || b?.type === 'Buffer')
      return {
        type: 'Buffer',
        data: Buffer.from((b?.data ?? v) as Uint8Array).toString('base64'),
      };
    return v;
  },
  reviver: (_k, v) => {
    const b = v as { type?: string; buffer?: boolean; data?: unknown; value?: unknown } | null;
    if (b && typeof b === 'object' && (b.buffer === true || b.type === 'Buffer')) {
      const val = b.data ?? b.value;
      return typeof val === 'string'
        ? Buffer.from(val, 'base64')
        : Buffer.from((val ?? []) as number[]);
    }
    return v;
  },
};

describe('platform whatsapp: pure rules', () => {
  test('pair phones are international digits; outbox addresses keep both 9th-digit forms for BR', () => {
    expect(platformPairPhone('14155550100')).toBe('14155550100');
    expect(platformPairPhone('5511987654321')).toBe('5511987654321');
    expect(platformPairPhone('123')).toBeNull();
    expect(platformPairPhone('+14155550100')).toBeNull();
    expect(platformAddress('5511987654321')).toEqual({ phone: '11987654321' });
    expect(platformAddress('14155550100')).toEqual({ phone: '+14155550100' });
    expect(platformAddress('999@lid')).toEqual({ jid: '999@lid' });
  });

  test('the team hears up on open and down when the number stops working', () => {
    const prev = { state: 'connecting', phone: null };
    expect(channelStep(prev, { state: 'open', phone: '5511987654321' })).toEqual({
      state: 'up',
      detail: 'conectado como +5511987654321',
    });
    expect(channelStep({ state: 'open', phone: null }, { state: 'open' })).toBeNull();
    expect(channelStep(prev, { state: 'logged_out' })?.state).toBe('down');
    expect(channelStep(prev, { state: 'banned' })?.detail).toContain('403');
    expect(channelStep(prev, { state: 'error', detail: 'replaced' })?.detail).toContain(
      'outra sessão',
    );
    expect(channelStep({ state: 'error', phone: null }, { state: 'error' })).toBeNull();
    expect(channelStep(prev, { state: 'off' })).toBeNull();
  });

  test("cutover: the socket's jsonb login opens as the same values through the platform store", () => {
    const creds = {
      registered: true,
      noiseKey: { private: Buffer.from([1, 2, 3]), public: Buffer.from([4, 5]) },
      me: { id: '5511987654321:7@s.whatsapp.net' },
    };
    const preKey = { keyPair: { private: Buffer.from('abc'), public: Buffer.from('def') } };
    // what Core's dbAuthState put in wa_auth_state
    const asJsonb = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
    const rows = crmAuthRows(
      [
        { category: 'creds', name: 'main', data: asJsonb(creds) },
        { category: 'pre-key', name: '7', data: asJsonb(preKey) },
      ],
      BufferJSON,
      's',
    );
    expect(rows.map((r) => `${r.category}/${r.name}`)).toEqual(['creds/main', 'pre-key/7']);
    // sealed: nothing readable without the key
    expect(rows[0]!.data).not.toContain('5511987654321');
    expect(unseal(JSON.parse(rows[0]!.data), 'other')).toBeNull();
    const back = openAuthValue(rows[0]!.data, BufferJSON, 's') as typeof creds;
    expect(Buffer.isBuffer(back.noiseKey.private)).toBe(true);
    expect([...back.noiseKey.private]).toEqual([1, 2, 3]);
    expect(back.me.id).toBe(creds.me.id);
    const pk = openAuthValue(rows[1]!.data, BufferJSON, 's') as typeof preKey;
    expect(pk.keyPair.public.toString()).toBe('def');
    expect(() =>
      crmAuthRows([{ category: 'x'.repeat(41), name: 'n', data: {} }], BufferJSON, 's'),
    ).toThrow();
  });
});

// ── a fake WhatsApp the tests drive ─────────────────────────────────────────

type Handler = (payload: never) => void;

class FakeSocket implements WaSocket {
  private handlers = new Map<string, Handler[]>();
  pairCalls: string[] = [];
  loggedOut = false;
  ended = false;
  failNext: Error | null = null;
  user: WaSocket['user'];
  signalRepository: NonNullable<WaSocket['signalRepository']>;
  ev = {
    on: (event: string, cb: Handler) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    },
  } as WaSocket['ev'];

  constructor(
    readonly creds: Creds,
    readonly keys: SocketKeys,
    private world: FakeWorld,
  ) {
    this.user = world.user;
    this.signalRepository = {
      lidMapping: { getPNForLID: async (lid) => world.lids.get(lid) ?? null },
    };
  }

  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload as never);
  }
  connection(u: ConnectionUpdate) {
    this.emit('connection.update', u);
  }
  close(statusCode?: number) {
    this.connection({
      connection: 'close',
      ...(statusCode ? { lastDisconnect: { error: { output: { statusCode } } } } : {}),
    });
  }
  async requestPairingCode(phone: string) {
    this.pairCalls.push(phone);
    return 'ABCD1234';
  }
  async onWhatsApp(...jids: string[]) {
    return jids.map((jid) => ({ jid, exists: this.world.registered.has(jid) }));
  }
  async sendMessage(jid: string, content: { text: string }, opts?: { messageId?: string }) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.world.outbox.push({ jid, text: content.text, id: opts?.messageId, at: Date.now() });
    return { key: { id: opts?.messageId ?? 'x' } };
  }
  async updateMediaMessage<M>(m: M) {
    return m;
  }
  async presenceSubscribe() {}
  async sendPresenceUpdate() {}
  async logout() {
    this.loggedOut = true;
    this.close(401);
  }
  end() {
    this.ended = true;
  }
}

class FakeWorld {
  sockets: FakeSocket[] = [];
  registered = new Set<string>();
  lids = new Map<string, string>();
  outbox: { jid: string; text: string; id?: string | undefined; at: number }[] = [];
  media = new Uint8Array([1, 2, 3]);
  user: WaSocket['user'] = undefined;
  syncHistory: boolean[] = [];
  get last(): FakeSocket {
    return this.sockets[this.sockets.length - 1]!;
  }
  runtime(): WaRuntime {
    return {
      codec: { replacer: (_k, v) => v, reviver: (_k, v) => v },
      initCreds: () => ({ noiseKey: 'fresh' }),
      normalize: (m) => m,
      download: async () => this.media,
      connect: async ({ creds, keys, syncHistory }) => {
        this.syncHistory.push(!!syncHistory?.());
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('platform whatsapp: gateway (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // as vendua_app, so RLS (control scope) is part of the test
  const appUrl =
    process.env.TEST_APP_DATABASE_URL ??
    process.env.TEST_DATABASE_URL!.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');
  const appSql = postgres(appUrl, { onnotice: () => {} });
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const S = `t_${nonce}`;
  const S2 = `c_${nonce}`;
  const account = `acct-${nonce}`;
  const own = '14155550100';
  const shopperPn = '5511987654321@s.whatsapp.net';
  const silent = pino({ level: 'silent' });
  const world = new FakeWorld();
  let gw: PlatformGateway;
  let eventsFrom = 0;

  const newGateway = (id: string, minSendGapMs = 1) =>
    new PlatformGateway({
      sql: appSql,
      runtime: world.runtime(),
      sealSecret: 's',
      id,
      listen: false,
      tickMs: 3_600_000,
      leaseMs: 600_000,
      minSendGapMs,
      reconnectDelay: () => 5,
      sessions: [S],
      log: silent,
    });
  const row = async () =>
    (await sql<Record<string, any>[]>`select * from platform_wa_sessions where name = ${S}`)[0]!;
  const inbox = () =>
    sql<Record<string, any>[]>`
      select * from platform_wa_inbox where session = ${S} order by created_at, provider_id`;
  const outbox = () =>
    sql<Record<string, any>[]>`
      select * from platform_wa_outbox where session = ${S} order by created_at`;
  const channelEvents = () =>
    sql<{ kind: string; data: { detail: string } }[]>`
      select kind, data from staff_events
      where anchor = 'channel:whatsapp' and id > ${eventsFrom} order by id`;
  const upsert = (messages: unknown[], type = 'notify') =>
    world.last.emit('messages.upsert', { type, messages });
  const enqueue = async (to: string, purpose: string, body: string, extra = {}) =>
    (
      await sql<{ id: string }[]>`
        insert into platform_wa_outbox ${sql({
          session: S,
          to_jid: to,
          body,
          purpose,
          dedupe_key: `${nonce}:${crypto.randomUUID()}`,
          ...extra,
        } as never)}
        returning id`
    )[0]!.id;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await sql`insert into platform_wa_sessions (name) values (${S}), (${S2})`;
    eventsFrom = Number(
      (await sql<{ m: string | null }[]>`select max(id)::text as m from staff_events`)[0]!.m ?? 0,
    );
    // a known starting point: "down", so the open below is news
    await recordChannelState(sql, 'whatsapp', 'down', 'teste');
    world.registered.add(shopperPn);
    world.registered.add('14155550123@s.whatsapp.net');
  });

  afterAll(async () => {
    await gw?.stop();
    await sql`delete from platform_wa_sessions where name in ${sql([S, S2])}`;
    await sql`delete from wa_auth_state where account_id = ${account}`;
    await sql`delete from staff_events where anchor = 'channel:whatsapp' and id > ${eventsFrom}`;
    await appSql.end();
    await sql.end();
  });

  test('pairing by code with an international phone, then open: state, sealed login, channel up', async () => {
    gw = newGateway(`gw-${nonce}-a`);
    await gw.tick();
    expect(world.sockets.length).toBe(0); // not wanted: nothing claimed
    expect((await row()).owner).toBeNull();

    await sql`update platform_wa_sessions set wanted = true, pair_phone = ${own},
                pair_requested_at = date_trunc('milliseconds', now())
              where name = ${S}`;
    await gw.tick();
    await until(() => world.sockets.length === 1);
    const r0 = await row();
    expect(r0.owner).toBe(`gw-${nonce}-a`);
    expect(Number(r0.lease_epoch)).toBe(1);
    expect(r0.pair_requested_at).toBeNull();

    const s = world.last;
    s.connection({ qr: 'ref-1' });
    await until(async () => (await row()).state === 'pairing');
    // the Brazil-only helper would have turned this into 55…: never for the platform number
    expect(s.pairCalls).toEqual([own]);
    expect((await row()).pair_code).toBe('ABCD1234');
    expect((await row()).pair_code_expires_at).not.toBeNull();

    s.creds.registered = true;
    s.creds.me = { id: `${own}:4@s.whatsapp.net` };
    s.emit('creds.update', {});
    s.connection({ isNewLogin: true });
    world.user = { id: `${own}:4@s.whatsapp.net`, name: 'Venduá' };
    s.close(515);
    await until(() => world.sockets.length === 2);
    world.last.connection({ connection: 'open' });
    await until(async () => (await row()).state === 'open');
    const r1 = await row();
    expect(r1.phone).toBe(own);
    expect(r1.account_name).toBe('Venduá');
    expect(r1.pair_code).toBeNull();
    expect(r1.connected_at).not.toBeNull();
    expect(world.syncHistory.every(Boolean)).toBe(true); // history = true by default

    const auth = await sql<{ data: string }[]>`
      select data from platform_wa_auth where session = ${S} and category = 'creds' and name = 'main'`;
    expect(auth.length).toBe(1);
    expect(auth[0]!.data).not.toContain(own);
    expect(JSON.parse(unseal(JSON.parse(auth[0]!.data), 's')!).registered).toBe(true);

    await until(async () => (await channelEvents()).some((e) => e.kind === 'channel.up'));
    const up = (await channelEvents()).find((e) => e.kind === 'channel.up')!;
    expect(up.data.detail).toBe(`conectado como +${own}`);
  });

  test('lease: a second gateway never claims a held session; writes are fenced on the epoch', async () => {
    const other = newGateway(`gw-${nonce}-b`);
    await other.tick();
    expect(other.health().sessions).toBe(0);
    expect((await row()).owner).toBe(`gw-${nonce}-a`);
    await other.stop();
    expect((await row()).owner).toBe(`gw-${nonce}-a`); // its stop hands back only its own

    const stale = platformAuthStore(
      appSql,
      S,
      { owner: `gw-${nonce}-a`, epoch: 0 },
      BufferJSON,
      's',
    );
    await expect(stale.writeMany([{ category: 'x', name: 'y', value: 1 }])).rejects.toBeInstanceOf(
      LeaseLost,
    );
    expect(await stale.hasCreds()).toBe(true);
  });

  test('inbound text → inbox row with the sender resolved; groups and our own echoes ignored', async () => {
    upsert([
      {
        key: { remoteJid: '5511987654321:2@s.whatsapp.net', id: 'IN-1', fromMe: false },
        message: { extendedTextMessage: { text: 'oi, quero entrar' } },
        pushName: 'Ana',
        messageTimestamp: 1_760_000_000,
      },
      {
        key: { remoteJid: '1203630@g.us', id: 'IN-G', fromMe: false },
        message: { conversation: 'x' },
      },
      {
        key: { remoteJid: shopperPn, id: 'IN-ME', fromMe: true },
        message: { conversation: 'eco' },
      },
    ]);
    await until(async () => (await inbox()).length >= 1);
    await new Promise((r) => setTimeout(r, 80));
    const rows = await inbox();
    expect(rows.length).toBe(1);
    const m = rows[0]!;
    expect(m.kind).toBe('message');
    expect(m.from_jid).toBe(shopperPn);
    expect(m.alt_jid).toBeNull();
    expect(m.phone).toBe('5511987654321');
    expect(m.push_name).toBe('Ana');
    expect(m.body).toBe('oi, quero entrar');
    expect(m.from_me).toBe(false);
    expect(new Date(m.sent_at).getTime()).toBe(1_760_000_000_000);
    expect(m.status).toBe('pending');

    // a replay of the same message is one row
    upsert(
      [
        {
          key: { remoteJid: shopperPn, id: 'IN-1', fromMe: false },
          message: { conversation: 'oi, quero entrar' },
        },
      ],
      'append',
    );
    await new Promise((r) => setTimeout(r, 80));
    expect((await inbox()).length).toBe(1);
  });

  test('@lid senders: number from the device mapping, else no phone', async () => {
    world.lids.set('99887766@lid', '5521912345678@s.whatsapp.net');
    upsert([
      { key: { remoteJid: '99887766@lid', id: 'IN-L1' }, message: { conversation: 'por lid' } },
      { key: { remoteJid: '11223344@lid', id: 'IN-L2' }, message: { conversation: 'sem número' } },
    ]);
    await until(async () => (await inbox()).length >= 3);
    const rows = await inbox();
    const l1 = rows.find((r) => r.provider_id === 'IN-L1')!;
    expect(l1.from_jid).toBe('5521912345678@s.whatsapp.net');
    expect(l1.alt_jid).toBe('99887766@lid');
    expect(l1.phone).toBe('5521912345678');
    const l2 = rows.find((r) => r.provider_id === 'IN-L2')!;
    expect(l2.from_jid).toBe('11223344@lid');
    expect(l2.phone).toBeNull();
  });

  test('voice notes: downloaded into platform_wa_media within the caps; over the cap, only the tag', async () => {
    const audio = (seconds: number) => ({
      audioMessage: { seconds, fileLength: 3, mimetype: 'audio/ogg; codecs=opus', ptt: true },
    });
    upsert([
      { key: { remoteJid: shopperPn, id: 'IN-V1' }, message: audio(12) },
      { key: { remoteJid: shopperPn, id: 'IN-V2' }, message: audio(400) },
    ]);
    await until(
      async () => (await inbox()).filter((r) => r.provider_id.startsWith('IN-V')).length === 2,
    );
    const rows = await inbox();
    const v1 = rows.find((r) => r.provider_id === 'IN-V1')!;
    expect(v1.body).toBe('[áudio]');
    expect(v1.media_id).not.toBeNull();
    const media = (
      await sql<{ bytes: Buffer; seconds: number; mime: string }[]>`
        select bytes, seconds, mime from platform_wa_media where id = ${v1.media_id}`
    )[0]!;
    expect([...media.bytes]).toEqual([1, 2, 3]);
    expect(media.seconds).toBe(12);
    expect(media.mime).toBe('audio/ogg; codecs=opus');
    const v2 = rows.find((r) => r.provider_id === 'IN-V2')!;
    expect(v2.body).toBe('[áudio]');
    expect(v2.media_id).toBeNull();

    // a short note WhatsApp wouldn't hand over is marked, not mistaken for a long one
    world.media = new Uint8Array(0);
    try {
      upsert([{ key: { remoteJid: shopperPn, id: 'IN-V3' }, message: audio(5) }]);
      await until(async () => (await inbox()).some((r) => r.provider_id === 'IN-V3'));
      const v3 = (await inbox()).find((r) => r.provider_id === 'IN-V3')!;
      expect(v3.body).toBe(AUDIO_NOT_FETCHED);
      expect(v3.media_id).toBeNull();
    } finally {
      world.media = new Uint8Array([1, 2, 3]);
    }
  });

  test('history at pairing: LID pairs first, then messages named as the CRM did; history = false keeps only pairs', async () => {
    world.last.emit('messaging-history.set', {
      syncType: 3,
      contacts: [{ id: '777@lid', phoneNumber: '5531911112222@s.whatsapp.net', name: 'Beto' }],
      lidPnMappings: [{ lid: '555@lid', pn: '5531933334444@s.whatsapp.net' }],
      messages: [
        {
          key: { remoteJid: '777@lid', id: 'H-1', fromMe: true },
          message: { conversation: 'olá Beto' },
          pushName: 'Venduá',
          messageTimestamp: 1_750_000_000,
        },
        {
          key: { remoteJid: '5531911112222@s.whatsapp.net', id: 'H-2', fromMe: false },
          message: { conversation: 'oi' },
        },
        // the account's own chat
        { key: { remoteJid: `${own}@s.whatsapp.net`, id: 'H-3' }, message: { conversation: 'eu' } },
        { key: { remoteJid: '555@lid', id: 'H-4', fromMe: false }, message: { conversation: 'c' } },
      ],
    });
    await until(async () => (await inbox()).filter((r) => r.kind === 'history').length === 3);
    const rows = await inbox();
    const lid = rows.filter((r) => r.kind === 'lid_mapping');
    expect(lid.length).toBe(1);
    expect(lid[0]!.pairs).toEqual(
      expect.arrayContaining([
        { lid: '555@lid', pn: '5531933334444@s.whatsapp.net' },
        { lid: '777@lid', pn: '5531911112222@s.whatsapp.net' },
      ]),
    );
    const hist = rows.filter((r) => r.kind === 'history');
    for (const h of hist)
      expect(new Date(lid[0]!.created_at).getTime()).toBeLessThanOrEqual(
        new Date(h.created_at).getTime(),
      );
    const h1 = hist.find((r) => r.provider_id === 'H-1')!;
    expect(h1.from_me).toBe(true);
    expect(h1.push_name).toBe('Beto'); // not the account's own name
    expect(h1.from_jid).toBe('5531911112222@s.whatsapp.net');
    expect(h1.alt_jid).toBe('777@lid');
    expect(h1.phone).toBe('5531911112222');
    expect(new Date(h1.sent_at).getTime()).toBe(1_750_000_000_000);
    expect(hist.find((r) => r.provider_id === 'H-2')!.push_name).toBe('Beto');
    expect(hist.find((r) => r.provider_id === 'H-4')!.phone).toBe('5531933334444');
    expect(hist.some((r) => r.provider_id === 'H-3')).toBe(false);

    await sql`update platform_wa_sessions set history = false where name = ${S}`;
    await gw.tick();
    await new Promise((r) => setTimeout(r, 50));
    world.last.emit('messaging-history.set', {
      syncType: 3,
      lidPnMappings: [{ lid: '444@lid', pn: '5531955556666@s.whatsapp.net' }],
      messages: [{ key: { remoteJid: '444@lid', id: 'H-5' }, message: { conversation: 'não' } }],
    });
    await until(async () => (await inbox()).filter((r) => r.kind === 'lid_mapping').length === 2);
    await new Promise((r) => setTimeout(r, 80));
    expect((await inbox()).some((r) => r.provider_id === 'H-5')).toBe(false);
  });

  test('lid-mapping.update: one row per new pair', async () => {
    const before = (await inbox()).filter((r) => r.kind === 'lid_mapping').length;
    world.last.emit('lid-mapping.update', {
      lid: '333:1@lid',
      pn: '5531977778888:2@s.whatsapp.net',
    });
    world.last.emit('lid-mapping.update', { lid: '333@lid', pn: '5531977778888@s.whatsapp.net' });
    world.last.emit('lid-mapping.update', { lid: '555@lid', pn: '5531933334444@s.whatsapp.net' });
    await until(
      async () => (await inbox()).filter((r) => r.kind === 'lid_mapping').length > before,
    );
    await new Promise((r) => setTimeout(r, 80));
    const lid = (await inbox()).filter((r) => r.kind === 'lid_mapping');
    expect(lid.length).toBe(before + 1);
    expect(lid[lid.length - 1]!.pairs).toEqual([
      { lid: '333@lid', pn: '5531977778888@s.whatsapp.net' },
    ]);
  });

  test('outbox: otp before dua before notice before crm; each address form; wa_id from the row', async () => {
    const sent0 = world.outbox.length;
    const ids = await sql.begin(async (tx) => {
      const ins = (to: string, purpose: string, body: string) =>
        tx<{ id: string }[]>`
          insert into platform_wa_outbox (session, to_jid, body, purpose, dedupe_key)
          values (${S}, ${to}, ${body}, ${purpose}, ${`${nonce}:${body}`}) returning id`;
      return {
        crm: (await ins('5511987654321', 'crm', 'oi lead'))[0]!.id,
        notice: (await ins('14155550123', 'notice', 'aviso'))[0]!.id,
        dua: (await ins('99887766@lid', 'dua', 'resposta'))[0]!.id,
        otp: (await ins('5511987654321', 'otp', 'código 123456'))[0]!.id,
      };
    });
    gw.pump(S);
    await until(() => world.outbox.length === sent0 + 4);
    const sent = world.outbox.slice(sent0);
    expect(sent.map((m) => m.text)).toEqual(['código 123456', 'resposta', 'aviso', 'oi lead']);
    expect(sent.map((m) => m.jid)).toEqual([
      shopperPn,
      '99887766@lid',
      '14155550123@s.whatsapp.net',
      shopperPn,
    ]);
    expect(sent[0]!.id).toBe(messageIdFor(ids.otp));
    await until(async () => (await outbox()).every((r) => r.status === 'sent'));
    const rows = await outbox();
    for (const r of rows) {
      expect(r.wa_id).toBe(messageIdFor(r.id));
      expect(r.sent_at).not.toBeNull();
      expect(r.attempts).toBe(1);
    }
  });

  test('outbox: a failed send retries with the same wa_id; not on WhatsApp fails at once; expired never goes', async () => {
    world.last.failNext = new Error('timed out');
    const id = await enqueue('5511987654321', 'notice', 'de novo');
    gw.pump(S);
    await until(async () => (await outbox()).find((r) => r.id === id)?.attempts === 1);
    await until(async () => (await outbox()).find((r) => r.id === id)?.status === 'pending');
    let r = (await outbox()).find((x) => x.id === id)!;
    expect(r.error).toBe('timed out');
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(r.wa_id).toBe(messageIdFor(id));
    await sql`update platform_wa_outbox set next_attempt_at = now() where id = ${id}`;
    gw.pump(S);
    await until(async () => (await outbox()).find((x) => x.id === id)?.status === 'sent');
    r = (await outbox()).find((x) => x.id === id)!;
    expect(r.attempts).toBe(2);
    expect(world.outbox[world.outbox.length - 1]!.id).toBe(messageIdFor(id));

    const nope = await enqueue('5511900001111', 'notice', 'ninguém');
    const old = await enqueue('5511987654321', 'crm', 'tarde demais', {
      expires_at: new Date(Date.now() - 60_000),
    });
    const before = world.outbox.length;
    gw.pump(S);
    await until(async () => {
      const rows = await outbox();
      return (
        rows.find((x) => x.id === nope)?.status === 'failed' &&
        rows.find((x) => x.id === old)?.status === 'expired'
      );
    });
    expect((await outbox()).find((x) => x.id === nope)!.error).toBe('not_on_whatsapp');
    expect(world.outbox.length).toBe(before);
  });

  test('probes: answered for an open session; stale ones are left alone', async () => {
    const ask = async (phone: string, age = '0 seconds') =>
      (
        await sql<{ id: string }[]>`
          insert into platform_wa_probes (session, phone, created_at)
          values (${S}, ${phone}, now() - ${age}::interval) returning id`
      )[0]!.id;
    const yes = await ask('5511987654321');
    const no = await ask('5511900002222');
    const stale = await ask('5511987654321', '1 minute');
    gw.probe(S);
    const probe = async (id: string) =>
      (
        await sql<{ result: boolean | null; answered_at: Date | null }[]>`
        select result, answered_at from platform_wa_probes where id = ${id}`
      )[0]!;
    await until(async () => !!(await probe(no)).answered_at);
    expect((await probe(yes)).result).toBe(true);
    expect((await probe(no)).result).toBe(false);
    expect((await probe(stale)).answered_at).toBeNull();
  });

  test('pacing: otp skips the gap, the rest waits for it', async () => {
    await gw.stop();
    expect((await row()).owner).toBeNull();
    gw = newGateway(`gw-${nonce}-c`, 1_500);
    await gw.tick();
    await until(() => gw.sessionOf(S)?.running === true);
    world.last.connection({ connection: 'open' });
    await until(() => gw.sessionOf(S)?.state === 'open');
    const before = world.outbox.length;
    await enqueue('5511987654321', 'crm', 'primeiro');
    gw.pump(S);
    await until(() => world.outbox.length === before + 1);
    const t0 = world.outbox[before]!.at;
    await enqueue('5511987654321', 'crm', 'segundo');
    await enqueue('5511987654321', 'otp', 'código 654321');
    gw.pump(S);
    await until(() => world.outbox.length === before + 2);
    expect(world.outbox[before + 1]!.text).toBe('código 654321');
    expect(world.outbox[before + 1]!.at - t0).toBeLessThan(1_500);
    await until(() => world.outbox.length === before + 3, 6_000);
    expect(world.outbox[before + 2]!.text).toBe('segundo');
    expect(world.outbox[before + 2]!.at - t0).toBeGreaterThanOrEqual(1_500);
  });

  test('banned → channel down; a stolen lease drops the socket', async () => {
    world.last.close(403);
    await until(async () => (await row()).state === 'banned');
    await until(async () => (await channelEvents()).at(-1)?.kind === 'channel.down');
    expect((await channelEvents()).at(-1)!.data.detail).toContain('403');

    // back to connecting by hand, held by another owner meanwhile: the old socket must go
    await sql`update platform_wa_sessions set state = 'connecting' where name = ${S}`;
    await gw.tick();
    await until(() => gw.sessionOf(S)?.running === true);
    const s = world.last;
    s.connection({ connection: 'open' });
    await until(() => gw.sessionOf(S)?.state === 'open');
    await sql`update platform_wa_sessions set owner = 'someone-else', lease_epoch = lease_epoch + 1
              where name = ${S}`;
    s.emit('creds.update', {});
    await until(() => gw.sessionOf(S) === null);
    expect(s.ended).toBe(true);
    await sql`update platform_wa_sessions set owner = null, lease_until = null where name = ${S}`;
  });

  test('a session nobody wants any more is let go and reads as off', async () => {
    await gw.tick();
    await until(() => gw.sessionOf(S)?.running === true);
    world.last.connection({ connection: 'open' });
    await until(async () => (await row()).state === 'open');
    await sql`update platform_wa_sessions set wanted = false where name = ${S}`;
    await gw.tick();
    await until(async () => (await row()).owner === null);
    const r = await row();
    expect(r.state).toBe('off');
    expect(r.detail).toBe('released');
    await sql`update platform_wa_sessions set wanted = true, state = 'connecting' where name = ${S}`;
  });

  test('wipe: logout on WhatsApp, login forgotten, request cleared, lease handed back', async () => {
    await gw.tick();
    await until(() => gw.sessionOf(S)?.running === true);
    const s = world.last;
    s.connection({ connection: 'open' });
    await until(async () => (await row()).state === 'open');
    await sql`update platform_wa_sessions set wipe_requested_at = date_trunc('milliseconds', now())
              where name = ${S}`;
    await gw.tick();
    await until(async () => (await row()).wipe_requested_at === null);
    expect(s.loggedOut).toBe(true);
    const r = await row();
    expect(r.state).toBe('off');
    expect(r.phone).toBeNull();
    expect((await sql`select 1 from platform_wa_auth where session = ${S}`).length).toBe(0);
    await until(async () => (await row()).owner === null);
  });

  test('cutover: copies the socket login sealed, refuses a second time without --force', async () => {
    const creds = { registered: true, noiseKey: { private: Buffer.from([9, 8, 7]) } };
    const asJsonb = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
    const seed = () => sql`insert into wa_auth_state (account_id, category, name, data) values
      (${account}, 'creds', 'main', ${sql.json(asJsonb(creds))}),
      (${account}, 'session', '5511987654321.0', ${sql.json(asJsonb({ k: Buffer.from('s') }))})`;
    await seed();
    const opts = { accountId: account, session: S2, codec: BufferJSON, sealSecret: 's' };
    expect((await cutover(appSql, { ...opts, force: false })).copied).toBe(2);
    const store = platformAuthStore(appSql, S2, { owner: 'none', epoch: 0 }, BufferJSON, 's');
    const back = (await store.read('creds', 'main')) as typeof creds;
    expect([...back.noiseKey.private]).toEqual([9, 8, 7]);
    const sess = (await store.read('session', '5511987654321.0')) as { k: Buffer };
    expect(sess.k.toString()).toBe('s');
    const r = (
      await sql<Record<string, any>[]>`select * from platform_wa_sessions where name = ${S2}`
    )[0]!;
    expect(r.wanted).toBe(true);
    expect(r.state).toBe('connecting');
    // the plaintext login is gone with the copy
    expect((await sql`select 1 from wa_auth_state where account_id = ${account}`).length).toBe(0);
    await expect(cutover(appSql, { ...opts, force: false })).rejects.toThrow(/no login/);
    await seed();
    await expect(cutover(appSql, { ...opts, force: false })).rejects.toThrow(/--force/);
    expect((await cutover(appSql, { ...opts, force: true })).copied).toBe(2);
  });
  test('housekeeping keeps a voice note while its message still waits for Core', async () => {
    const note = async () =>
      (
        await sql<{ id: string }[]>`
          insert into platform_wa_media (session, mime, bytes, seconds, created_at)
          values ('vendua', 'audio/ogg', ${Buffer.from([1])}, 3, now() - interval '2 days')
          returning id`
      )[0]!.id;
    const waiting = await note();
    const done = await note();
    await sql`
      insert into platform_wa_inbox (session, kind, from_jid, body, media_id, status)
      values ('vendua', 'message', '5511900000000@s.whatsapp.net', '[áudio]', ${waiting}, 'pending'),
             ('vendua', 'message', '5511900000000@s.whatsapp.net', '[áudio]', ${done}, 'done')`;
    try {
      await platformHousekeeping(appSql as never);
      const left = await sql<{ id: string }[]>`
        select id from platform_wa_media where id in (${waiting}, ${done})`;
      expect(left.map((r) => r.id)).toEqual([waiting]);
    } finally {
      await sql`delete from platform_wa_inbox where media_id = ${waiting} or (media_id is null and from_jid = '5511900000000@s.whatsapp.net')`;
      await sql`delete from platform_wa_media where id = ${waiting}`;
    }
  });
});
