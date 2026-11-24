import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { linkedTelegramMembers, normalizeStaff } from '../src/modules/staff-config.ts';
import {
  STAFF_EVENT_KIND_LIST,
  STAFF_EVENT_KINDS,
  recordStaffEvent,
  recordStaffEventTx,
  type StaffEventKind,
} from '../src/modules/staff-events.ts';
import {
  DEFAULT_TELEGRAM,
  telegramAppOf,
  telegramSettingOf,
  validateTelegramConfig,
  validateTelegramSetting,
} from '../src/modules/telegram/config.ts';
import {
  deliverStaffEvents,
  loudness,
  resetDeliveryClock,
} from '../src/modules/telegram/deliver.ts';
import { sweepTelegramDigest } from '../src/modules/telegram/digest.ts';
import { esc, fitMessage, quote, type InlineButton } from '../src/modules/telegram/format.ts';
import { render, type EventRow, type RenderCtx } from '../src/modules/telegram/render.ts';
import { resetRateLimits, type TelegramFetch } from '../src/modules/telegram/rest.ts';
import { verifyWebhookSecret } from '../src/modules/telegram/webhook.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// Staff events → per-member Telegram DMs (ADR 0047): formatting, webhook secret check, setting
// validation, card rendering for every kind, multi-DM delivery & living-card sync, one-tap
// /start link onboarding, commands, inline button actions, and CRM control routes.

const BOT_ID = '777000111';
const BOT_USER = 'vendua_test_bot';
const ANA_ID = '111111111';
const BIA_ID = '222222222';
const STRANGER_ID = '999999999';
const WEBHOOK_SECRET = '0123456789abcdef0123456789abcdef';

const rctx = (over: Partial<RenderCtx> = {}): RenderCtx => ({
  crm: (p) => `https://crm.test/control/#${p}`,
  excerpts: true,
  storeUrl: 'https://loja.test',
  store: null,
  now: new Date('2026-10-01T15:00:00Z'),
  ...over,
});

const ev = <K extends StaffEventKind>(
  kind: K,
  data: Record<string, unknown>,
  over: Partial<EventRow<K>> = {},
): EventRow<K> => ({
  id: 1,
  kind,
  tenant_id: null,
  severity: 'info',
  anchor: STAFF_EVENT_KINDS[kind].anchor?.key(data as never, over.tenant_id ?? null) ?? null,
  data: data as never,
  created_at: '2026-10-01T14:00:00Z',
  ...over,
});

const errCode = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};

describe('telegram formatting', () => {
  test('HTML escapes user text and safely quotes multiline input', () => {
    const s = esc('<script>alert("x")</script> & <b>bold</b>');
    expect(s).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;',
    );
    const short = quote('linha 1\n<tag>');
    expect(short).toBe('<blockquote>linha 1\n&lt;tag&gt;</blockquote>');
    const long = quote('a'.repeat(400));
    expect(long.startsWith('<blockquote expandable>')).toBe(true);
    expect(long.endsWith('</blockquote>')).toBe(true);
  });

  test('fitMessage clamps overlong HTML cleanly without unclosed tags', () => {
    const huge = `<b>${'x'.repeat(5000)}</b>`;
    const fit = fitMessage({ text: huge });
    expect(fit.text.length).toBeLessThanOrEqual(4096);
    expect(fit.text.endsWith('…</b>')).toBe(true);
  });

  test('fitMessage drops invalid URLs and callback_data > 64 bytes', () => {
    const fit = fitMessage({
      text: 'oi',
      buttons: [
        [
          { text: 'bad url', url: 'javascript:alert(1)' },
          { text: 'too long cb', callback_data: 'x'.repeat(65) },
          { text: 'good cb', callback_data: 'd:a:1234' },
          { text: 'good url', url: 'https://crm.test' },
        ],
        [{ text: 'empty row candidate', url: 'ftp://nope' }],
      ],
    });
    expect(fit.buttons).toEqual([
      [
        { text: 'good cb', callback_data: 'd:a:1234' },
        { text: 'good url', url: 'https://crm.test' },
      ],
    ]);
  });

  test('loudness: silent, muted, normal, ping, critical', () => {
    expect(loudness('silent', 'critical', false)).toEqual({ silent: true, urgent: false });
    expect(loudness('ping', 'critical', true)).toEqual({ silent: true, urgent: false });
    expect(loudness('normal', 'info', false)).toEqual({ silent: false, urgent: false });
    expect(loudness('ping', 'info', false)).toEqual({ silent: false, urgent: true });
    expect(loudness('normal', 'critical', false)).toEqual({ silent: false, urgent: true });
  });
});

describe('telegram webhook secret', () => {
  test('matches exact secret in constant time and rejects missing or wrong', () => {
    expect(verifyWebhookSecret(WEBHOOK_SECRET, WEBHOOK_SECRET)).toBe(true);
    expect(verifyWebhookSecret(WEBHOOK_SECRET, WEBHOOK_SECRET.slice(0, -1) + '0')).toBe(false);
    expect(verifyWebhookSecret(WEBHOOK_SECRET, 'short')).toBe(false);
    expect(verifyWebhookSecret(WEBHOOK_SECRET, undefined)).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
  });
});

describe('telegram config, setting & staff roster', () => {
  test('validation is strict, reading is lenient', () => {
    expect(errCode(() => validateTelegramSetting({ levels: { 'nope.x': 'normal' } }))).toBe(
      'BAD_REQUEST',
    );
    expect(errCode(() => validateTelegramSetting({ levels: { 'telegram.test': 'off' } }))).toBe(
      'BAD_REQUEST',
    );
    expect(errCode(() => validateTelegramSetting({ digest: { hour: 25 } }))).toBe('BAD_REQUEST');
    expect(errCode(() => validateTelegramSetting({ extra: true }))).toBe('BAD_REQUEST');
    expect(errCode(() => validateTelegramConfig({ botId: 'abc' }))).toBe('BAD_REQUEST');
    expect(errCode(() => validateTelegramConfig({ webhookSecret: 'short' }))).toBe('BAD_REQUEST');
    expect(
      errCode(() =>
        validateTelegramSetting({
          levels: { 'order.placed': 'silent' },
          digest: { enabled: true, hour: 9 },
          excerpts: false,
        }),
      ),
    ).toBeNull();

    expect(
      telegramSettingOf({
        levels: { 'order.placed': 'silent', 'bad.kind': 'normal' },
        digest: { hour: 99 },
      }),
    ).toEqual({
      ...DEFAULT_TELEGRAM,
      levels: { 'order.placed': 'silent' },
      digest: { enabled: true, hour: 8 },
    });
  });

  test('normalizeStaff validates Telegram IDs, drops legacy discord, and deduplicates DMs', () => {
    const cfg = normalizeStaff({
      members: [
        {
          name: 'Ana',
          email: 'ana@x.com',
          whatsapp: '',
          telegram: ANA_ID,
          telegramUsername: '@ana_v',
          discord: '123456789012345678',
        },
        { name: 'Ana Dup', email: '', whatsapp: '', telegram: ANA_ID },
        { name: 'Bia', email: '', whatsapp: '11999990000', telegram: BIA_ID },
      ],
    });
    expect(cfg.members[0]).toEqual({
      name: 'Ana',
      email: 'ana@x.com',
      whatsapp: '',
      telegram: ANA_ID,
      telegramUsername: 'ana_v',
    });
    expect('discord' in cfg.members[0]!).toBe(false);
    expect(linkedTelegramMembers(cfg)).toEqual([
      { chatId: ANA_ID, name: 'Ana', username: 'ana_v' },
      { chatId: BIA_ID, name: 'Bia', username: null },
    ]);
    expect(errCode(() => normalizeStaff({ members: [{ name: 'Bad', telegram: '123' }] }))).toBe(
      'BAD_REQUEST',
    );
  });

  test('telegramAppOf resolves integration against env token', () => {
    const prev = process.env.TG_UNIT_TEST_TOKEN;
    delete process.env.TG_UNIT_TEST_TOKEN;
    const row = {
      id: '1',
      kind: 'telegram' as const,
      driver: 'bot',
      enabled: true,
      config: { botId: BOT_ID, username: BOT_USER, webhookSecret: WEBHOOK_SECRET },
      secret_ref: 'TG_UNIT_TEST_TOKEN',
      created_at: '',
      updated_at: '',
    };
    const prevDef = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(telegramAppOf(row).ok).toBe(false);
    process.env.TG_UNIT_TEST_TOKEN = '123:abc';
    const ok = telegramAppOf(row);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.app.username).toBe(BOT_USER);
    if (prev !== undefined) process.env.TG_UNIT_TEST_TOKEN = prev;
    else delete process.env.TG_UNIT_TEST_TOKEN;
    if (prevDef !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevDef;
  });
});

describe('telegram cards', () => {
  test('an order card follows the order and cancellation produces a reply', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const e1 = ev('order.placed', {
      orderId: id,
      number: 42,
      storeName: 'Quero Pudim',
      totalCents: 6500,
      method: 'pix',
      fulfillment: 'delivery',
      items: 2,
      scheduledFor: null,
    });
    const e2 = ev(
      'order.updated',
      { orderId: id, number: 42, storeName: 'Quero Pudim', to: 'paid', actor: null },
      { id: 2, created_at: '2026-10-01T14:02:00Z' },
    );
    const e3 = ev(
      'order.updated',
      { orderId: id, number: 42, storeName: 'Quero Pudim', to: 'cancelled', actor: 'merchant' },
      { id: 3, created_at: '2026-10-01T14:05:00Z' },
    );
    const r1 = render(e1, [e1], rctx());
    expect(r1.card.text).toContain('pedido #42 · Quero Pudim');
    expect(r1.card.text).toContain('65,00');
    expect(r1.reply ?? null).toBeNull();
    const r2 = render(e2, [e1, e2], rctx());
    expect(r2.card.text).toContain('pago');
    expect(r2.reply ?? null).toBeNull();
    const r3 = render(e3, [e1, e2, e3], rctx());
    expect(r3.card.text).toContain('cancelado');
    expect(r3.reply).toContain('pedido #42');
  });

  test('a draft card has compact callback buttons and loses them once resolved', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const open = ev('draft.pending', {
      messageId: id,
      threadId: '33333333-3333-4333-8333-333333333333',
      leadId: '44444444-4444-4444-8444-444444444444',
      leadName: 'Carla',
      business: 'Doceria Sol',
      channel: 'whatsapp',
      subject: null,
      body: 'Oi Carla, tudo bem?',
    });
    const r1 = render(open, [open], rctx());
    const cbs = (r1.card.buttons ?? [])
      .flat()
      .map((b: InlineButton) => b.callback_data)
      .filter(Boolean);
    expect(cbs).toEqual([`d:a:${id}`, `d:w:${id}`, `d:r:${id}`]);
    for (const c of cbs) expect(Buffer.byteLength(c!, 'utf8')).toBeLessThanOrEqual(64);
    expect(r1.card.text).toContain('Oi Carla');

    const hidden = render(open, [open], rctx({ excerpts: false }));
    expect(hidden.card.text).not.toContain('Oi Carla');
    expect(hidden.card.text).toContain('conteúdo oculto');

    const resolved = ev(
      'draft.resolved',
      { messageId: id, outcome: 'approved', by: 'Ana' },
      { id: 2 },
    );
    const r2 = render(resolved, [open, resolved], rctx());
    const cbs2 = (r2.card.buttons ?? [])
      .flat()
      .map((b: InlineButton) => b.callback_data)
      .filter(Boolean);
    expect(cbs2).toEqual([]);
    expect(r2.card.text).toContain('aprovado por Ana');
  });

  test('an incident card escalates and resolves with duration', () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const open = ev('incident.opened', {
      incidentId: id,
      kind: 'probe_failing',
      severity: 'warning',
      storeName: 'Pudim',
      subject: 'probe:1',
      summary: 'sonda falhou',
    });
    const escEv = ev(
      'incident.updated',
      { incidentId: id, change: 'escalated', by: null, summary: 'sonda falhou 3x' },
      { id: 2, created_at: '2026-10-01T14:10:00Z' },
    );
    const done = ev(
      'incident.updated',
      { incidentId: id, change: 'resolved', by: 'Bia', summary: 'sonda falhou 3x' },
      { id: 3, created_at: '2026-10-01T14:25:00Z' },
    );
    const rEsc = render(escEv, [open, escEv], rctx());
    expect(rEsc.reply).toContain('crítico');
    const rDone = render(done, [open, escEv, done], rctx());
    expect(rDone.card.text).toContain('resolvido por Bia');
    expect(rDone.card.text).toContain('25 min');
    expect(rDone.reply).toContain('25 min');
  });

  test('every kind in STAFF_EVENT_KIND_LIST renders cleanly within Telegram limits', () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const base: Record<string, unknown> = {
      taskId: id,
      leadId: id,
      threadId: id,
      messageId: id,
      meetingId: id,
      orderId: id,
      invoiceId: id,
      releaseId: id,
      incidentId: id,
      runId: id,
      leadName: 'Ana',
      business: 'Bolo',
      storeName: 'Bolo',
      slug: 'bolo',
      host: 'bolo.vendua.com.br',
      channel: 'whatsapp',
      reason: 'motivo',
      by: 'Ana',
      outcome: 'approved',
      who: 'Ana',
      topic: 'pedidos',
      message: 'msg',
      contact: '11999990000',
      title: 'titulo',
      detail: 'detalhe',
      kind: 'generate',
      dueAt: '2026-10-02T12:00:00Z',
      prUrl: 'https://github.com/x/y/pull/1',
      mode: 'custom',
      amountCents: 10000,
      plan: 'Pro',
      excerpt: 'oi',
      from: 'lead',
      to: 'paid',
      startsAt: '2026-10-02T14:00:00Z',
      source: 'signup',
      roomUrl: 'https://room.test/1',
      change: 'resolved',
      number: 1,
      totalCents: 2500,
      method: 'pix',
      fulfillment: 'delivery',
      items: 2,
      scheduledFor: null,
      actor: null,
      status: 'refunded',
      connected: true,
      step: 'connected',
      owner: 'Ana',
      first: true,
      problem: 'past_due',
      bundle: '_template',
      kernel: '1.0.0',
      promoted: 3,
      rolledBackTo: id,
      action: 'promote',
      name: 'Parceiro',
      city: 'SP',
      severity: 'warning',
      subject: 'sonda',
      summary: 'resumo',
      job: 'reply',
      error: 'boom',
      attempts: 3,
      agentId: 'crm',
      version: '1',
      actorId: 'a1',
      stage: 'canary',
      reasons: ['falha'],
      mean: 2.1,
      window: 20,
      threshold: 3.5,
      metric: 'blocks',
      today: 12,
      baseline: 3,
      volume: 50,
      spentCents: 500,
      capCents: 500,
      bootsLastHour: 4,
      path: '/x',
      count: 2,
      label: 'rotina',
      failingSince: '2026-10-01T13:00:00Z',
      body: 'texto',
      resolved: false,
      date: '2026-10-01',
      crm: {
        newLeads: 1,
        replies: 2,
        meetingsBooked: 1,
        meetingsNext24h: 1,
        milestones: 1,
        pendingDrafts: 1,
        openTasks: 1,
      },
      agent: { runs: 3, failedRuns: 0, costCents: 12 },
      vendas: { orders: 2, gmvCents: 5000, cancelled: 0, stores: 1, top: [], firstOrders: [] },
      assinaturas: { newStores: 1, paid: 1, paidCents: 9900, problems: 0 },
      frota: { storesLive: 1, openIncidents: 0, failedDeployments: 0 },
      sistema: { errors: 0, boots: 1, failingJobs: [] },
    };
    for (const kind of STAFF_EVENT_KIND_LIST) {
      const out = render(ev(kind, base), [ev(kind, base)], rctx());
      const fit = fitMessage(out.card);
      expect(fit.text.length).toBeGreaterThan(0);
      expect(fit.text.length).toBeLessThanOrEqual(4096);
      for (const b of (fit.buttons ?? []).flat()) {
        if (b.callback_data)
          expect(Buffer.byteLength(b.callback_data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });
});

// ── DB + HTTP integration tests ──────────────────────────────────────────────

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
  isForm: boolean;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('telegram bot (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  );

  let calls: RecordedCall[] = [];
  let nextMsgId = 100;
  let responder: ((method: string, body: Record<string, unknown>) => Response | null) | null = null;

  const tgFetch: TelegramFetch = async (url, init) => {
    const method = url.split('/').pop() ?? '';
    const isForm = init.body instanceof FormData;
    const body = isForm
      ? {}
      : typeof init.body === 'string' && init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    calls.push({ method, body, isForm });
    const custom = responder?.(method, body);
    if (custom) return custom;
    if (method === 'getMe') {
      return Response.json({
        ok: true,
        result: { id: Number(BOT_ID), is_bot: true, first_name: 'Venduá', username: BOT_USER },
      });
    }
    if (method === 'getUserProfilePhotos') {
      return Response.json({ ok: true, result: { total_count: 0, photos: [] } });
    }
    if (method === 'getWebhookInfo') {
      return Response.json({
        ok: true,
        result: { url: 'https://crm.test/control/v1/telegram/webhook' },
      });
    }
    if (method === 'sendMessage') {
      return Response.json({ ok: true, result: { message_id: ++nextMsgId } });
    }
    return Response.json({ ok: true, result: true });
  };

  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    telegramFetch: tgFetch,
  });

  let seq = 0;
  async function ctl(method: string, path: string, body?: unknown) {
    const res = await app.request(`/control/v1${path}`, {
      method,
      headers: {
        'x-vendua-control': 'ctl',
        ...(method !== 'GET' ? { 'idempotency-key': `tg-test-${++seq}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function webhook(update: Record<string, unknown>, secret: string | null = WEBHOOK_SECRET) {
    const res = await app.request('/control/v1/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret !== null ? { 'x-telegram-bot-api-secret-token': secret } : {}),
      },
      body: JSON.stringify(update),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function seedBot(
    members: Record<string, unknown>[] = [
      { name: 'Ana', email: 'ana@vendua.test', whatsapp: '', telegram: ANA_ID },
    ],
  ) {
    process.env.TELEGRAM_TEST_TOKEN = '777000111:TEST_TOKEN';
    await controlTx(sql, async (tx) => {
      await tx`
        insert into control_integrations (kind, driver, enabled, config, secret_ref)
        values ('telegram', 'bot', true,
                ${tx.json({ botId: BOT_ID, username: BOT_USER, firstName: 'Venduá', webhookSecret: WEBHOOK_SECRET } as never)},
                'TELEGRAM_TEST_TOKEN')
        on conflict (kind, driver) do update
          set enabled = true, config = excluded.config, secret_ref = excluded.secret_ref
      `;
      await tx`
        insert into control_settings (key, value)
        values ('staff', ${tx.json({ members } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      await tx`
        insert into control_settings (key, value)
        values ('meeting', ${tx.json({ publicBaseUrl: 'https://crm.test' } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      await tx`
        insert into control_settings (key, value)
        values ('telegram', ${tx.json({ levels: {}, digest: { enabled: true, hour: 8 }, excerpts: true } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      await tx`delete from control_settings where key = 'telegram_state'`;
    });
  }

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  beforeEach(async () => {
    calls = [];
    responder = null;
    resetRateLimits();
    resetDeliveryClock();
    await controlTx(sql, async (tx) => {
      await tx`delete from telegram_dm_outbox`;
      await tx`delete from telegram_prompts`;
      await tx`delete from telegram_proposals`;
      await tx`delete from staff_event_messages`;
      await tx`delete from staff_events`;
      await tx`delete from control_integrations where kind = 'telegram'`;
      await tx`delete from control_settings where key in ('telegram', 'telegram_state', 'staff')`;
      await tx`delete from control_idempotency_keys where key like 'tg-test-%' or key like 'telegram:%'`;
    });
  });

  afterAll(async () => {
    delete process.env.TELEGRAM_TEST_TOKEN;
    await appSql.end();
    await sql.end();
  });

  test('delivers to every linked staff DM, edits both on follow-up, and replies when important', async () => {
    await seedBot([
      { name: 'Ana', email: 'ana@vendua.test', whatsapp: '', telegram: ANA_ID },
      { name: 'Bia', email: 'bia@vendua.test', whatsapp: '', telegram: BIA_ID },
    ]);
    const oid = 'aaaaaaaa-1111-4111-8111-111111111111';
    await recordStaffEvent(appSql, 'order.placed', {
      orderId: oid,
      number: 7,
      storeName: 'Pudim',
      totalCents: 4500,
      method: 'pix',
      fulfillment: 'delivery',
      items: 1,
      scheduledFor: null,
    });

    const d1 = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(d1.n).toBe(1);
    const sends = calls.filter((c) => c.method === 'sendMessage');
    expect(sends.map((s) => s.body.chat_id)).toEqual([ANA_ID, BIA_ID]);
    expect(String(sends[0]!.body.text)).toContain('pedido #7 · Pudim');

    // Follow-up cancellation edits BOTH DMs and replies under each card
    calls = [];
    await recordStaffEvent(appSql, 'order.updated', {
      orderId: oid,
      number: 7,
      storeName: 'Pudim',
      to: 'cancelled',
      actor: 'merchant',
    });
    const d2 = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(d2.n).toBe(1);
    const edits = calls.filter((c) => c.method === 'editMessageText');
    expect(edits.map((e) => e.body.chat_id)).toEqual([ANA_ID, BIA_ID]);
    expect(String(edits[0]!.body.text)).toContain('cancelado');
    const replies = calls.filter((c) => c.method === 'sendMessage');
    expect(replies.map((r) => r.body.chat_id)).toEqual([ANA_ID, BIA_ID]);
    expect(replies[0]!.body.reply_parameters).toBeDefined();
  });

  test('one teammate blocking the bot does not stop delivery to the rest', async () => {
    await seedBot([
      { name: 'Ana', email: '', whatsapp: '', telegram: ANA_ID },
      { name: 'Bia', email: '', whatsapp: '', telegram: BIA_ID },
    ]);
    responder = (method, body) => {
      if (method === 'sendMessage' && body.chat_id === ANA_ID) {
        return Response.json(
          { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
          { status: 403 },
        );
      }
      return null;
    };
    await recordStaffEvent(appSql, 'system.boot', { bootsLastHour: 1, version: 'abc123' });
    const d = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(d.n).toBe(1);
    const sentToBia = calls.filter((c) => c.method === 'sendMessage' && c.body.chat_id === BIA_ID);
    expect(sentToBia).toHaveLength(1);
    expect(sentToBia[0]!.body.disable_notification).toBe(true);
  });

  test('off is skipped, silent and muted suppress notifications, storm collapses', async () => {
    await seedBot();
    const putRes = await ctl('PUT', '/settings/telegram', {
      value: {
        levels: { 'system.boot': 'off', 'lead.created': 'normal' },
        digest: { enabled: true, hour: 8 },
        excerpts: true,
      },
    });
    expect(putRes.status).toBe(200);
    await recordStaffEvent(appSql, 'system.boot', { bootsLastHour: 1, version: null });
    // 7 lead.created events → first 3 sent individually + 1 collapsed summary for the rest (4)
    for (let k = 0; k < 7; k++) {
      await recordStaffEvent(appSql, 'lead.created', {
        leadId: `00000000-0000-4000-8000-00000000000${k}`,
        leadName: `Lead ${k}`,
        business: null,
        channel: 'whatsapp',
        excerpt: 'oi',
      });
    }
    const d = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(d.n).toBe(7);
    const sends = calls.filter((c) => c.method === 'sendMessage');
    expect(sends).toHaveLength(4);
    expect(String(sends[3]!.body.text)).toContain('+4 ×');
    expect(sends[3]!.body.disable_notification).toBe(true);
  });

  test('a rate limit ends the pass and refunds remaining attempts', async () => {
    await seedBot();
    responder = (method) => {
      if (method === 'sendMessage') {
        return Response.json(
          {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 12 },
          },
          { status: 429 },
        );
      }
      return null;
    };
    await recordStaffEvent(appSql, 'system.boot', { bootsLastHour: 1, version: null });
    const d = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(d.n).toBe(0);
    expect(d.retryInMs).toBe(12_000);
    const [row] = await controlTx(
      sql,
      (tx) => tx<{ state: string; attempts: number }[]>`
      select state, attempts from staff_events limit 1
    `,
    );
    expect(row).toEqual({ state: 'pending', attempts: 0 });
  });

  test('store tx can insert into staff_events but cannot read staff_events or staff_event_messages', async () => {
    const [tenant] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, status)
      values (${`tg-rls-${Date.now()}`}, 'RLS Store', 'active')
      returning id
    `;
    try {
      await withTenant(appSql, tenant!.id, async (tx) => {
        await recordStaffEventTx(
          tx,
          'order.placed',
          {
            orderId: 'bbbbbbbb-1111-4111-8111-111111111111',
            number: 1,
            storeName: 'RLS Store',
            totalCents: 1000,
            method: 'pix',
            fulfillment: 'pickup',
            items: 1,
            scheduledFor: null,
          },
          { tenantId: tenant!.id },
        );
        const readEvents = await tx`select id from staff_events`;
        const readMsgs = await tx`select event_id from staff_event_messages`;
        expect(readEvents).toHaveLength(0);
        expect(readMsgs).toHaveLength(0);
      });
    } finally {
      await sql`delete from tenants where id = ${tenant!.id}`;
    }
  });

  test('one-tap /start link_<token> auto-links a staff DM and rejects replay', async () => {
    await seedBot([]);
    const linkRes = await ctl('POST', '/telegram/link', {});
    expect(linkRes.status).toBe(200);
    const url = String(linkRes.body.url);
    expect(url).toMatch(new RegExp(`^https://t\\.me/${BOT_USER}\\?start=link_`));
    const payload = new URL(url).searchParams.get('start')!;

    // Bad secret rejected
    expect((await webhook({ update_id: 1 }, 'wrong')).status).toBe(401);

    // Tap Start in Telegram
    const w1 = await webhook({
      update_id: 10,
      message: {
        message_id: 1,
        from: { id: Number(ANA_ID), first_name: 'Ana', last_name: 'Silva', username: 'anasilva' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: `/start ${payload}`,
      },
    });
    expect(w1.status).toBe(200);
    const reply1 = calls.find((c) => c.method === 'sendMessage');
    expect(String(reply1?.body.text)).toContain('pronto, Ana Silva');

    // Member is now linked on Equipe
    const overview = await ctl('GET', '/telegram');
    expect((overview.body.team as { linked: number }).linked).toBe(1);

    // Replaying the same token fails cleanly
    calls = [];
    await webhook({
      update_id: 11,
      message: {
        message_id: 2,
        from: { id: Number(STRANGER_ID), first_name: 'Intruso' },
        chat: { id: Number(STRANGER_ID), type: 'private' },
        text: `/start ${payload}`,
      },
    });
    expect(String(calls[0]?.body.text)).toContain('já foi usado ou expirou');
  });

  test('webhook: strangers get their ID; staff commands and /silenciar work', async () => {
    await seedBot();
    await webhook({
      update_id: 20,
      message: {
        message_id: 1,
        from: { id: Number(STRANGER_ID), first_name: 'Estranho' },
        chat: { id: Number(STRANGER_ID), type: 'private' },
        text: '/hoje',
      },
    });
    expect(String(calls[0]?.body.text)).toContain(STRANGER_ID);

    calls = [];
    await webhook({
      update_id: 21,
      message: {
        message_id: 2,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: '/hoje',
      },
    });
    expect(String(calls[0]?.body.text)).toContain('hoje na Venduá');

    // Interactive /silenciar menu + callback tap
    calls = [];
    await webhook({
      update_id: 22,
      message: {
        message_id: 3,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: '/silenciar',
      },
    });
    expect(String(calls[0]?.body.text)).toContain('silenciar avisos');

    calls = [];
    await webhook({
      update_id: 23,
      callback_query: {
        id: 'cb-mute-1',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 300, chat: { id: Number(ANA_ID), type: 'private' } },
        data: 'm:vendas:60',
      },
    });
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
    const editMute = calls.find((c) => c.method === 'editMessageText');
    expect(String(editMute?.body.text)).toContain('Ana silenciou');
  });

  test('inline button approves draft, attributes to member, and syncs every teammate DM', async () => {
    await seedBot([
      { name: 'Ana', email: 'ana@vendua.test', whatsapp: '', telegram: ANA_ID },
      { name: 'Bia', email: 'bia@vendua.test', whatsapp: '', telegram: BIA_ID },
    ]);
    const lead = await controlTx(appSql, (tx) => insertLeadTx(tx, { name: 'Padaria Sol' }));
    const leadId = lead.body.lead.id;
    const { threadId, msgId } = await controlTx(sql, async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
      `;
      const [m] = await tx<{ id: string }[]>`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${t!.id}, 'out', 'agent', 'Olá, tudo bem?', 'draft')
        returning id
      `;
      await recordStaffEventTx(tx, 'draft.pending', {
        messageId: m!.id,
        threadId: t!.id,
        leadId,
        leadName: 'Padaria Sol',
        business: null,
        channel: 'whatsapp',
        subject: null,
        body: 'Olá, tudo bem?',
      });
      return { threadId: t!.id, msgId: m!.id };
    });

    // Deliver the draft card to both Ana and Bia
    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const anaSend = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === ANA_ID);
    const biaSend = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === BIA_ID);
    expect(anaSend).toBeDefined();
    expect(biaSend).toBeDefined();

    // Ana clicks "aprovar e enviar" in her DM
    calls = [];
    await webhook({
      update_id: 30,
      callback_query: {
        id: 'cb-approve-1',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 101, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `d:a:${msgId}`,
      },
    });
    const [dbMsg] = await controlTx(
      sql,
      (tx) => tx<{ status: string; approved_by: string | null }[]>`
      select status, approved_by from lead_messages where id = ${msgId}
    `,
    );
    expect(dbMsg?.approved_by).toBe('Ana');
    expect(['queued', 'sending', 'sent', 'failed']).toContain(dbMsg?.status ?? '');
    // BOTH Ana's and Bia's cards got edited in sync!
    const edits = calls.filter((c) => c.method === 'editMessageText');
    expect(new Set(edits.map((e) => e.body.chat_id))).toEqual(new Set([ANA_ID, BIA_ID]));
    expect(String(edits[0]!.body.text)).toContain('aprovado por Ana');
    expect(threadId).toBeTruthy();
  });

  test('handoff take/done and incident ack/resolve sync across both teammate DMs', async () => {
    await seedBot([
      { name: 'Ana', email: 'ana@vendua.test', whatsapp: '', telegram: ANA_ID },
      { name: 'Bia', email: 'bia@vendua.test', whatsapp: '', telegram: BIA_ID },
    ]);
    const lead = await controlTx(appSql, (tx) => insertLeadTx(tx, { name: 'Doceria Flor' }));
    const leadId = lead.body.lead.id;
    const taskId = await controlTx(sql, async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${leadId}, '[humano] precisa de proposta custom', now(), 'agent')
        returning id
      `;
      await recordStaffEventTx(tx, 'handoff.requested', {
        taskId: t!.id,
        leadId,
        leadName: 'Doceria Flor',
        business: null,
        channel: 'whatsapp',
        threadId: null,
        reason: 'cliente pediu 5 lojas',
      });
      return t!.id;
    });

    const incId = await controlTx(sql, async (tx) => {
      const [inc] = await tx<{ id: string }[]>`
        insert into fleet_incidents (tenant_id, kind, severity, subject, summary, detail)
        values (null, 'probe_failing', 'critical', ${`tg-inc-${Date.now()}`}, 'loja fora do ar', ${tx.json({} as never)})
        returning id
      `;
      await recordStaffEventTx(tx, 'incident.opened', {
        incidentId: inc!.id,
        kind: 'probe_failing',
        severity: 'critical',
        subject: 'pudim.vendua.com.br',
        summary: 'loja fora do ar',
        storeName: 'Pudim',
      });
      return inc!.id;
    });

    await deliverStaffEvents(appSql, { fetch: tgFetch });

    // Ana takes the handoff → owner becomes Ana and both DMs update
    calls = [];
    await webhook({
      update_id: 40,
      callback_query: {
        id: 'cb-handoff-take',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 201, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `h:t:${taskId}`,
      },
    });
    const [leadAfter] = await controlTx(
      sql,
      (tx) => tx<{ owner: string | null }[]>`
      select owner from leads where id = ${leadId}
    `,
    );
    expect(leadAfter?.owner).toBe('Ana');
    const hEdits = calls.filter((c) => c.method === 'editMessageText');
    expect(new Set(hEdits.map((e) => e.body.chat_id))).toEqual(new Set([ANA_ID, BIA_ID]));
    expect(String(hEdits[0]!.body.text)).toContain('assumido por Ana');

    // Bia marks the handoff done → done_at set and both DMs update
    calls = [];
    await webhook({
      update_id: 41,
      callback_query: {
        id: 'cb-handoff-done',
        from: { id: Number(BIA_ID), first_name: 'Bia' },
        message: { message_id: 202, chat: { id: Number(BIA_ID), type: 'private' } },
        data: `h:d:${taskId}`,
      },
    });
    const [taskAfter] = await controlTx(
      sql,
      (tx) => tx<{ done_at: Date | null }[]>`
      select done_at from lead_tasks where id = ${taskId}
    `,
    );
    expect(taskAfter?.done_at).not.toBeNull();
    expect(
      new Set(calls.filter((c) => c.method === 'editMessageText').map((e) => e.body.chat_id)),
    ).toEqual(new Set([ANA_ID, BIA_ID]));

    // Ana acks then Bia resolves the incident → both DMs stay in sync
    calls = [];
    await webhook({
      update_id: 42,
      callback_query: {
        id: 'cb-inc-ack',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 203, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `i:a:${incId}`,
      },
    });
    const [incAcked] = await controlTx(
      sql,
      (tx) => tx<{ acked_at: Date | null }[]>`
      select acked_at from fleet_incidents where id = ${incId}
    `,
    );
    expect(incAcked?.acked_at).not.toBeNull();
    const ackEdits = calls.filter((c) => c.method === 'editMessageText');
    expect(new Set(ackEdits.map((e) => e.body.chat_id))).toEqual(new Set([ANA_ID, BIA_ID]));
    expect(String(ackEdits[0]!.body.text)).toContain('Ana');

    calls = [];
    await webhook({
      update_id: 43,
      callback_query: {
        id: 'cb-inc-res',
        from: { id: Number(BIA_ID), first_name: 'Bia' },
        message: { message_id: 204, chat: { id: Number(BIA_ID), type: 'private' } },
        data: `i:r:${incId}`,
      },
    });
    const [incResolved] = await controlTx(
      sql,
      (tx) => tx<{ resolved_at: Date | null }[]>`
      select resolved_at from fleet_incidents where id = ${incId}
    `,
    );
    expect(incResolved?.resolved_at).not.toBeNull();
    expect(
      new Set(calls.filter((c) => c.method === 'editMessageText').map((e) => e.body.chat_id)),
    ).toEqual(new Set([ANA_ID, BIA_ID]));
  });

  test('DM commands (/pendencias, /lead, /loja, /frota, /resumo, /bot, /ajuda) and stale button refusal', async () => {
    await seedBot();
    for (const [idx, cmd] of [
      '/pendencias',
      '/lead',
      '/loja',
      '/frota',
      '/resumo',
      '/bot',
      '/ajuda',
    ].entries()) {
      calls = [];
      await webhook({
        update_id: 50 + idx,
        message: {
          message_id: 50 + idx,
          from: { id: Number(ANA_ID), first_name: 'Ana' },
          chat: { id: Number(ANA_ID), type: 'private' },
          text: cmd,
        },
      });
      const sent = calls.find((c) => c.method === 'sendMessage');
      expect(sent).toBeDefined();
      expect(String(sent?.body.text).length).toBeGreaterThan(0);
    }

    // Unknown / legacy callback_data gets a friendly alert
    calls = [];
    await webhook({
      update_id: 70,
      callback_query: {
        id: 'cb-stale',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 99, chat: { id: Number(ANA_ID), type: 'private' } },
        data: 'legacy:button:123',
      },
    });
    const ans = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(ans?.body.show_alert).toBe(true);
    expect(String(ans?.body.text)).toContain('versão antiga');
  });

  test('connect reads bot from token, registers webhook/commands/avatar, redacts secrets, and handles missing token', async () => {
    const saved = [process.env.TELEGRAM_TEST_TOKEN, process.env.TELEGRAM_BOT_TOKEN];
    delete process.env.TELEGRAM_TEST_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const missing = await ctl('POST', '/telegram/connect', {});
    expect(missing.status).toBe(422);

    process.env.TELEGRAM_BOT_TOKEN = '777000111:CONNECT_TOKEN';
    await controlTx(
      sql,
      (tx) => tx`
      insert into control_settings (key, value)
      values ('meeting', ${tx.json({ publicBaseUrl: 'https://crm.test' } as never)})
      on conflict (key) do update set value = excluded.value
    `,
    );
    const conn = await ctl('POST', '/telegram/connect', {});
    expect(conn.status).toBe(200);
    expect(conn.body.username).toBe(BOT_USER);
    expect((conn.body.webhook as { ok: boolean }).ok).toBe(true);
    expect(calls.some((c) => c.method === 'setWebhook')).toBe(true);
    expect(calls.some((c) => c.method === 'setMyCommands')).toBe(true);
    expect(calls.some((c) => c.method === 'setMyProfilePhoto' && c.isForm)).toBe(true);

    // Security: webhookSecret is never returned by GET /integrations, and telegram_state is hidden from GET/PUT /settings
    const ints = await ctl('GET', '/integrations');
    const tgInt = (
      ints.body.integrations as { kind: string; config: Record<string, unknown> }[]
    ).find((i) => i.kind === 'telegram');
    expect(tgInt?.config.username).toBe(BOT_USER);
    expect(tgInt?.config.webhookSecret).toBeUndefined();

    const sets = await ctl('GET', '/settings');
    expect((sets.body.settings as { key: string }[]).some((s) => s.key === 'telegram_state')).toBe(
      false,
    );
    expect((await ctl('PUT', '/settings/telegram_state', { value: {} })).status).toBe(422);

    // Generic integration test endpoint verifies token + webhook
    const intTest = await ctl('POST', '/integrations/telegram/test', {});
    expect(intTest.status).toBe(200);
    expect(intTest.body.ok).toBe(true);

    // CRM test DM, mutes, digest, disconnect, and retired discord setting
    const staffPut = await ctl('PUT', '/settings/staff', {
      value: { members: [{ name: 'Ana', email: 'ana@x.com', whatsapp: '', telegram: ANA_ID }] },
    });
    expect(staffPut.status).toBe(200);
    const testRes = await ctl('POST', '/telegram/test', {});
    expect(testRes.status).toBe(200);
    expect((testRes.body.results as { ok: boolean }[])[0]?.ok).toBe(true);

    const m = await ctl('PUT', '/telegram/mutes/frota', { minutes: 30 });
    expect(m.status).toBe(200);
    expect((m.body.mutes as Record<string, string>).frota).toBeTruthy();
    expect((await ctl('PUT', '/telegram/mutes/nope', { minutes: 30 })).status).toBe(400);
    expect((await ctl('PUT', '/settings/discord', { value: {} })).status).toBe(422);

    const tgPut = await ctl('PUT', '/settings/telegram', {
      value: { levels: {}, digest: { enabled: true, hour: 0 }, excerpts: true },
    });
    expect(tgPut.status).toBe(200);
    expect(await sweepTelegramDigest(appSql)).toBe(true);
    expect(await sweepTelegramDigest(appSql)).toBe(false);

    const disc = await ctl('POST', '/telegram/disconnect', {});
    expect(disc.status).toBe(200);
    expect(calls.some((c) => c.method === 'deleteWebhook')).toBe(true);

    if (saved[0] !== undefined) process.env.TELEGRAM_TEST_TOKEN = saved[0];
    else delete process.env.TELEGRAM_TEST_TOKEN;
    if (saved[1] !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved[1];
    else delete process.env.TELEGRAM_BOT_TOKEN;
  });
});
