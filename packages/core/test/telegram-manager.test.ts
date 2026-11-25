import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
import {
  CRM_MANAGER_AGENT_ID,
  crmManager,
  telegramManagerTransport,
} from '../src/agent-host/agents/crm-manager/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { CRM_AGENT_ID, CRM_STRATEGIST_ID } from '../src/crm/jobs.ts';
import { agentSettingTx, type AgentSetting } from '../src/crm/policy.ts';
import { controlTx } from '../src/modules/control.ts';
import { subscribeControlEvents } from '../src/modules/control-events.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { recordStaffEventTx } from '../src/modules/staff-events.ts';
import { deliverStaffEvents, resetDeliveryClock } from '../src/modules/telegram/deliver.ts';
import { markdownToTelegramHtml } from '../src/modules/telegram/format.ts';
import { triggerBoardRun } from '../src/modules/telegram/manager-ops.ts';
import { resetRateLimits, type TelegramFetch } from '../src/modules/telegram/rest.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';
import type { MediaProviders } from '../src/vendedor/media.ts';

// Sales-agent management from Telegram DM (ADR 0047 + migration 0145):
// - Swipe-reply & ForceReply prompts on Handoff, Draft, and Lead cards (text + voice notes)
// - Deterministic /agente, /ensinar, /memoria, /lead controls, and /nova reset
// - Real Agent Runtime v3 `crm-manager` turns with read, instant coaching, and 1-tap proposal cards
// - RLS isolation on telegram_dm_outbox, telegram_prompts, and telegram_proposals

const BOT_ID = '777000222';
const BOT_USER = 'vendua_mgr_bot';
const ANA_ID = '333333333';
const BIA_ID = '444444444';
const WEBHOOK_SECRET = 'fedcba9876543210fedcba9876543210';

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));

describe('markdownToTelegramHtml', () => {
  test('escapes raw HTML and converts markdown safely', () => {
    const out = markdownToTelegramHtml(
      'Olá **Ana** <script>alert(1)</script> — use `/agente` e veja *isso* [CRM](https://crm.test)',
    );
    expect(out).toContain('<b>Ana</b>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('<code>/agente</code>');
    expect(out).toContain('<i>isso</i>');
    expect(out).toContain('<a href="https://crm.test">CRM</a>');
  });
});

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('telegram sales-agent manager (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  ) as unknown as Sql;

  let calls: RecordedCall[] = [];
  let nextMsgId = 500;
  let nextTranscript: string | null =
    'diz que não integramos com iFood mas pode oferecer 1 mês grátis';

  const tgFetch: TelegramFetch = async (url, init) => {
    if (url.includes('/file/bot')) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
      });
    }
    const method = url.split('/').pop() ?? '';
    const body =
      typeof init.body === 'string' && init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    calls.push({ method, body });
    if (method === 'getFile') {
      return Response.json({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: 4 } });
    }
    if (method === 'sendMessage') {
      return Response.json({ ok: true, result: { message_id: ++nextMsgId } });
    }
    return Response.json({ ok: true, result: true });
  };

  const fakeMedia: MediaProviders = {
    async transcribe() {
      return nextTranscript ? { text: nextTranscript, confidence: 0.96, language: 'pt' } : null;
    },
    async canTranscribe() {
      return nextTranscript !== null;
    },
    async speak() {
      return null;
    },
  };

  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    telegramFetch: tgFetch,
    duaMedia: { media: fakeMedia, gateway: null },
  });

  async function webhook(update: Record<string, unknown>) {
    const res = await app.request('/control/v1/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  let lastAdapter: ReturnType<typeof scriptedAdapter> | null = null;
  function managerRuntime(script: ScriptedOutput[]) {
    const adapter = scriptedAdapter(script);
    lastAdapter = adapter;
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    return new Runtime<Sql>({
      agents: [crmManager],
      store: new PgActorStore(appSql),
      gateway,
      transports: [telegramManagerTransport],
      owner: `tg-mgr-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
  }

  async function pumpManager(rt: Runtime<Sql>) {
    for (let i = 0; i < 10; i++) {
      if ((await rt.pump('interactive', { limit: 10, perTenantCap: 10 })) === 0) break;
    }
  }

  async function seedBot() {
    process.env.TELEGRAM_MGR_TOKEN = '777000222:MGR_TOKEN';
    await controlTx(sql, async (tx) => {
      await tx`
        insert into control_integrations (kind, driver, enabled, config, secret_ref)
        values ('telegram', 'bot', true,
                ${tx.json({ botId: BOT_ID, username: BOT_USER, firstName: 'Venduá', webhookSecret: WEBHOOK_SECRET } as never)},
                'TELEGRAM_MGR_TOKEN')
        on conflict (kind, driver) do update
          set enabled = true, config = excluded.config, secret_ref = excluded.secret_ref
      `;
      await tx`
        insert into control_settings (key, value)
        values ('staff', ${tx.json({
          members: [
            { name: 'Ana', email: 'ana@vendua.test', whatsapp: '', telegram: ANA_ID },
            { name: 'Bia', email: 'bia@vendua.test', whatsapp: '', telegram: BIA_ID },
          ],
        } as never)})
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
      await tx`
        insert into control_settings (key, value)
        values ('agent', ${tx.json({
          level: 'supervised',
          jobs: { reply: true, outreach: true, discovery: true, strategist: true },
          instructions: '- seja direto',
        } as never)})
        on conflict (key) do update set value = excluded.value
      `;
    });
  }

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  beforeEach(async () => {
    calls = [];
    nextTranscript = 'diz que não integramos com iFood mas pode oferecer 1 mês grátis';
    resetRateLimits();
    resetDeliveryClock();
    await controlTx(sql, async (tx) => {
      await tx`delete from telegram_dm_outbox`;
      await tx`delete from telegram_prompts`;
      await tx`delete from telegram_proposals`;
      await tx`delete from staff_event_messages`;
      await tx`delete from staff_events`;
      await tx`delete from agent_memory_items`;
      await tx`delete from agent_mailbox where tenant_id = ${PLATFORM_TENANT_ID}`;
      await tx`delete from agent_actors where tenant_id = ${PLATFORM_TENANT_ID}`;
      await tx`delete from control_idempotency_keys where key like 'telegram:%' or key like 'tg-mgr:%'`;
      await tx`delete from control_settings where key = 'telegram_state'`;
    });
    await seedBot();
  });

  afterAll(async () => {
    delete process.env.TELEGRAM_MGR_TOKEN;
    await appSql.end();
    await sql.end();
  });

  test('swipe-replying to a Handoff card with a voice note answers the agent, unpauses lead, resolves handoff, and syncs all DMs', async () => {
    const lead = await controlTx(appSql, (tx) =>
      insertLeadTx(tx, { name: 'Pizzaria Roma', whatsapp: '+5511999991111' }),
    );
    const leadId = lead.body.lead.id;
    const taskId = await controlTx(sql, async (tx) => {
      await tx`update leads set agent_paused_at = now() where id = ${leadId}`;
      const [th] = await tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
      `;
      const [tk] = await tx<{ id: string }[]>`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${leadId}, '[humano] cliente perguntou se integramos com iFood', now(), 'agent')
        returning id
      `;
      await recordStaffEventTx(tx, 'handoff.requested', {
        taskId: tk!.id,
        leadId,
        leadName: 'Pizzaria Roma',
        business: null,
        channel: 'whatsapp',
        threadId: th!.id,
        reason: 'cliente perguntou se integramos com iFood',
      });
      return tk!.id;
    });

    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const anaMsgId = Number(
      (
        await controlTx(
          sql,
          (tx) => tx<{ message_id: string }[]>`
            select message_id from staff_event_messages
            where chat_id = ${ANA_ID} and anchor = ${`handoff:${taskId}`}
          `,
        )
      )[0]!.message_id,
    );

    // Ana swipe-replies to the Handoff card with a voice note
    calls = [];
    const w = await webhook({
      update_id: 1001,
      message: {
        message_id: 801,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        reply_to_message: { message_id: anaMsgId },
        voice: { file_id: 'voice-abc', duration: 6, mime_type: 'audio/ogg', file_size: 4096 },
      },
    });
    expect(w.status).toBe(200);

    // Task resolved, lead unpaused, and crmAgent woken with transcribed guidance
    const [taskAfter] = await controlTx(
      sql,
      (tx) => tx<{ done_at: Date | null }[]>`
      select done_at from lead_tasks where id = ${taskId}
    `,
    );
    const [leadAfter] = await controlTx(
      sql,
      (tx) => tx<{ agent_paused_at: Date | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `,
    );
    const mail = await controlTx(
      sql,
      (tx) => tx<{ kind: string; payload: Record<string, unknown> }[]>`
      select m.kind, m.payload
      from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID} and a.subject_id = ${leadId}
    `,
    );
    expect(taskAfter?.done_at).not.toBeNull();
    expect(leadAfter?.agent_paused_at).toBeNull();
    expect(mail).toHaveLength(1);
    expect(mail[0]!.kind).toBe('staff.request');
    expect(String(mail[0]!.payload.focus)).toContain('1 mês grátis');

    // Both teammates' Handoff cards edited in sync & confirmation echoed the voice transcript
    const edits = calls.filter((c) => c.method === 'editMessageText');
    expect(new Set(edits.map((e) => e.body.chat_id))).toEqual(new Set([ANA_ID, BIA_ID]));
    const confirm = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === ANA_ID);
    expect(String(confirm?.body.text)).toContain('🎙');
    expect(String(confirm?.body.text)).toContain('orientação enviada para o agente');
  });

  test('tapping "responder ao lead" opens ForceReply and sends verbatim staff message keeping agent paused', async () => {
    const lead = await controlTx(appSql, (tx) =>
      insertLeadTx(tx, { name: 'Café Central', whatsapp: '+5511999992222' }),
    );
    const leadId = lead.body.lead.id;
    const taskId = await controlTx(sql, async (tx) => {
      const [tk] = await tx<{ id: string }[]>`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${leadId}, '[humano] pediu falar com humano', now(), 'agent')
        returning id
      `;
      await recordStaffEventTx(tx, 'handoff.requested', {
        taskId: tk!.id,
        leadId,
        leadName: 'Café Central',
        business: null,
        channel: 'whatsapp',
        threadId: null,
        reason: 'pediu falar com humano',
      });
      return tk!.id;
    });

    await deliverStaffEvents(appSql, { fetch: tgFetch });

    // Ana taps "✉️ responder ao lead" button → ForceReply prompt sent
    calls = [];
    await webhook({
      update_id: 1002,
      callback_query: {
        id: 'cb-handoff-direct',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 501, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `h:m:${taskId}`,
      },
    });
    const promptSend = calls.find((c) => c.method === 'sendMessage');
    expect((promptSend?.body.reply_markup as { force_reply?: boolean })?.force_reply).toBe(true);
    const [savedPrompt] = await controlTx(
      sql,
      (tx) =>
        tx<
          { message_id: string }[]
        >`select message_id from telegram_prompts where chat_id = ${ANA_ID}`,
    );
    expect(savedPrompt).toBeDefined();

    // Ana replies to the ForceReply prompt with her exact message
    calls = [];
    await webhook({
      update_id: 1003,
      message: {
        message_id: 802,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        reply_to_message: { message_id: Number(savedPrompt!.message_id) },
        text: 'Oi! Aqui é a Ana da Venduá, te ligo às 15h.',
      },
    });

    const msgs = await controlTx(
      sql,
      (tx) => tx<{ author: string; body: string }[]>`
      select m.author, m.body from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId}
    `,
    );
    const [leadAfter] = await controlTx(
      sql,
      (tx) => tx<{ agent_paused_at: Date | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `,
    );
    expect(msgs[0]?.author).toBe('staff');
    expect(msgs[0]?.body).toContain('Aqui é a Ana');
    expect(leadAfter?.agent_paused_at).not.toBeNull();
  });

  test('swipe-replying to a Draft card rejects the old draft, syncs all DMs, and queues staff.regenerate', async () => {
    const lead = await controlTx(appSql, (tx) => insertLeadTx(tx, { name: 'Bolo da Casa' }));
    const leadId = lead.body.lead.id;
    const msgId = await controlTx(sql, async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
      `;
      const [m] = await tx<{ id: string }[]>`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${t!.id}, 'out', 'agent', 'Texto muito longo inicial...', 'draft')
        returning id
      `;
      await recordStaffEventTx(tx, 'draft.pending', {
        messageId: m!.id,
        threadId: t!.id,
        leadId,
        leadName: 'Bolo da Casa',
        business: null,
        channel: 'whatsapp',
        subject: null,
        body: 'Texto muito longo inicial...',
      });
      return m!.id;
    });

    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const anaDraftCardId = Number(
      (
        await controlTx(
          sql,
          (tx) => tx<{ message_id: string }[]>`
            select message_id from staff_event_messages
            where chat_id = ${ANA_ID} and anchor = ${`draft:${msgId}`}
          `,
        )
      )[0]!.message_id,
    );

    calls = [];
    await webhook({
      update_id: 1004,
      message: {
        message_id: 803,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        reply_to_message: { message_id: anaDraftCardId },
        text: 'deixa mais curto e oferece 14 dias grátis',
      },
    });

    const [oldMsg] = await controlTx(
      sql,
      (tx) => tx<{ status: string }[]>`
      select status from lead_messages where id = ${msgId}
    `,
    );
    expect(oldMsg?.status).toBe('rejected');
    const mail = await controlTx(
      sql,
      (tx) => tx<{ kind: string; payload: Record<string, unknown> }[]>`
      select m.kind, m.payload
      from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID} and a.subject_id = ${leadId}
    `,
    );
    expect(mail[0]?.kind).toBe('staff.regenerate');
    expect(mail[0]?.payload.draftOnly).toBe(true);
    expect(String(mail[0]?.payload.focus)).toContain('14 dias grátis');
    expect(
      new Set(calls.filter((c) => c.method === 'editMessageText').map((e) => e.body.chat_id)),
    ).toEqual(new Set([ANA_ID, BIA_ID]));
  });

  test('/agente, /ensinar, /memoria, and /lead buttons control the sales agent directly without LLM calls', async () => {
    // /agente panel + toggle autonomy to copilot + toggle discovery job off + trigger strategist
    await webhook({
      update_id: 1010,
      message: {
        message_id: 810,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: '/agente',
      },
    });
    expect(String(calls[0]?.body.text)).toContain('agente de vendas da Venduá');

    await webhook({
      update_id: 1011,
      callback_query: {
        id: 'cb-al-copilot',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 510, chat: { id: Number(ANA_ID), type: 'private' } },
        data: 'al:copilot',
      },
    });
    await webhook({
      update_id: 1012,
      callback_query: {
        id: 'cb-aj-disc',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 510, chat: { id: Number(ANA_ID), type: 'private' } },
        data: 'aj:discovery',
      },
    });
    await webhook({
      update_id: 1013,
      callback_query: {
        id: 'cb-ag-strat',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 510, chat: { id: Number(ANA_ID), type: 'private' } },
        data: 'ag:s',
      },
    });
    const cfg = await controlTx(sql, agentSettingTx);
    expect(cfg.level).toBe('copilot');
    expect(cfg.jobs.discovery).toBe(false);
    const stratMail = await controlTx(
      sql,
      (tx) => tx<{ kind: string }[]>`
      select m.kind from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_STRATEGIST_ID}
    `,
    );
    expect(stratMail).toHaveLength(1);

    // /ensinar #docerias ... + /memoria + delete button
    calls = [];
    await webhook({
      update_id: 1014,
      message: {
        message_id: 814,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: '/ensinar #docerias destaque o cardápio de encomendas',
      },
    });
    const mem = await controlTx(
      sql,
      (tx) => tx<
        { id: string; scope: string; segment: string | null; pinned: boolean; content: string }[]
      >`
        select id, scope, segment, pinned, content from agent_memory_items
      `,
    );
    expect(mem).toHaveLength(1);
    expect(mem[0]!.scope).toBe('segment');
    expect(mem[0]!.segment).toBe('docerias');
    expect(mem[0]!.pinned).toBe(true);

    await webhook({
      update_id: 1015,
      callback_query: {
        id: 'cb-md-1',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 515, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `md:${mem[0]!.id}`,
      },
    });
    const memAfter = await controlTx(sql, (tx) => tx`select id from agent_memory_items`);
    expect(memAfter).toHaveLength(0);

    // Lead pause & draft mode buttons
    const lead = await controlTx(appSql, (tx) => insertLeadTx(tx, { name: 'Hamburgueria Sul' }));
    const leadId = lead.body.lead.id;
    await webhook({
      update_id: 1016,
      callback_query: {
        id: 'cb-lp-p',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 516, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `lp:p:${leadId}`,
      },
    });
    await webhook({
      update_id: 1017,
      callback_query: {
        id: 'cb-lm-d',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 516, chat: { id: Number(ANA_ID), type: 'private' } },
        data: `lm:d:${leadId}`,
      },
    });
    const [leadRow] = await controlTx(
      sql,
      (tx) => tx<{ agent_paused_at: Date | null; agent_mode: string }[]>`
      select agent_paused_at, agent_mode from leads where id = ${leadId}
    `,
    );
    expect(leadRow?.agent_paused_at).not.toBeNull();
    expect(leadRow?.agent_mode).toBe('draft');
  });

  test('website edits and a Telegram autonomy proposal share the live setting', async () => {
    const configPath = '/control/v1/agent/config';
    const headers = { 'x-vendua-control': 'ctl', 'content-type': 'application/json' };
    const edit = (patch: Record<string, unknown>) =>
      app.request(configPath, {
        method: 'PATCH',
        headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(patch),
      });
    const readConfig = async () =>
      (await app.request(configPath, { headers })).json() as Promise<AgentSetting>;

    expect((await edit({ level: 'autopilot' })).status).toBe(200);
    const original = await readConfig();
    expect(original).toMatchObject({ level: 'autopilot', jobs: { reply: true } });

    const chat = { id: Number(ANA_ID), type: 'private' };
    const from = { id: Number(ANA_ID), first_name: 'Ana' };
    await webhook({
      update_id: 1050,
      message: { message_id: 850, from, chat, text: 'muda a autonomia pra supervisionado' },
    });
    await pumpManager(
      managerRuntime([
        tools(call('propose_autonomy', { level: 'supervised', reply: false })),
        reply('Confirme no botão abaixo.'),
      ]),
    );
    const [proposal] = await sql<{ id: string }[]>`select id from telegram_proposals`;
    expect(proposal).toBeDefined();
    const confirm = (updateId: number) =>
      webhook({
        update_id: updateId,
        callback_query: {
          id: `autonomy-${updateId}`,
          from,
          message: { message_id: 851, chat },
          data: `p:y:${proposal!.id}`,
        },
      });

    const published: Promise<AgentSetting>[] = [];
    const unsubscribe = subscribeControlEvents((event) => {
      if (event.type === 'settings.change' && event.ref === 'agent') published.push(readConfig());
    });
    try {
      expect((await confirm(1051)).status).toBe(200);
      expect(await published[0]).toMatchObject({ level: 'supervised', jobs: { reply: false } });

      const responses = await Promise.all([
        edit({ voice: { replies: !original.voice.replies } }),
        edit({ voice: { proactive: !original.voice.proactive }, jobs: { discovery: false } }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(await readConfig()).toMatchObject({
        level: 'supervised',
        jobs: { reply: false, discovery: false },
        voice: { replies: false, proactive: false },
      });

      expect((await edit({ level: 'autopilot' })).status).toBe(200);
      expect(await published[3]).toMatchObject({ level: 'autopilot' });

      // The setting committed, but the confirmation status could still be pending after a crash.
      await sql`update telegram_proposals set status = 'proposed' where id = ${proposal!.id}`;
      expect((await confirm(1052)).status).toBe(200);
      expect(await readConfig()).toMatchObject({ level: 'autopilot' });
      expect(published).toHaveLength(4);

      calls = [];
      await webhook({ update_id: 1053, message: { message_id: 853, from, chat, text: '/agente' } });
      expect(String(calls.find((c) => c.method === 'sendMessage')?.body.text)).toContain(
        'autonomia: <b>piloto automático</b>',
      );
    } finally {
      unsubscribe();
    }
  });

  test('free-text & voice DM runs real crm-manager Runtime v3 turn: reads, teaches rule, sends 1-tap Confirm card, applies on tap, and /nova resets history', async () => {
    // Ana sends a free-text message in Telegram DM
    const w = await webhook({
      update_id: 1020,
      message: {
        message_id: 820,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: 'ensina o agente a nunca oferecer desconto sem perguntar e muda pra piloto automático',
      },
    });
    expect(w.status).toBe(200);
    expect(calls.some((c) => c.method === 'sendChatAction')).toBe(true);

    // Verify mailbox row created for crm-manager
    const inbox = await controlTx(
      sql,
      (tx) => tx<{ kind: string }[]>`
      select m.kind from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_MANAGER_AGENT_ID} and a.subject_id = ${ANA_ID}
    `,
    );
    expect(inbox).toHaveLength(1);

    // Step the REAL Agent Runtime v3 actor with a scripted gateway
    const rt = managerRuntime([
      tools(
        call('pipeline_overview'),
        call('teach_rule', { rule: 'Nunca ofereça desconto sem perguntar antes para a equipe.' }),
        call('propose_autonomy', { level: 'autopilot' }),
      ),
      reply(
        'Anotei a regra na memória do agente. Confirme no botão abaixo para mudar para **piloto automático**.',
      ),
    ]);
    await pumpManager(rt);

    // Rule was saved immediately (tier 1), autonomy has NOT changed yet (tier 2 proposal!)
    const rules = await controlTx(
      sql,
      (tx) =>
        tx<{ content: string; pinned: boolean }[]>`select content, pinned from agent_memory_items`,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]!.pinned).toBe(true);
    expect((await controlTx(sql, agentSettingTx)).level).toBe('supervised');

    // Outbox has BOTH the reply and the 1-tap proposal card
    calls = [];
    const delivered = await deliverStaffEvents(appSql, { fetch: tgFetch });
    expect(delivered.n).toBe(2);
    const sent = calls.filter((c) => c.method === 'sendMessage' && c.body.chat_id === ANA_ID);
    expect(sent).toHaveLength(2);
    expect(String(sent[0]!.body.text)).toContain('<b>piloto automático</b>');
    const propKeyboard = (
      sent[1]!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard;
    const confirmCb = propKeyboard[0]![0]!.callback_data;
    expect(confirmCb).toMatch(/^p:y:/);

    // Ana taps "✅ confirmar" → autonomy switches to autopilot & card edits in place
    calls = [];
    await webhook({
      update_id: 1021,
      callback_query: {
        id: 'cb-prop-yes',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 600, chat: { id: Number(ANA_ID), type: 'private' } },
        data: confirmCb,
      },
    });
    expect((await controlTx(sql, agentSettingTx)).level).toBe('autopilot');
    const propEdit = calls.find((c) => c.method === 'editMessageText');
    expect(String(propEdit?.body.text)).toContain('aplicado por Ana');

    // Re-tapping Confirm is idempotent and does not fail
    calls = [];
    await webhook({
      update_id: 1022,
      callback_query: {
        id: 'cb-prop-yes-2',
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        message: { message_id: 600, chat: { id: Number(ANA_ID), type: 'private' } },
        data: confirmCb,
      },
    });
    const replayToast = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(String(replayToast?.body.text)).toContain('já foi aplicada');

    // The next turn sees the tap (the history only has its own "confirme no botão") and a hunt
    // that hasn't finished: crm_turns only records finished runs
    await triggerBoardRun(appSql, {
      kind: 'discovery',
      query: 'doceiras em Araruama',
      by: 'Ana',
      idemKey: `hunt-${Date.now()}`,
    });
    await webhook({
      update_id: 1024,
      message: {
        message_id: 824,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: 'e aí, já mudou?',
      },
    });
    await pumpManager(managerRuntime([reply('Já está em piloto automático.')]));
    const seen = JSON.stringify(lastAdapter!.requests.at(-1));
    expect(seen).toContain('CARTÕES DE CONFIRMAÇÃO');
    expect(seen).toMatch(/mudar configuração do agente[^"]*JÁ CONFIRMADO por Ana/);
    expect(seen).toContain('Venduá Mirim (mirim): R$\u00a069,90/mês');
    expect(seen).toContain('descoberta: na fila');
    expect(seen).toContain('doceiras em Araruama');

    // /nova resets the crm-manager actor's conversation history cleanly
    calls = [];
    await webhook({
      update_id: 1023,
      message: {
        message_id: 823,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: '/nova',
      },
    });
    expect(String(calls[0]?.body.text)).toContain('nova conversa iniciada');
  });

  test('a voice note is answered with a voice note, then the text; typed messages get text only', async () => {
    const spoken: string[] = [];
    let speaking = true;
    const voiceMedia: MediaProviders = {
      ...fakeMedia,
      async speak(text, opts) {
        spoken.push(`${opts?.format}:${text}`);
        return speaking
          ? {
              bytes: new Uint8Array([79, 103, 103, 83]),
              mime: 'audio/ogg; codecs=opus',
              seconds: 2,
            }
          : null;
      },
    };
    const outbox = async () =>
      (
        await controlTx(
          sql,
          (tx) => tx<{ speak: string | null; state: string }[]>`
            select speak, state from telegram_dm_outbox where chat_id = ${ANA_ID} order by created_at`,
        )
      ).map((r) => ({ speak: r.speak, state: r.state }));
    const voiceNote = (update: number, message: number) =>
      webhook({
        update_id: update,
        message: {
          message_id: message,
          from: { id: Number(ANA_ID), first_name: 'Ana' },
          chat: { id: Number(ANA_ID), type: 'private' },
          voice: { file_id: `voice-${message}`, duration: 3, mime_type: 'audio/ogg', file_size: 4 },
        },
      });
    const sentMethods = () =>
      calls.map((c) => c.method).filter((m) => m === 'sendVoice' || m === 'sendMessage');

    // a voice note: the reply is spoken, the voice goes first and the text still follows
    nextTranscript = 'quantos leads entraram hoje?';
    expect((await voiceNote(1101, 901)).status).toBe(200);
    await pumpManager(managerRuntime([reply('Entraram **3 leads** hoje.')]));
    expect(await outbox()).toEqual([{ speak: 'Entraram **3 leads** hoje.', state: 'pending' }]);
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: voiceMedia });
    expect(sentMethods()).toEqual(['sendVoice', 'sendMessage']);
    expect(spoken).toEqual(['ogg:Entraram **3 leads** hoje.']);
    // sent once: a retried row can't say it again
    expect(await outbox()).toEqual([{ speak: null, state: 'sent' }]);

    // a typed message: text only
    await controlTx(sql, (tx) => tx`delete from telegram_dm_outbox`);
    await webhook({
      update_id: 1102,
      message: {
        message_id: 902,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: 'e ontem?',
      },
    });
    await pumpManager(managerRuntime([reply('Ontem foram 2.')]));
    expect(await outbox()).toEqual([{ speak: null, state: 'pending' }]);
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: voiceMedia });
    expect(sentMethods()).toEqual(['sendMessage']);

    // no voice now (the TTS sidecar is down): the text goes, nothing is held back
    await controlTx(sql, (tx) => tx`delete from telegram_dm_outbox`);
    speaking = false;
    await voiceNote(1103, 903);
    await pumpManager(managerRuntime([reply('Tudo certo por aqui.')]));
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: voiceMedia });
    expect(sentMethods()).toEqual(['sendMessage']);
    expect(await outbox()).toEqual([{ speak: null, state: 'sent' }]);
  });

  test('store tx cannot read telegram_dm_outbox, telegram_prompts, or telegram_proposals (RLS)', async () => {
    const [tenant] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, status)
      values (${`tg-mgr-rls-${Date.now()}`}, 'RLS Store', 'active')
      returning id
    `;
    try {
      await controlTx(sql, async (tx) => {
        await tx`
          insert into telegram_dm_outbox (chat_id, text) values (${ANA_ID}, 'segredo interno')
        `;
        await tx`
          insert into telegram_prompts (chat_id, message_id, kind, expires_at)
          values (${ANA_ID}, '999', 'teach_rule', now() + interval '10 minutes')
        `;
        await tx`
          insert into telegram_proposals (chat_id, staff_name, kind, title, expires_at)
          values (${ANA_ID}, 'Ana', 'set_autonomy', 'teste', now() + interval '10 minutes')
        `;
      });
      await withTenant(appSql, tenant!.id, async (tx) => {
        expect(await tx`select id from telegram_dm_outbox`).toHaveLength(0);
        expect(await tx`select message_id from telegram_prompts`).toHaveLength(0);
        expect(await tx`select id from telegram_proposals`).toHaveLength(0);
      });
    } finally {
      await sql`delete from tenants where id = ${tenant!.id}`;
    }
  });

  test('get_lead_details reads lead_activities.at with null body, and crm-manager failures surface real errors without store link or vv_', async () => {
    const lead = await controlTx(appSql, (tx) =>
      insertLeadTx(tx, { name: 'Vinicius', business_name: 'Picolé Do Vini' }),
    );
    const leadId = lead.body.lead.id;
    await controlTx(
      sql,
      (tx) => tx`
      insert into lead_activities (lead_id, kind, body, created_by)
      values (${leadId}, 'state_change', null, 'system')
    `,
    );

    // 1) crm-manager calls get_lead_details on a lead with null-body activity and replies cleanly
    await webhook({
      update_id: 1030,
      message: {
        message_id: 830,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: 'Esse lead foi um sucesso então, né?',
      },
    });
    const okRt = managerRuntime([
      tools(call('get_lead_details', { leadId })),
      tools(call('reply', { text: 'Sim! **Picolé Do Vini** já avançou no funil.' })),
    ]);
    await new Promise((r) => setTimeout(r, 260));
    await okRt.pump('interactive', { limit: 10, perTenantCap: 10 });
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const replyMsg = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === ANA_ID);
    expect(String(replyMsg?.body.text)).toContain('<b>Picolé Do Vini</b>');

    // 2) Forced gateway failure surfaces real error, omits Venduá/[loja no CRM], and avoids vv_
    await webhook({
      update_id: 1031,
      message: {
        message_id: 831,
        from: { id: Number(ANA_ID), first_name: 'Ana' },
        chat: { id: Number(ANA_ID), type: 'private' },
        text: 'testando falha',
      },
    });
    const brokenRt = managerRuntime([
      { error: { status: 400, message: 'Unexpected role user after tool' } },
      { error: { status: 400, message: 'Unexpected role user after tool' } },
      { error: { status: 400, message: 'Unexpected role user after tool' } },
    ]);
    await new Promise((r) => setTimeout(r, 260));
    for (let i = 0; i < 4; i++) {
      await controlTx(
        sql,
        (tx) => tx`
        update agent_actors set next_wake_at = now()
        where agent_id = ${CRM_MANAGER_AGENT_ID} and owner is null
      `,
      );
      await brokenRt.pump('interactive', { limit: 10, perTenantCap: 10 });
    }
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const failCard = calls.find(
      (c) =>
        c.method === 'sendMessage' &&
        c.body.chat_id === ANA_ID &&
        String(c.body.text).includes('turno do agente falhou'),
    );
    expect(failCard).toBeDefined();
    expect(String(failCard?.body.text)).toContain('Unexpected role user after tool');
    expect(String(failCard?.body.text)).not.toContain('vv_');
    expect(String(failCard?.body.text)).not.toContain('Venduá');
    expect(failCard?.body.reply_markup).toBeUndefined();

    // 3) Cards whose title already starts with an emoji never duplicate the category emoji
    await controlTx(sql, async (tx) => {
      await recordStaffEventTx(tx, 'store.live', {
        storeName: 'Picolé Do Vini',
        host: 'picole-do-vini.vendua.com.br',
      });
      await recordStaffEventTx(tx, 'lead.milestone', {
        leadId,
        leadName: 'vinicius',
        business: null,
        from: 'invited',
        to: 'live',
        by: 'system',
      });
    });
    calls = [];
    await deliverStaffEvents(appSql, { fetch: tgFetch });
    const texts = calls
      .filter((c) => c.method === 'sendMessage' && c.body.chat_id === ANA_ID)
      .map((c) => String(c.body.text));
    expect(texts.some((t) => t.startsWith('🚀 <b>Picolé Do Vini'))).toBe(true);
    expect(texts.some((t) => t.includes('🚀 🚀'))).toBe(false);
    expect(texts.some((t) => t.startsWith('🎯 <b>vinicius'))).toBe(true);
    expect(texts.some((t) => t.includes('💬 🎯'))).toBe(false);
  });
});
