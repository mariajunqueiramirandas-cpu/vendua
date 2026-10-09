import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  discordSettingOf,
  validateDiscordConfig,
  validateDiscordSetting,
} from '../src/modules/discord/config.ts';
import {
  deliverStaffEvents,
  loudness,
  resetDeliveryClock,
} from '../src/modules/discord/deliver.ts';
import { computeDigest, sweepDiscordDigest } from '../src/modules/discord/digest.ts';
import { esc, fitEmbed, fitMessage, quote } from '../src/modules/discord/format.ts';
import { verifyDiscordSignature } from '../src/modules/discord/interactions.ts';
import { render, type EventRow, type RenderCtx } from '../src/modules/discord/render.ts';
import { resetRateLimits } from '../src/modules/discord/rest.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import {
  recordStaffEvent,
  recordStaffEventTx,
  type StaffEventKind,
  type StaffEventMap,
} from '../src/modules/staff-events.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

const GUILD = '100000000000000001';
const APP = '200000000000000002';
const CH_DEFAULT = '300000000000000003';
const CH_FROTA = '300000000000000004';
const ROLE = '400000000000000005';
const USER = '500000000000000006';
const STRANGER = '500000000000000007';
const BOT_USER = '600000000000000008';

const rctx = (over: Partial<RenderCtx> = {}): RenderCtx => ({
  crm: (p) => `https://crm.test/control/#${p}`,
  excerpts: true,
  storeUrl: 'https://loja.test',
  store: null,
  routedHere: [],
  now: new Date(),
  ...over,
});

let seq = 0;
function ev<K extends StaffEventKind>(
  kind: K,
  data: StaffEventMap[K],
  over: Partial<EventRow> = {},
): EventRow {
  return {
    id: ++seq,
    kind,
    tenant_id: null,
    severity: 'info',
    anchor: null,
    data,
    created_at: new Date(),
    ...over,
  } as EventRow;
}

describe('discord formatting', () => {
  test('user text cannot format, link or ping', () => {
    expect(esc('**bold** _x_ `code` ||spoiler||')).toBe(
      '\\*\\*bold\\*\\* \\_x\\_ \\`code\\` \\|\\|spoiler\\|\\|',
    );
    expect(esc('[clique](https://evil.test)')).toContain(']​(');
    expect(esc('@everyone @here')).not.toContain('@everyone');
    expect(esc('<@123456789012345678>')).toContain('<​@');
    expect(quote('# título\nlinha')).toBe('> \\# título\n> linha');
  });

  test('embeds are clamped to Discord limits', () => {
    const e = fitEmbed({
      title: 'x'.repeat(400),
      description: 'y'.repeat(9000),
      fields: Array.from({ length: 40 }, () => ({ name: 'n', value: 'v'.repeat(2000) })),
      footer: { text: 'f'.repeat(3000) },
      url: 'javascript:alert(1)',
    });
    expect(e.title!.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(e.fields!.length).toBeLessThanOrEqual(25);
    expect(e.fields!.every((f) => f.value.length <= 1024)).toBe(true);
    expect(e.url).toBeUndefined();
    const total =
      (e.title?.length ?? 0) +
      (e.description?.length ?? 0) +
      (e.footer?.text.length ?? 0) +
      e.fields!.reduce((s, f) => s + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
  });

  test('broken buttons are dropped, empty rows removed', () => {
    const m = fitMessage({
      components: [
        { type: 1, components: [{ type: 2, style: 5, label: 'x', url: 'ftp://nope' }] },
        { type: 1, components: [{ type: 2, style: 1, label: 'ok', custom_id: 'v1:a:b:c' }] },
      ],
    });
    expect(m.components).toHaveLength(1);
  });

  test('loudness: silent, ping, critical, muted', () => {
    expect(loudness('silent', 'info', false, ROLE).flags).toBe(1 << 12);
    expect(loudness('ping', 'info', false, ROLE).content).toBe(`<@&${ROLE}>`);
    expect(loudness('ping', 'info', false, ROLE).allowed_mentions?.roles).toEqual([ROLE]);
    expect(loudness('normal', 'critical', false, ROLE).content).toBe(`<@&${ROLE}>`);
    expect(loudness('normal', 'critical', true, ROLE).flags).toBe(1 << 12);
    expect(loudness('ping', 'info', false, null).content).toBeUndefined();
    expect(loudness('normal', 'warning', false, ROLE)).toEqual({ allowed_mentions: { parse: [] } });
  });
});

describe('discord signature', () => {
  test('Ed25519 over timestamp + body, inside the replay window', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as unknown as CryptoKeyPair;
    const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    const body = '{"type":1}';
    const sig = Buffer.from(
      await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(`${now}${body}`)),
    ).toString('hex');
    expect(await verifyDiscordSignature(pub, sig, String(now), body)).toBe(true);
    expect(await verifyDiscordSignature(pub, sig, String(now), `${body} `)).toBe(false);
    expect(await verifyDiscordSignature(pub, sig, String(now + 1), body)).toBe(false);
    expect(await verifyDiscordSignature(pub, sig, String(now), body, now + 301)).toBe(false);
    expect(await verifyDiscordSignature(pub, 'zz', String(now), body)).toBe(false);
    expect(await verifyDiscordSignature(pub, undefined, String(now), body)).toBe(false);
    expect(await verifyDiscordSignature(pub, sig, 'abc', body)).toBe(false);
  });
});

describe('discord setting', () => {
  test('validation is strict, reading is lenient', () => {
    const bad = (v: unknown) => {
      try {
        validateDiscordSetting(v);
        return null;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(
      bad({ channels: { default: CH_DEFAULT }, levels: { 'order.placed': 'ping' } }),
    ).toBeNull();
    expect(bad({ channels: { nope: CH_DEFAULT } })).toBe('BAD_REQUEST');
    expect(bad({ channels: { crm: '123' } })).toBe('BAD_REQUEST');
    expect(bad({ levels: { 'order.placed': 'loud' } })).toBe('BAD_REQUEST');
    expect(bad({ levels: { 'not.akind': 'off' } })).toBe('BAD_REQUEST');
    expect(bad({ levels: { 'discord.test': 'off' } })).toBe('BAD_REQUEST');
    expect(bad({ digest: { hour: 24 } })).toBe('BAD_REQUEST');
    expect(bad({ extra: 1 })).toBe('BAD_REQUEST');
    const s = discordSettingOf({
      channels: { crm: 'x', vendas: CH_DEFAULT },
      levels: { x: 'off' },
    });
    expect(s.channels).toEqual({ vendas: CH_DEFAULT });
    expect(s.levels).toEqual({});
    expect(s.digest).toEqual({ enabled: true, hour: 8 });
    expect(() => validateDiscordConfig({ applicationId: APP, guildId: 'x' })).toThrow();
    expect(() => validateDiscordConfig({ applicationId: '', publicKey: '' })).not.toThrow();
  });
});

describe('discord cards', () => {
  test('an order card follows the order and the cancellation replies', () => {
    const placed = ev(
      'order.placed',
      {
        orderId: 'o1',
        number: 42,
        storeName: 'Pão *Quente*',
        totalCents: 12345,
        method: 'pix',
        fulfillment: 'delivery',
        items: 3,
        scheduledFor: null,
      },
      { anchor: 'order:o1' },
    );
    const first = render(placed, [placed], rctx());
    const e = first.card.embeds![0]!;
    expect(e.title).toBe('pedido #42 · Pão \\*Quente\\*');
    expect(e.description).toContain('R$');
    expect(e.description).toContain('Pix');
    const cancel = ev(
      'order.updated',
      { orderId: 'o1', number: 42, storeName: 'Pão', to: 'cancelled', actor: 'merchant' },
      { anchor: 'order:o1', severity: 'warning' },
    );
    const second = render(cancel, [placed, cancel], rctx());
    expect(second.card.embeds![0]!.description).toContain('cancelado');
    expect(second.reply).toContain('cancelado');
  });

  test('a draft card loses its buttons once resolved', () => {
    const pending = ev(
      'draft.pending',
      {
        messageId: 'm1',
        threadId: 't1',
        leadId: 'l1',
        leadName: 'Ana',
        business: 'Doces da Ana',
        channel: 'whatsapp',
        subject: null,
        body: 'Oi Ana! Tudo bem?',
      },
      { anchor: 'draft:m1' },
    );
    const open = render(pending, [pending], rctx()).card;
    const ids = open.components!.flatMap((r) => r.components.map((b) => b.custom_id ?? b.url));
    expect(ids).toContain('v1:draft:approve:m1');
    expect(ids).toContain('v1:draft:reject:m1');
    expect(open.embeds![0]!.description).toContain('Oi Ana');
    const hidden = render(pending, [pending], rctx({ excerpts: false })).card;
    expect(hidden.embeds![0]!.description).not.toContain('Oi Ana');
    const done = ev(
      'draft.resolved',
      { messageId: 'm1', outcome: 'approved', by: 'Maria' },
      { anchor: 'draft:m1' },
    );
    const closed = render(done, [pending, done], rctx()).card;
    expect(closed.embeds![0]!.description).toContain('aprovado por Maria');
    expect(closed.components!.flatMap((r) => r.components).every((b) => b.style === 5)).toBe(true);
  });

  test('an incident card escalates and resolves with a duration', () => {
    const opened = ev(
      'incident.opened',
      {
        incidentId: 'i1',
        kind: 'probe_failing',
        severity: 'warning',
        subject: 'loja.test',
        summary: 'sonda falhando em loja.test',
        storeName: 'Loja',
      },
      {
        anchor: 'incident:i1',
        severity: 'warning',
        created_at: new Date(Date.now() - 12 * 60_000),
      },
    );
    const up = ev(
      'incident.updated',
      { incidentId: 'i1', change: 'escalated', by: null, summary: 'sonda falhando há 10 min' },
      { anchor: 'incident:i1', severity: 'critical' },
    );
    const crit = render(up, [opened, up], rctx());
    expect(crit.card.embeds![0]!.color).toBe(0xdc2626);
    expect(crit.reply).toContain('crítico');
    const res = ev(
      'incident.updated',
      { incidentId: 'i1', change: 'resolved', by: null, summary: null },
      { anchor: 'incident:i1', severity: 'success' },
    );
    const done = render(res, [opened, up, res], rctx());
    expect(done.reply).toContain('12 min');
    expect(done.card.components!.flatMap((r) => r.components).every((b) => b.style === 5)).toBe(
      true,
    );
  });

  test('every kind renders inside the limits', () => {
    const kinds: [StaffEventKind, unknown][] = [
      [
        'merchant.help',
        { storeName: 'L', slug: 'l', who: 'Ze', message: 'socorro', contact: '1199' },
      ],
      [
        'lead.created',
        { leadId: 'l', leadName: 'A', business: null, channel: 'email', excerpt: 'oi' },
      ],
      [
        'store.first_order',
        { orderId: 'o', number: 1, storeName: 'L', totalCents: 100, method: 'cash' },
      ],
      ['billing.problem', { storeName: 'L', problem: 'past_due', detail: null }],
      ['system.error', { method: 'GET', path: '/x/:id', message: 'boom', count: 3 }],
      [
        'agent.run_failed',
        {
          runId: 'r',
          job: 'reply',
          leadId: null,
          leadName: null,
          error: 'x'.repeat(5000),
          attempts: 5,
        },
      ],
      [
        'release.published',
        { releaseId: 'abcdef0123456789abcd', bundle: '_template', kernel: '1.11.0', promoted: 2 },
      ],
    ];
    for (const [kind, data] of kinds) {
      const out = fitMessage(render(ev(kind, data as never), [], rctx()).card);
      expect(JSON.stringify(out).length).toBeLessThan(8000);
      expect(out.embeds![0]!.title).toBeTruthy();
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('discord bot (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // TEST_APP_DATABASE_URL runs the API as vendua_app under RLS, as prod does
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const nonce = crypto.randomUUID().slice(0, 8);
  let kp: CryptoKeyPair;
  let publicKey = '';

  // the fake Discord API
  type Call = { method: string; path: string; body: Record<string, unknown> | null };
  const calls: Call[] = [];
  const failNext: { status: number; body: Record<string, unknown> }[] = [];
  let msgSeq = 0;
  let channelsInGuild: { id: string; name: string; type: number; parent_id?: string | null }[] = [];
  let botGuilds = [{ id: GUILD, name: 'Venduá' }];
  const fakeDiscord = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api/v10', '');
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path, body });
    const fail = failNext.shift();
    if (fail) return Response.json(fail.body, { status: fail.status });
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path))
      return Response.json({ id: `7${String(++msgSeq).padStart(17, '0')}` });
    if (method === 'PATCH' && /^\/channels\/\d+\/messages\/\d+$/.test(path))
      return Response.json({ id: path.split('/').at(-1) });
    if (method === 'PUT' && path.endsWith('/commands')) return Response.json([]);
    if (path === '/users/@me') return Response.json({ id: BOT_USER, username: 'vendua' });
    if (path === '/users/@me/guilds') return Response.json(botGuilds);
    if (path === '/applications/@me' && method === 'GET')
      return Response.json({ id: APP, verify_key: publicKey, interactions_endpoint_url: null });
    if (path === '/applications/@me' && method === 'PATCH') return Response.json({ id: APP });
    if (path === `/guilds/${GUILD}`) return Response.json({ id: GUILD, name: 'Venduá' });
    if (path === `/guilds/${GUILD}/roles`)
      return Response.json([{ id: ROLE, name: 'equipe', color: 0, managed: false, position: 2 }]);
    if (path === `/guilds/${GUILD}/channels` && method === 'GET')
      return Response.json(channelsInGuild);
    if (path === `/guilds/${GUILD}/channels` && method === 'POST') {
      const ch = {
        id: `8${String(++msgSeq).padStart(17, '0')}`,
        name: String(body!.name),
        type: Number(body!.type),
        parent_id: (body!.parent_id as string | undefined) ?? null,
      };
      channelsInGuild.push(ch);
      return Response.json(ch);
    }
    return Response.json({ message: 'not found', code: 0 }, { status: 404 });
  };

  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    discordFetch: fakeDiscord as never,
  });
  const deliver = () => deliverStaffEvents(sql, { fetch: fakeDiscord as never });

  const saved: { key: string; value: unknown }[] = [];
  let savedIntegration: Record<string, unknown> | null = null;
  const created = { leads: [] as string[], tenants: [] as string[] };

  const ctl = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        'idempotency-key': `${nonce}-${crypto.randomUUID()}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const interact = async (
    payload: Record<string, unknown>,
    opts: { ts?: number; tamper?: boolean } = {},
  ) => {
    const body = JSON.stringify(payload);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = Buffer.from(
      await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(`${ts}${body}`)),
    ).toString('hex');
    return app.request('/control/v1/discord/interactions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': opts.tamper ? sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a') : sig,
        'x-signature-timestamp': String(ts),
      },
      body,
    });
  };
  const asStaff = (extra: Record<string, unknown>) => ({
    id: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    application_id: APP,
    token: 'tok',
    guild_id: GUILD,
    member: { user: { id: USER, username: 'maria' }, roles: [ROLE] },
    ...extra,
  });

  const rows = (where: string) =>
    sql.unsafe(`select id, kind, state, channel_id, message_id, attempts, last_error, data
                from staff_events where ${where} order by id`);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as unknown as CryptoKeyPair;
    publicKey = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('hex');
    for (const key of ['discord', 'discord_state', 'staff']) {
      const r = await sql<
        { value: unknown }[]
      >`select value from control_settings where key = ${key}`;
      if (r[0]) saved.push({ key, value: r[0].value });
    }
    savedIntegration =
      (
        await sql`select * from control_integrations where kind = 'discord' and driver = 'bot'`
      )[0] ?? null;
    process.env.DISCORD_TEST_TOKEN = 'test-bot-token';
    await sql`
      insert into control_integrations (kind, driver, enabled, config, secret_ref)
      values ('discord', 'bot', true,
              ${sql.json({ applicationId: APP, guildId: GUILD, publicKey })}, 'DISCORD_TEST_TOKEN')
      on conflict (kind, driver) do update set enabled = true, config = excluded.config,
        secret_ref = excluded.secret_ref
    `;
    const put = async (key: string, value: unknown) => sql`
      insert into control_settings (key, value) values (${key}, ${sql.json(value as never)})
      on conflict (key) do update set value = excluded.value
    `;
    await put('discord', {
      channels: { default: CH_DEFAULT, frota: CH_FROTA },
      staffRoleId: ROLE,
      levels: { 'lead.created': 'normal' },
    });
    await put('discord_state', {});
    await put('staff', {
      members: [{ name: 'Maria', email: `maria@${nonce}.test`, whatsapp: '', discord: USER }],
    });
    // other suites' events are not ours to deliver
    await sql`update staff_events set state = 'skipped' where state = 'pending'`;
  });

  afterAll(async () => {
    for (const key of ['discord', 'discord_state', 'staff']) {
      const s = saved.find((x) => x.key === key);
      if (s)
        await sql`update control_settings set value = ${sql.json(s.value as never)} where key = ${key}`;
      else await sql`delete from control_settings where key = ${key}`;
    }
    if (savedIntegration)
      await sql`
        update control_integrations set enabled = ${savedIntegration.enabled as boolean},
          config = ${sql.json(savedIntegration.config as never)},
          secret_ref = ${savedIntegration.secret_ref as string | null}
        where kind = 'discord' and driver = 'bot'
      `;
    else await sql`delete from control_integrations where kind = 'discord'`;
    delete process.env.DISCORD_TEST_TOKEN;
    if (created.leads.length) await sql`delete from leads where id in ${sql(created.leads)}`;
    if (created.tenants.length) await sql`delete from tenants where id in ${sql(created.tenants)}`;
    await sql`delete from staff_events where data::text like ${`%${nonce}%`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    failNext.length = 0;
    resetRateLimits();
    resetDeliveryClock();
    await sql`update staff_events set state = 'skipped' where state = 'pending'`;
  });

  test('a recorded event is posted once, with a nonce, to its category channel', async () => {
    await recordStaffEvent(sql, 'deployment.failed', {
      deploymentId: crypto.randomUUID(),
      storeName: `Loja ${nonce}`,
      host: 'x.test',
      releaseId: 'abcdef0123456789abcd',
      rolledBackTo: null,
      reason: 'probe failed',
    });
    const out = await deliver();
    expect(out.n).toBe(1);
    const posts = calls.filter((c) => c.method === 'POST' && c.path.includes('/messages'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/channels/${CH_FROTA}/messages`);
    expect(posts[0]!.body!.enforce_nonce).toBe(true);
    expect(String(posts[0]!.body!.nonce)).toMatch(/^se\d+$/);
    // commands were registered on the first pass, and only then
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    const [row] = await rows(`data->>'storeName' = 'Loja ${nonce}'`);
    expect(row!.state).toBe('sent');
    expect(row!.channel_id).toBe(CH_FROTA);
    calls.length = 0;
    expect((await deliver()).n).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('follow-ups edit the card and reply when it matters', async () => {
    const id = crypto.randomUUID();
    await recordStaffEvent(sql, 'incident.opened', {
      incidentId: id,
      kind: 'probe_failing',
      severity: 'warning',
      subject: `${nonce}.test`,
      summary: `sonda falhando ${nonce}`,
      storeName: null,
    });
    await deliver();
    const cardPost = calls.find((c) => c.method === 'POST')!;
    expect(cardPost.body!.content).toBeUndefined();
    calls.length = 0;
    await recordStaffEvent(sql, 'incident.updated', {
      incidentId: id,
      change: 'escalated',
      by: null,
      summary: 'piorou',
    });
    await deliver();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toMatch(new RegExp(`^/channels/${CH_FROTA}/messages/\\d+$`));
    const reply = calls.find((c) => c.method === 'POST')!;
    expect(reply.body!.message_reference).toBeTruthy();
    // escalation is critical: the staff role is mentioned
    expect(String(reply.body!.content)).toContain(`<@&${ROLE}>`);
    expect((reply.body!.allowed_mentions as { roles: string[] }).roles).toEqual([ROLE]);
    calls.length = 0;
    await recordStaffEvent(sql, 'incident.updated', {
      incidentId: id,
      change: 'acked',
      by: 'Maria',
      summary: null,
    });
    await deliver();
    // acknowledging edits only
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  test('off is skipped, silent and muted suppress notifications', async () => {
    await sql`
      update control_settings set value = jsonb_set(value, '{levels}',
        '{"lead.created": "off", "lead.replied": "silent"}'::jsonb)
      where key = 'discord'
    `;
    const base = { leadId: crypto.randomUUID(), leadName: `L${nonce}`, business: null };
    await recordStaffEvent(sql, 'lead.created', { ...base, channel: 'email', excerpt: null });
    await recordStaffEvent(sql, 'lead.replied', {
      ...base,
      channel: 'email',
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      excerpt: 'oi',
    });
    await deliver();
    const created = await rows(`kind = 'lead.created' and data->>'leadName' = 'L${nonce}'`);
    expect(created[0]!.state).toBe('skipped');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body!.flags).toBe(1 << 12);
    // a muted category goes silent too
    await sql`
      update control_settings set value = ${sql.json({ mutes: { frota: new Date(Date.now() + 60_000).toISOString() } })}
      where key = 'discord_state'
    `;
    calls.length = 0;
    await recordStaffEvent(sql, 'store.live', { storeName: `Muda ${nonce}`, host: null });
    await deliver();
    expect(calls.find((c) => c.method === 'POST')!.body!.flags).toBe(1 << 12);
    await sql`update control_settings set value = '{}' where key = 'discord_state'`;
    await sql`
      update control_settings set value = jsonb_set(value, '{levels}', '{}'::jsonb)
      where key = 'discord'
    `;
  });

  test('a storm of one kind collapses into a summary', async () => {
    for (let i = 0; i < 9; i++)
      await recordStaffEvent(sql, 'store.live', { storeName: `Storm ${nonce} ${i}`, host: null });
    const out = await deliver();
    expect(out.n).toBe(9);
    const posts = calls.filter((c) => c.method === 'POST' && c.path.includes('/messages'));
    expect(posts).toHaveLength(4);
    const summary = posts.at(-1)!.body!.embeds as { title: string }[];
    expect(summary[0]!.title).toBe('+6 × loja no ar');
  });

  test('a rate limit ends the pass and refunds the attempt', async () => {
    await recordStaffEvent(sql, 'store.live', { storeName: `RL ${nonce}`, host: null });
    failNext.push({ status: 429, body: { message: 'slow down', retry_after: 1.5, global: false } });
    const out = await deliver();
    expect(out.retryInMs).toBe(1500);
    const [r] = await rows(`data->>'storeName' = 'RL ${nonce}'`);
    expect(r!.state).toBe('pending');
    expect(r!.attempts).toBe(0);
  });

  test('a 5xx retries later; a missing channel fails and is surfaced', async () => {
    await recordStaffEvent(sql, 'store.live', { storeName: `5xx ${nonce}`, host: null });
    failNext.push({ status: 502, body: { message: 'bad gateway' } });
    await deliver();
    const [r] = await rows(`data->>'storeName' = '5xx ${nonce}'`);
    expect(r!.state).toBe('pending');
    expect(r!.attempts).toBe(1);
    resetRateLimits();
    await recordStaffEvent(sql, 'store.live', { storeName: `404 ${nonce}`, host: null });
    await sql`update staff_events set state = 'skipped' where data->>'storeName' = ${`5xx ${nonce}`}`;
    failNext.push({ status: 404, body: { message: 'Unknown Channel', code: 10003 } });
    await deliver();
    const [f] = await rows(`data->>'storeName' = '404 ${nonce}'`);
    expect(f!.state).toBe('failed');
    const st = await sql<{ value: { lastError?: { message: string } } }[]>`
      select value from control_settings where key = 'discord_state'
    `;
    expect(st[0]!.value.lastError!.message).toContain('canal não existe');
  });

  test('a store transaction records its own events but cannot read them back', async () => {
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`dsc-${nonce}`}, ${`Loja ${nonce}`}) returning id
    `;
    created.tenants.push(t!.id);
    const tenantTx = <T>(fn: (tx: postgres.Sql) => Promise<T>) =>
      appSql.begin(async (tx) => {
        await tx`select set_config('vendua.tenant_id', ${t!.id}, true)`;
        return fn(tx as unknown as postgres.Sql);
      });
    const data = {
      orderId: crypto.randomUUID(),
      number: 1,
      storeName: `Loja ${nonce}`,
      totalCents: 990,
      method: 'pix',
    };
    await tenantTx(async (tx) => {
      await recordStaffEventTx(tx, 'store.first_order', data, {
        tenantId: t!.id,
        dedupeKey: `first_order:${t!.id}`,
      });
      // a duplicate is swallowed, and the transaction stays usable
      await recordStaffEventTx(tx, 'store.first_order', data, {
        tenantId: t!.id,
        dedupeKey: `first_order:${t!.id}`,
      });
      // another store's id is refused by RLS — logged, never thrown
      await recordStaffEventTx(tx, 'store.first_order', data, { tenantId: crypto.randomUUID() });
      expect((await tx`select 1 as ok`)[0]!.ok).toBe(1);
    });
    const mine =
      await sql`select tenant_id from staff_events where dedupe_key = ${`first_order:${t!.id}`}`;
    expect(mine).toHaveLength(1);
    if (appSql !== sql) {
      const seen = await tenantTx((tx) => tx`select count(*)::int as n from staff_events`);
      expect(seen[0]!.n).toBe(0);
    }
  });

  test('interactions: signature, ping, strangers and staff', async () => {
    const ping = await interact({ id: '1', type: 1 });
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ type: 1 });
    expect((await interact({ id: '1', type: 1 }, { tamper: true })).status).toBe(401);
    expect(
      (await interact({ id: '1', type: 1 }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status,
    ).toBe(401);

    const stranger = await interact({
      id: '2',
      type: 2,
      guild_id: GUILD,
      member: { user: { id: STRANGER } },
      data: { name: 'hoje' },
    });
    const s = (await stranger.json()) as { type: number; data: { content: string; flags: number } };
    expect(s.type).toBe(4);
    expect(s.data.flags & 64).toBe(64);
    expect(s.data.content).toContain(STRANGER);

    const otherGuild = await interact({
      ...asStaff({ type: 2, data: { name: 'hoje' } }),
      guild_id: '999999999999999999',
    });
    expect(((await otherGuild.json()) as { data: { content: string } }).data.content).toContain(
      'servidor',
    );

    for (const name of ['hoje', 'pendencias', 'frota', 'bot', 'ajuda', 'resumo']) {
      const r = await interact(asStaff({ type: 2, data: { name } }));
      expect(r.status).toBe(200);
      const j = (await r.json()) as { type: number; data: { embeds?: unknown[]; flags?: number } };
      expect(j.type).toBe(4);
      expect(j.data.embeds?.length).toBeGreaterThan(0);
    }
  });

  test('buttons: approve a draft from Discord, attributed to the member', async () => {
    const leadId = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: `Draft ${nonce}`, agent_mode: 'draft' }),
    ).then((r) => r.body.lead.id);
    created.leads.push(leadId);
    const messageId = await controlTx(sql, async (tx) => {
      const r = await composeMessageTx(tx, {
        leadId,
        channel: 'manual',
        body: `olá ${nonce}`,
        author: 'agent',
        status: 'draft',
      });
      return r.body.message.id;
    });
    const pending = await rows(`kind = 'draft.pending' and data->>'messageId' = '${messageId}'`);
    expect(pending).toHaveLength(1);
    await deliver();
    const r = await interact(
      asStaff({
        type: 3,
        data: { custom_id: `v1:draft:approve:${messageId}`, component_type: 2 },
        message: { flags: 0 },
      }),
    );
    const j = (await r.json()) as {
      type: number;
      data: {
        embeds: { description: string }[];
        components: { components: { style: number }[] }[];
      };
    };
    expect(j.type).toBe(7);
    expect(j.data.embeds[0]!.description).toContain('aprovado por Maria');
    expect(j.data.components.flatMap((x) => x.components).every((b) => b.style === 5)).toBe(true);
    const [m] = await sql<{ approved_by: string; status: string }[]>`
      select approved_by, status from lead_messages where id = ${messageId}
    `;
    expect(m!.approved_by).toBe('Maria');
    expect(['queued', 'sending', 'sent']).toContain(m!.status);
  });

  test('buttons: take and close a handoff', async () => {
    const leadId = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: `Handoff ${nonce}`, agent_mode: 'auto' }),
    ).then((r) => r.body.lead.id);
    created.leads.push(leadId);
    const [task] = await sql<{ id: string }[]>`
      insert into lead_tasks (lead_id, title, created_by) values (${leadId}, '[humano] ajuda', 'agent')
      returning id
    `;
    await recordStaffEvent(sql, 'handoff.requested', {
      taskId: task!.id,
      leadId,
      leadName: `Handoff ${nonce}`,
      business: null,
      channel: null,
      threadId: null,
      reason: 'cliente quer falar com humano',
    });
    await deliver();
    const take = await interact(
      asStaff({
        type: 3,
        data: { custom_id: `v1:handoff:take:${task!.id}` },
        message: { flags: 0 },
      }),
    );
    const tj = (await take.json()) as { type: number; data: { embeds: { description: string }[] } };
    expect(tj.type).toBe(7);
    expect(tj.data.embeds[0]!.description).toContain('assumido por Maria');
    const [lead] = await sql<{ owner: string }[]>`select owner from leads where id = ${leadId}`;
    expect(lead!.owner).toBe('Maria');
    const done = await interact(
      asStaff({
        type: 3,
        data: { custom_id: `v1:handoff:done:${task!.id}` },
        message: { flags: 0 },
      }),
    );
    const dj = (await done.json()) as { data: { embeds: { description: string }[] } };
    expect(dj.data.embeds[0]!.description).toContain('resolvido');
    const [t] = await sql<
      { done_at: Date | null }[]
    >`select done_at from lead_tasks where id = ${task!.id}`;
    expect(t!.done_at).not.toBeNull();
  });

  test('autocomplete finds leads; a stale button is refused politely', async () => {
    const leadId = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: `Busca ${nonce}`, business_name: 'Padaria Achável' }),
    ).then((r) => r.body.lead.id);
    created.leads.push(leadId);
    const r = await interact(
      asStaff({
        type: 4,
        data: {
          name: 'lead',
          options: [{ name: 'busca', type: 3, value: `Busca ${nonce}`, focused: true }],
        },
      }),
    );
    const j = (await r.json()) as { type: number; data: { choices: { value: string }[] } };
    expect(j.type).toBe(8);
    expect(j.data.choices.map((c) => c.value)).toContain(leadId);
    const card = await interact(
      asStaff({
        type: 2,
        data: { name: 'lead', options: [{ name: 'busca', type: 3, value: leadId }] },
      }),
    );
    expect(
      ((await card.json()) as { data: { embeds: { title: string }[] } }).data.embeds[0]!.title,
    ).toContain(`Busca ${nonce}`);
    const old = await interact(asStaff({ type: 3, data: { custom_id: 'approve-123' } }));
    expect(((await old.json()) as { data: { content: string } }).data.content).toContain(
      'versão antiga',
    );
  });

  test('commands: a malformed id is "not found"; a replayed /silenciar keeps its mute', async () => {
    const dash = '-'.repeat(36);
    for (const [name, word] of [
      ['lead', 'nenhum lead'],
      ['loja', 'nenhuma loja'],
    ] as const) {
      const r = await interact(
        asStaff({ type: 2, data: { name, options: [{ name: 'busca', type: 3, value: dash }] } }),
      );
      expect(((await r.json()) as { data: { content: string } }).data.content).toContain(word);
    }
    const mute = asStaff({
      type: 2,
      data: {
        name: 'silenciar',
        options: [
          { name: 'categoria', type: 3, value: 'frota' },
          { name: 'tempo', type: 4, value: 30 },
        ],
      },
    });
    const until = async () =>
      (
        await sql<{ u: string | null }[]>`
          select value->'mutes'->>'frota' as u from control_settings where key = 'discord_state'
        `
      )[0]?.u;
    const first = (await (await interact(mute)).json()) as {
      type: number;
      data: { content: string };
    };
    expect(first.type).toBe(4);
    const at = await until();
    expect(at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));
    const again = (await (await interact(mute)).json()) as { data: { content: string } };
    expect(await until()).toBe(at);
    expect(again.data.content).toBe(first.data.content);
    await sql`update control_settings set value = '{}' where key = 'discord_state'`;
  });

  test('connect: the token alone fills the app, finds the server and sets the endpoint', async () => {
    const config = () =>
      sql<{ config: Record<string, string>; enabled: boolean }[]>`
        select config, enabled from control_integrations where kind = 'discord' and driver = 'bot'
      `.then((r) => r[0]!);
    await sql`update control_integrations set config = '{}', enabled = false
              where kind = 'discord' and driver = 'bot'`;
    try {
      // invited to two servers: nothing is guessed until one is picked
      botGuilds = [
        { id: GUILD, name: 'Venduá' },
        { id: '100000000000000009', name: 'outro' },
      ];
      const r = await ctl('POST', '/control/v1/discord/connect', {});
      expect(r.status).toBe(200);
      const j = (await r.json()) as {
        guildId: string | null;
        guilds: unknown[];
        invite: string;
        endpoint: { url: string; ok: boolean };
      };
      expect(j.guildId).toBeNull();
      expect(j.guilds).toHaveLength(2);
      expect(j.invite).toContain(`client_id=${APP}`);
      expect(j.invite).not.toContain('guild_id');
      expect(j.endpoint.ok).toBe(true);
      expect(j.endpoint.url).toEndWith('/control/v1/discord/interactions');
      const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/applications/@me')!;
      expect(patch.body).toEqual({ interactions_endpoint_url: j.endpoint.url });
      expect(await config()).toEqual({ config: { applicationId: APP, publicKey }, enabled: true });

      const stranger = await ctl('POST', '/control/v1/discord/connect', {
        guildId: '100000000000000010',
      });
      expect(stranger.status).toBe(422);

      botGuilds = [{ id: GUILD, name: 'Venduá' }];
      const once = await ctl('POST', '/control/v1/discord/connect', {});
      expect(((await once.json()) as { guildId: string }).guildId).toBe(GUILD);
      expect((await config()).config).toEqual({ applicationId: APP, publicKey, guildId: GUILD });

      const ov = (await (await ctl('GET', '/control/v1/discord')).json()) as {
        app: { ok: boolean };
      };
      expect(ov.app.ok).toBe(true);

      // kicked from that server: the stale id is dropped, so the panel asks for an invite again
      botGuilds = [];
      const kicked = await ctl('POST', '/control/v1/discord/connect', {});
      expect(((await kicked.json()) as { guildId: string | null }).guildId).toBeNull();
      expect((await config()).config).toEqual({ applicationId: APP, publicKey });
    } finally {
      botGuilds = [{ id: GUILD, name: 'Venduá' }];
      await sql`update control_integrations
                set config = ${sql.json({ applicationId: APP, guildId: GUILD, publicKey })},
                    enabled = true
                where kind = 'discord' and driver = 'bot'`;
    }
  });

  test('connect: no token in the environment is a clear 422', async () => {
    const saved = [process.env.DISCORD_TEST_TOKEN, process.env.DISCORD_BOT_TOKEN];
    delete process.env.DISCORD_TEST_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    try {
      const r = await ctl('POST', '/control/v1/discord/connect', {});
      expect(r.status).toBe(422);
      expect(calls).toHaveLength(0);
    } finally {
      process.env.DISCORD_TEST_TOKEN = saved[0]!;
      if (saved[1] !== undefined) process.env.DISCORD_BOT_TOKEN = saved[1];
    }
  });

  test('CRM: overview, setup channels, test, mutes and the digest', async () => {
    const ov = await ctl('GET', '/control/v1/discord');
    expect(ov.status).toBe(200);
    const o = (await ov.json()) as {
      app: { ok: boolean; invite: string };
      catalog: { kinds: { kind: string }[] };
      team: { linked: number };
    };
    expect(o.app.ok).toBe(true);
    expect(o.app.invite).toContain(`client_id=${APP}`);
    expect(o.catalog.kinds.length).toBeGreaterThan(30);
    expect(o.team.linked).toBe(1);

    const g = await ctl('GET', '/control/v1/discord/guild');
    expect(((await g.json()) as { roles: { id: string }[] }).roles[0]!.id).toBe(ROLE);

    channelsInGuild = [];
    const setup = await ctl('POST', '/control/v1/discord/setup', { staffRoleId: ROLE });
    expect(setup.status).toBe(200);
    const sj = (await setup.json()) as { channels: Record<string, string>; created: string[] };
    expect(sj.created).toHaveLength(8);
    const category = calls.find((c) => c.method === 'POST' && c.body?.type === 4)!;
    const overwrites = category.body!.permission_overwrites as { id: string; deny: string }[];
    expect(overwrites.find((w) => w.id === GUILD)!.deny).toBe(String(1 << 10));
    // a second run only fills what is missing
    const again = await ctl('POST', '/control/v1/discord/setup', { staffRoleId: ROLE });
    expect(((await again.json()) as { created: string[] }).created).toHaveLength(0);

    calls.length = 0;
    const t = await ctl('POST', '/control/v1/discord/test');
    const tj = (await t.json()) as { results: { ok: boolean }[] };
    expect(tj.results.length).toBe(8);
    expect(tj.results.every((x) => x.ok)).toBe(true);

    const mute = await ctl('PUT', '/control/v1/discord/mutes/frota', { minutes: 30 });
    expect(((await mute.json()) as { mutes: Record<string, string> }).mutes.frota).toBeTruthy();
    const unmute = await ctl('PUT', '/control/v1/discord/mutes/frota', { minutes: 0 });
    expect(
      ((await unmute.json()) as { mutes: Record<string, string> }).mutes.frota,
    ).toBeUndefined();
    expect((await ctl('PUT', '/control/v1/discord/mutes/nope', { minutes: 5 })).status).toBe(400);

    const bad = await ctl('PUT', '/control/v1/settings/discord', { channels: { crm: 'x' } });
    expect(bad.status).toBe(422);

    const report = await computeDigest(sql, '2026-10-01');
    expect(report.date).toBe('2026-10-01');
    expect(typeof report.vendas.orders).toBe('number');
    await sql`update control_settings set value = jsonb_set(value, '{digest}', '{"enabled": true, "hour": 0}'::jsonb) where key = 'discord'`;
    const today = (
      await sql<{ d: string }[]>`select (now() at time zone 'America/Sao_Paulo')::date::text as d`
    )[0]!.d;
    await sql`delete from staff_events where dedupe_key = ${`digest:${today}`}`;
    expect(await sweepDiscordDigest(sql)).toBe(true);
    expect(await sweepDiscordDigest(sql)).toBe(false);
    await sql`delete from staff_events where dedupe_key = ${`digest:${today}`}`;
  });
});
