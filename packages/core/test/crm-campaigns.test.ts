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
import { crmAgent } from '../src/agent-host/agents/crm/index.ts';
import { crmDiscovery } from '../src/agent-host/agents/crm/discovery.ts';
import { crmLogTransport } from '../src/agent-host/agents/crm/shared.ts';
import { crmStrategist } from '../src/agent-host/agents/crm/strategist.ts';
import { crmCampaign } from '../src/agent-host/agents/crm-campaign/index.ts';
import {
  crmManager,
  telegramManagerTransport,
} from '../src/agent-host/agents/crm-manager/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { bumpCampaignBudget, campaignMetricsTx, startCampaign } from '../src/crm/campaigns.ts';
import {
  CAMPAIGN_SUBJECT,
  CRM_AGENT_ID,
  CRM_CAMPAIGN_ID,
  requestCampaignTx,
} from '../src/crm/dispatch.ts';
import {
  checkSendAllowedTx,
  whatsappColdBudgetTx,
  whatsappColdCapTx,
} from '../src/crm/guardrails.ts';
import { ingestInbound } from '../src/crm/inbound.ts';
import { configureCrmSignup, crmSignupToken, linkCrmSignupTx } from '../src/crm/signup.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  upsertIntegration,
  validateSetting,
} from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { bookMeeting } from '../src/modules/meetings.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import { deliverStaffEvents, resetDeliveryClock } from '../src/modules/telegram/deliver.ts';
import { resetRateLimits, type TelegramFetch } from '../src/modules/telegram/rest.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';

// Autonomous Campaign Mode (`crm-campaign` actor + Telegram `crm-manager` + hard guardrails):
// - WhatsApp rolling-24h cold-outreach cap (`whatsappColdPerDay`)
// - Natural Telegram DM → 1-tap Confirm card → Campaign Director → Discovery Hunt → Lead Enroll → Signup Win!
// - Existing CRM lead activation & tactical coaching
// - Hard stop/pause guardrails (budget, expiry, signup closed, autonomy off, concurrent/daily/dup hunt caps, heartbeat safety net)
// - Telegram `/campanha`, inline buttons, ForceReply & swipe-reply steering
// - Reply-goal (auto-reply robot ignored, human reply wins) & meeting-goal conversions
// - Staff REST API (`/control/v1/agent/campaigns*`) & tenant RLS isolation

const BOT_ID = '777000333';
const BOT_USER = 'vendua_camp_bot';
const FOUNDER_ID = '555555555';
const WEBHOOK_SECRET = '0123456789abcdef0123456789abcdef';
const SIGNUP_SECRET = 'campaign-signup-test-secret';

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));
const say = (text: string): ScriptedOutput => ({ text });

describe('guardrails — whatsappColdPerDay validation', () => {
  test('defaults to 25 and validates integer range [0, 200]', () => {
    expect(DEFAULT_GUARDRAILS.whatsappColdPerDay).toBe(25);
    expect(() => validateSetting('guardrails', { whatsappColdPerDay: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { whatsappColdPerDay: 200 })).not.toThrow();
    expect(() => validateSetting('guardrails', { whatsappColdPerDay: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { whatsappColdPerDay: 201 })).toThrow();
    expect(() => validateSetting('guardrails', { whatsappColdPerDay: 12.5 })).toThrow();
  });
});

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('crm autonomous campaign mode (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  ) as unknown as Sql;

  let calls: RecordedCall[] = [];
  let nextMsgId = 900;
  let updateSeq = Math.floor(Date.now() / 100) % 1_000_000_000;
  let idemSeq = 0;
  const nonce = crypto.randomUUID().slice(0, 8);
  const key = () => `camp-${nonce}-${++idemSeq}`;
  const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  const tgFetch: TelegramFetch = async (_url, init) => {
    const method = _url.split('/').pop() ?? '';
    const body =
      typeof init.body === 'string' && init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    calls.push({ method, body });
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

  const postWebhook = (update: Record<string, unknown>) =>
    app.request('/control/v1/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    });

  const ctlReq = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        'x-vendua-control': 'ctl',
        ...(init.headers ?? {}),
      },
    });

  let prevDiscovery: { driver: string; enabled: boolean }[] = [];

  async function setWorkspace(
    opts: {
      level?: 'off' | 'copilot' | 'supervised' | 'autopilot';
      signupOpen?: boolean;
      whatsappColdPerDay?: number;
      quietHoursEnabled?: boolean;
    } = {},
  ) {
    await sql`
      insert into control_settings (key, value)
      values ('agent', ${sql.json({
        level: opts.level ?? 'autopilot',
        jobs: { reply: true, outreach: true, discovery: true, strategist: true },
      } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({
        ...DEFAULT_GUARDRAILS,
        quietHoursEnabled: opts.quietHoursEnabled ?? false,
        humanReplyPacing: false,
        whatsappColdPerDay: opts.whatsappColdPerDay ?? 25,
      } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    await sql`
      insert into control_settings (key, value)
      values ('signup', ${sql.json({ enabled: opts.signupOpen !== false } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    configureCrmSignup({
      origin: 'https://app.vendua.test',
      secret: SIGNUP_SECRET,
      provider: { platformConfigured: opts.signupOpen !== false },
    });
  }

  function makeRuntime(
    script: ScriptedOutput[] | ((req: unknown, i: number) => ScriptedOutput),
    opts: { costUsd?: number } = {},
  ) {
    const adapter = scriptedAdapter(
      typeof script === 'function'
        ? (req, i) => {
            const out = script(req, i);
            return opts.costUsd
              ? { ...out, usage: { inputTokens: 100, outputTokens: 50, costUsd: opts.costUsd } }
              : out;
          }
        : script.map((out) =>
            opts.costUsd
              ? { ...out, usage: { inputTokens: 100, outputTokens: 50, costUsd: opts.costUsd } }
              : out,
          ),
    );
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    const rt = new Runtime<Sql>({
      agents: [crmAgent, crmDiscovery, crmStrategist, crmCampaign, crmManager],
      store: new PgActorStore(appSql),
      gateway,
      transports: [crmLogTransport, telegramManagerTransport],
      owner: `camp-w-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
    return { rt, adapter };
  }

  /** Pumps only the listed subject IDs so separate scripted runtimes run each actor cleanly. */
  async function pumpOnly(
    rt: Runtime<Sql>,
    subjects: string[],
    lanes: ('interactive' | 'followup' | 'background')[] = [
      'interactive',
      'followup',
      'background',
    ],
    maxRounds = 12,
  ) {
    for (let i = 0; i < maxRounds; i++) {
      // Restore next_wake_at for target subjects that have pending mail (in case an earlier
      // runtime's isolation pass cleared them before this runtime was ready for them).
      await sql`
        update agent_actors a
        set next_wake_at = (
          select min(m.deliver_at) from agent_mailbox m
          where m.actor_id = a.id and m.consumed_by_turn is null
        )
        where a.tenant_id = ${PLATFORM_TENANT_ID}
          and a.subject_id = any(${subjects})
          and a.next_wake_at is null
          and exists (
            select 1 from agent_mailbox m
            where m.actor_id = a.id and m.consumed_by_turn is null
          )
      `;
      await sql`
        update agent_actors set next_wake_at = null
        where tenant_id = ${PLATFORM_TENANT_ID}
          and not (subject_id = any(${subjects}))
      `;
      let n = 0;
      for (const lane of lanes) {
        n += await rt.pump(lane, { limit: 10, perTenantCap: 10 });
      }
      if (n === 0) break;
    }
  }

  async function cleanCampaignTables() {
    await sql`delete from crm_campaigns`;
    await sql`delete from telegram_proposals`;
    await sql`delete from telegram_prompts`;
    await sql`delete from telegram_dm_outbox`;
    await sql`delete from staff_event_messages`;
    await sql`delete from staff_events`;
    await sql`
      delete from lead_messages
      where thread_id in (
        select t.id from lead_threads t
        join leads l on l.id = t.lead_id
        where l.name like ${'%' + nonce + '%'} or l.name in ('Cold 1', 'Cold 2', 'Callback Lead')
      )
    `;
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.tenant_id = ${PLATFORM_TENANT_ID}
        and a.agent_id in ('crm-campaign', 'crm-manager', 'crm-discovery', 'crm')
        and m.consumed_by_turn is null
    `;
  }

  beforeAll(async () => {
    await migrate(sql as unknown as Sql, join(import.meta.dir, '../db/migrations'));
    process.env.TEST_TG_BOT_TOKEN_CAMP = `${BOT_ID}:campaign-test-token`;
    await upsertIntegration(
      sql as unknown as Sql,
      {
        kind: 'telegram',
        driver: 'bot',
        enabled: true,
        secretRef: 'TEST_TG_BOT_TOKEN_CAMP',
        config: { botId: BOT_ID, username: BOT_USER, webhookSecret: WEBHOOK_SECRET },
      },
      key(),
    );
    await upsertIntegration(
      sql as unknown as Sql,
      { kind: 'whatsapp', driver: 'log', enabled: true },
      key(),
    );
    await upsertIntegration(
      sql as unknown as Sql,
      { kind: 'email', driver: 'log', enabled: true },
      key(),
    );
    prevDiscovery = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'
    `;
    await upsertIntegration(
      sql as unknown as Sql,
      { kind: 'discovery', driver: 'mock', enabled: true },
      key(),
    );
    await sql`
      insert into control_settings (key, value)
      values ('staff', ${sql.json({
        members: [
          { name: 'Maria', email: 'maria@vendua.com.br', whatsapp: '', telegram: FOUNDER_ID },
        ],
      } as never)})
      on conflict (key) do update set value = excluded.value
    `;
  });

  beforeEach(async () => {
    calls = [];
    resetRateLimits();
    resetDeliveryClock();
    await cleanCampaignTables();
    await setWorkspace();
  });

  afterAll(async () => {
    configureCrmSignup(null);
    await cleanCampaignTables();
    await sql`delete from control_settings where key in ('agent', 'guardrails', 'signup')`;
    await sql`delete from control_integrations where kind = 'discovery'`;
    for (const d of prevDiscovery) {
      await upsertIntegration(
        sql as unknown as Sql,
        { kind: 'discovery', driver: d.driver, enabled: d.enabled },
        key(),
      );
    }
    delete process.env.TEST_TG_BOT_TOKEN_CAMP;
    await sql.end();
    await (appSql as unknown as { end: () => Promise<void> }).end();
  });

  test('whatsappColdPerDay caps new cold opens, leaves replies and callbacks uncapped', async () => {
    const l1 = (
      await controlTx(appSql, (tx) =>
        insertLeadTx(tx, {
          name: 'Cold 1',
          agent_mode: 'auto',
          whatsapp: phone(),
          whatsapp_verified: true,
        }),
      )
    ).body.lead;
    const l2 = (
      await controlTx(appSql, (tx) =>
        insertLeadTx(tx, {
          name: 'Cold 2',
          agent_mode: 'auto',
          whatsapp: phone(),
          whatsapp_verified: true,
        }),
      )
    ).body.lead;
    const l3 = (
      await controlTx(appSql, (tx) =>
        insertLeadTx(tx, {
          name: 'Callback Lead',
          agent_mode: 'auto',
          whatsapp: phone(),
          whatsapp_verified: true,
        }),
      )
    ).body.lead;

    const baseUsed = await controlTx(appSql, async (tx) => {
      const b = await whatsappColdBudgetTx(tx, { ...DEFAULT_GUARDRAILS, whatsappColdPerDay: 200 });
      return b.used;
    });
    const cap = baseUsed + 1;
    const g = { ...DEFAULT_GUARDRAILS, quietHoursEnabled: false, whatsappColdPerDay: cap };

    // First cold open allowed
    const before = await controlTx(appSql, (tx) => checkSendAllowedTx(tx, g, l1.id, 'whatsapp'));
    expect(before.ok).toBe(true);

    // Record agent cold send on l1
    await controlTx(appSql, (tx) =>
      composeMessageTx(tx, {
        leadId: l1.id,
        channel: 'whatsapp',
        body: 'Oi, tudo bem?',
        author: 'agent',
        status: 'queued',
      }),
    );

    // Budget is now full → second cold lead blocked
    const capReason = await controlTx(appSql, (tx) => whatsappColdCapTx(tx, g, l2.id));
    expect(capReason).toBe('whatsapp cold-outreach daily cap reached');
    const blocked = await controlTx(appSql, (tx) => checkSendAllowedTx(tx, g, l2.id, 'whatsapp'));
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('whatsapp cold-outreach daily cap reached');

    // Follow-up on already-opened thread l1 is NOT blocked by cold cap
    const followupCap = await controlTx(appSql, (tx) => whatsappColdCapTx(tx, g, l1.id));
    expect(followupCap).toBeNull();

    // Lead with site_callback is NOT blocked by cold cap
    await controlTx(
      appSql,
      (tx) => tx`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${l3.id}, 'note', 'pediu retorno', ${tx.json({ type: 'site_callback' } as never)}, 'system')
    `,
    );
    const cbCap = await controlTx(appSql, (tx) => whatsappColdCapTx(tx, g, l3.id));
    expect(cbCap).toBeNull();

    // whatsappColdPerDay = 0 disables the cap
    const uncapped = await controlTx(appSql, (tx) =>
      whatsappColdCapTx(tx, { ...g, whatsappColdPerDay: 0 }, l2.id),
    );
    expect(uncapped).toBeNull();
  });

  test('a campaign card without an autonomy change preserves later website changes', async () => {
    const chat = { id: Number(FOUNDER_ID), type: 'private' };
    const from = { id: Number(FOUNDER_ID), first_name: 'Maria' };
    const messageId = ++updateSeq;
    await postWebhook({
      update_id: messageId,
      message: { message_id: messageId, from, chat, text: 'inicia uma campanha de cadastros' },
    });
    const { rt } = makeRuntime([
      tools(
        call('propose_start_campaign', {
          title: 'Campanha de cadastros',
          objective: 'Chegar a um cadastro com leads novos.',
          enableAutopilot: true,
        }),
      ),
      reply('Confirme para iniciar a campanha.'),
    ]);
    await pumpOnly(rt, [FOUNDER_ID], ['interactive']);
    const [proposal] = await sql<
      { id: string; lines: string[]; payload: Record<string, unknown> }[]
    >`
      select id, lines, payload from telegram_proposals where chat_id = ${FOUNDER_ID} and kind = 'start_campaign'
    `;
    expect(proposal!.lines.join(' ')).not.toContain('liga piloto automático');
    expect(proposal!.payload.enableAutopilot).toBeUndefined();
    // Older Core could persist the flag without displaying it on the card.
    await sql`
      update telegram_proposals set payload = payload || '{"enableAutopilot":true}'
      where id = ${proposal!.id}
    `;

    const path = '/control/v1/agent/config';
    const edited = await ctlReq(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': key() },
      body: JSON.stringify({ level: 'supervised' }),
    });
    expect(edited.status).toBe(200);
    await postWebhook({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-${key()}`,
        from,
        message: { message_id: messageId + 1, chat },
        data: `p:y:${proposal!.id}`,
      },
    });
    expect(await (await ctlReq(path)).json()).toMatchObject({ level: 'supervised' });
    const campaigns = await sql<{ status: string }[]>`select status from crm_campaigns`;
    expect(campaigns.map((c) => c.status)).toEqual(['active']);
  });

  test('full end-to-end: Telegram DM → 1-tap Confirm → Campaign Director → Hunt → Lead Enroll → Signup Win!', async () => {
    await setWorkspace({ level: 'supervised' });
    // 1. Founder messages Telegram CRM agent
    const msgId = Math.floor(Date.now() / 1000) + ++updateSeq;
    const msgRes = await postWebhook({
      update_id: msgId,
      message: {
        message_id: msgId,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        chat: { id: Number(FOUNDER_ID), type: 'private' },
        text: 'Hey buddy, keep working until you find a single lead that signs up',
      },
    });
    expect(msgRes.status).toBe(200);

    // 2. crm-manager runs and calls propose_start_campaign
    const mgrRt = makeRuntime([
      tools(
        call('propose_start_campaign', {
          title: 'Conseguir 1 cadastro',
          objective:
            'Continuar prospectando, abordando e acompanhando até conseguir 1 lead cadastrado.',
          goalKind: 'signup',
          goalTarget: 1,
          budgetUsd: 20,
          maxDays: 7,
          focusSegment: 'docerias',
          focusCity: 'Campinas',
          enableAutopilot: true,
        }),
      ),
      reply(
        'Preparei o modo campanha para conseguir 1 cadastro (teto US$ 20 / 7 dias). Confirme no botão abaixo para começar!',
      ),
    ]);
    await pumpOnly(mgrRt.rt, [FOUNDER_ID], ['interactive']);
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: null });

    // Confirm Telegram received both the text reply AND the 1-tap confirmation card
    const proposalMsg = calls.find(
      (c) =>
        c.method === 'sendMessage' && String(c.body.text ?? '').includes('iniciar modo campanha'),
    );
    expect(proposalMsg).toBeDefined();
    expect(String(proposalMsg!.body.text)).toContain('também liga piloto automático');
    const confirmBtn = (
      proposalMsg!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard[0]![0]!;
    expect(confirmBtn.callback_data).toMatch(/^p:y:/);

    // 3. Founder taps "✅ confirmar"
    calls = [];
    const tapRes = await postWebhook({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-${key()}`,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        message: {
          message_id: nextMsgId,
          chat: { id: Number(FOUNDER_ID), type: 'private' },
        },
        data: confirmBtn.callback_data,
      },
    });
    expect(tapRes.status).toBe(200);
    expect(await (await ctlReq('/control/v1/agent/config')).json()).toMatchObject({
      level: 'autopilot',
    });

    const [campaign] = await sql<
      { id: string; status: string; title: string; goal_kind: string }[]
    >`
      select id, status, title, goal_kind from crm_campaigns order by created_at desc limit 1
    `;
    expect(campaign).toBeDefined();
    expect(campaign!.status).toBe('active');
    expect(campaign!.goal_kind).toBe('signup');

    // Deliver the campaign.started living card to Telegram
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: null });
    const startedCard = calls.find(
      (c) => c.method === 'sendMessage' && String(c.body.text ?? '').includes('modo campanha'),
    );
    expect(startedCard).toBeDefined();

    // 4. Campaign Director Turn 1: updates playbook, launches hunt, verifies concurrent hunt blocked
    const campRt1 = makeRuntime([
      tools(
        call('update_playbook', {
          playbook: 'Hipótese 1: docerias artesanais em Campinas buscando sair da taxa do iFood.',
        }),
        call('launch_hunt', {
          query: 'docerias artesanais Campinas',
          segment: 'docerias',
          city: 'Campinas',
          target: 5,
          angle: 'cardápio próprio sem taxa por pedido',
          reason: 'WIP zerado — primeira leva no foco pedido',
        }),
        // Attempting a second concurrent hunt in the same turn must be blocked cleanly!
        call('launch_hunt', {
          query: 'confeitarias Sorocaba',
          city: 'Sorocaba',
          reason: 'teste de concorrência',
        }),
      ),
      say('Primeira busca lançada; aguardando conclusão da descoberta.'),
    ]);
    await pumpOnly(campRt1.rt, [campaign!.id], ['background']);

    const hunts = await sql<
      { id: string; hunt_subject_id: string; status: string; query: string }[]
    >`
      select id, hunt_subject_id, status, query from crm_campaign_hunts where campaign_id = ${campaign!.id}
    `;
    expect(hunts).toHaveLength(1);
    expect(hunts[0]!.status).toBe('queued');
    const huntSubjectId = hunts[0]!.hunt_subject_id;

    // 5. Discovery actor runs the hunt and creates a qualified lead!
    const leadPhone = phone();
    const leadName = `Doceria Pudim Real ${nonce}`;
    const discRt = makeRuntime(
      [
        tools(
          call('plan', { content: 'Buscar docerias em Campinas com WhatsApp ativo' }),
          call('create_lead', {
            name: leadName,
            businessName: `Pudim Real ${nonce}`,
            city: 'Campinas',
            segment: 'docerias',
            whatsapp: leadPhone,
            fitScore: 9,
            fitReason: 'vende encomendas no WhatsApp e reclama de taxa',
            findings:
              'Doceria artesanal em Campinas vendendo pudins e bolos sob encomenda pelo WhatsApp, ativa hoje.',
          }),
        ),
        say('1 lead qualificado criado.'),
      ],
      { costUsd: 0.45 },
    );
    await pumpOnly(discRt.rt, [huntSubjectId], ['background']);

    // Verify hunt marked done, lead enrolled in campaign, spend synced, AND director woken with campaign.hunt_done!
    const [huntAfter] = await sql<{ status: string; leads_created: number; cost_cents: number }[]>`
      select status, leads_created, cost_cents from crm_campaign_hunts where id = ${hunts[0]!.id}
    `;
    expect(huntAfter!.status).toBe('done');
    expect(huntAfter!.leads_created).toBe(1);
    expect(huntAfter!.cost_cents).toBe(90);

    const enrolled = await sql<{ lead_id: string; origin: string }[]>`
      select lead_id, origin from crm_campaign_leads where campaign_id = ${campaign!.id}
    `;
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0]!.origin).toBe('discovered');
    const createdLeadId = enrolled[0]!.lead_id;

    // 6. Campaign Director Turn 2 (woken by campaign.hunt_done): sees active WIP, reports progress & schedules wait
    const campRt2 = makeRuntime([
      tools(
        call('list_campaign_leads', { bucket: 'uncontacted' }),
        call('report_progress', {
          message: `Primeira leva em Campinas encontrou ${leadName} — aguardando respostas antes de caçar mais.`,
        }),
        call('schedule_next_check', {
          waitMinutes: 180,
          reason: 'aguardando respostas da primeira leva',
        }),
      ),
      say('WIP ativo registrado, próxima checagem em 3h.'),
    ]);
    await pumpOnly(campRt2.rt, [campaign!.id], ['background']);

    const [campMid] = await sql<{ spent_cents: number; next_tick_at: Date | null }[]>`
      select spent_cents, next_tick_at from crm_campaigns where id = ${campaign!.id}
    `;
    expect(campMid!.spent_cents).toBeGreaterThanOrEqual(45);
    expect(campMid!.next_tick_at).not.toBeNull();

    // 7. THE WIN: Lead signs up via linkCrmSignupTx!
    const [tenant] = await sql<{ id: string }[]>`
      insert into tenants (name, slug)
      values ('Pudim Real', ${`pudim-real-${nonce}`})
      returning id
    `;
    calls = [];
    const linked = await linkCrmSignupTx(
      appSql,
      tenant!.id,
      leadPhone,
      crmSignupToken(createdLeadId, SIGNUP_SECRET),
      SIGNUP_SECRET,
    );
    expect(linked).toBe(createdLeadId);

    // Campaign MUST immediately be won with pending ticks cleared!
    const [wonCamp] = await sql<
      {
        status: string;
        goal_progress: number;
        won_at: Date | null;
        next_tick_at: Date | null;
      }[]
    >`
      select status, goal_progress, won_at, next_tick_at from crm_campaigns where id = ${campaign!.id}
    `;
    expect(wonCamp!.status).toBe('won');
    expect(wonCamp!.goal_progress).toBe(1);
    expect(wonCamp!.won_at).not.toBeNull();
    expect(wonCamp!.next_tick_at).toBeNull();

    // Deliver the celebratory win update to Telegram (living card edit + win reply!)
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: null });
    const winReply = calls.find(
      (c) => c.method === 'sendMessage' && String(c.body.text ?? '').includes('Meta batida!'),
    );
    expect(winReply).toBeDefined();
    expect(String(winReply!.body.text)).toContain(leadName);

    // Any extra wakeup to a won campaign parks with ZERO model calls!
    await controlTx(appSql, (tx) =>
      requestCampaignTx(tx, {
        campaignId: campaign!.id,
        kind: 'timer.campaign_tick',
        source: 'test',
        dedupeKey: `post-win-tick:${key()}`,
      }),
    );
    const noopRt = makeRuntime([say('should never run')]);
    await pumpOnly(noopRt.rt, [campaign!.id], ['background']);
    expect(noopRt.adapter.requests).toHaveLength(0);
  });

  test('activate_existing_leads enrolls untouched CRM leads and coach_lead wakes crm-agent', async () => {
    const existing = (
      await controlTx(appSql, (tx) =>
        insertLeadTx(tx, {
          name: 'Confeitaria Doce Lar',
          city: 'Curitiba',
          segment: 'confeitarias',
          agent_mode: 'auto',
          whatsapp: phone(),
          whatsapp_verified: true,
          fit_score: 9,
        }),
      )
    ).body.lead;

    const { campaign } = await startCampaign(appSql, {
      title: 'Ativar base + buscar novos',
      objective: 'Conseguir 1 cadastro ativando leads existentes primeiro.',
      goalKind: 'signup',
      goalTarget: 1,
      budgetUsd: 15,
      by: 'Maria',
      idemKey: key(),
    });

    // Director inspects untouched_pool, activates existing lead, then coaches it and schedules wait
    const rt = makeRuntime([
      tools(call('list_campaign_leads', { bucket: 'untouched_pool' })),
      tools(
        call('activate_existing_leads', {
          count: 3,
          angle: 'começar sem comissão por pedido',
          reason: 'há leads qualificados intocados no CRM',
        }),
      ),
      tools(
        call('coach_lead', {
          lead: 'l1',
          guidance: 'Pergunte se eles ainda anotam encomendas no WhatsApp.',
        }),
        call('schedule_next_check', {
          waitMinutes: 240,
          reason: 'aguardando respostas da base ativada',
        }),
      ),
      say('Base ativada e orientada.'),
    ]);
    await pumpOnly(rt.rt, [campaign.id], ['background']);

    const enrolled = await sql<{ lead_id: string; origin: string }[]>`
      select lead_id, origin from crm_campaign_leads where campaign_id = ${campaign.id}
    `;
    expect(enrolled.some((e) => e.lead_id === existing.id && e.origin === 'revived')).toBe(true);

    // Lead mailbox should have received campaign-sourced first contact
    const mail = await sql<{ kind: string; source: string }[]>`
      select m.kind, m.source
      from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
        and a.subject_id = ${existing.id}
    `;
    expect(mail.some((m) => m.source === `campaign:${campaign.id}`)).toBe(true);
  });

  test('hard guardrails: signup closed, autonomy off, budget exhausted, daily hunt cap, dup query, and heartbeat safety net', async () => {
    // 1. Signup closed → auto-pauses with ZERO model calls
    await setWorkspace({ signupOpen: false });
    const cClosed = (
      await startCampaign(appSql, {
        title: 'Signup fechado',
        objective: '1 cadastro',
        goalKind: 'signup',
        by: 'Maria',
        idemKey: key(),
      })
    ).campaign;
    const rtClosed = makeRuntime([say('should not run')]);
    await pumpOnly(rtClosed.rt, [cClosed.id], ['background']);
    expect(rtClosed.adapter.requests).toHaveLength(0);
    const [closedRow] = await sql<{ status: string; stop_reason: string | null }[]>`
      select status, stop_reason from crm_campaigns where id = ${cClosed.id}
    `;
    expect(closedRow!.status).toBe('paused');
    expect(closedRow!.stop_reason).toContain('cadastro online');

    // 2. Budget cap + daily hunt cap + duplicate query + heartbeat safety net
    await setWorkspace({ signupOpen: true, level: 'autopilot' });
    const cCap = (
      await startCampaign(appSql, {
        title: 'Teste limites',
        objective: 'Testar limites duros',
        goalKind: 'signup',
        budgetUsd: 2, // 200 cents
        maxHuntsPerDay: 1,
        by: 'Maria',
        idemKey: key(),
      })
    ).campaign;

    // Director finishes WITHOUT calling launch_hunt/schedule_next_check/pause_campaign
    // → campaignSettled nudges once, then even if model still stops, heartbeat safety net schedules tick!
    const rtNudge = makeRuntime([say('nada por enquanto'), say('ok, encerrando')]);
    await pumpOnly(rtNudge.rt, [cCap.id], ['background']);
    expect(rtNudge.adapter.requests).toHaveLength(2); // nudged once by campaignSettled!
    const [afterNudge] = await sql<{ next_tick_at: Date | null }[]>`
      select next_tick_at from crm_campaigns where id = ${cCap.id}
    `;
    expect(afterNudge!.next_tick_at).not.toBeNull(); // heartbeat safety net saved it!

    // Launch 1 hunt, finish it, then verify daily cap (1/day) blocks hunt #2 AND budget cap exhausts campaign!
    const rtHunt = makeRuntime(
      [
        tools(
          call('launch_hunt', {
            query: 'padarias Bh',
            city: 'Belo Horizonte',
            reason: 'primeira busca',
          }),
        ),
        say('busca lançada'),
      ],
      { costUsd: 0.5 },
    );
    await controlTx(appSql, (tx) =>
      requestCampaignTx(tx, {
        campaignId: cCap.id,
        kind: 'staff.request',
        source: 'staff:Maria',
        dedupeKey: `force-hunt:${key()}`,
        payload: { guidance: 'lance a primeira busca agora' },
      }),
    );
    await pumpOnly(rtHunt.rt, [cCap.id], ['background']);

    const [hunt1] = await sql<{ hunt_subject_id: string }[]>`
      select hunt_subject_id from crm_campaign_hunts where campaign_id = ${cCap.id}
    `;
    // Finish hunt1 with $2.00 cost → pushes campaign spent >= $2.00 budget → auto-exhausted!
    const rtDiscExpensive = makeRuntime([say('sem leads')], { costUsd: 2.0 });
    await pumpOnly(rtDiscExpensive.rt, [hunt1!.hunt_subject_id], ['background']);

    const [exhausted] = await sql<{ status: string; spent_cents: number }[]>`
      select status, spent_cents from crm_campaigns where id = ${cCap.id}
    `;
    expect(exhausted!.status).toBe('exhausted');
    expect(exhausted!.spent_cents).toBeGreaterThanOrEqual(200);

    // Bumping budget by +$10 auto-resumes the exhausted campaign!
    const bumped = await bumpCampaignBudget(appSql, {
      campaignId: cCap.id,
      addUsd: 10,
      by: 'Maria',
      idemKey: key(),
    });
    expect(bumped.resumed).toBe(true);
    expect(bumped.campaign.status).toBe('active');
    expect(bumped.campaign.budget_cents).toBe(1200);

    // Trying another hunt within 24h hits DAILY_HUNT_CAP (maxHuntsPerDay = 1)
    const rtDailyCap = makeRuntime([
      tools(
        call('launch_hunt', { query: 'pizzarias SP', city: 'São Paulo', reason: 'segunda busca' }),
        call('schedule_next_check', { waitMinutes: 360, reason: 'cota diária de buscas atingida' }),
      ),
      say('cota diária atingida, reagendado.'),
    ]);
    await pumpOnly(rtDailyCap.rt, [cCap.id], ['background']);
    const huntsCount = await sql<{ n: number }[]>`
      select count(*)::int as n from crm_campaign_hunts where campaign_id = ${cCap.id}
    `;
    expect(huntsCount[0]!.n).toBe(1);
  });

  test('Telegram /campanha command, inline buttons (pause/resume/bump/stop), and swipe-reply steering', async () => {
    const { campaign } = await startCampaign(appSql, {
      title: 'Campanha Docerias',
      objective: 'Conseguir 1 cadastro de doceria',
      goalKind: 'signup',
      budgetUsd: 15,
      by: 'Maria',
      chatId: FOUNDER_ID,
      idemKey: key(),
    });
    await deliverStaffEvents(appSql, { fetch: tgFetch, media: null });

    // Grab delivered living card message_id for swipe-reply test
    const [cardRow] = await sql<{ message_id: string }[]>`
      select message_id from staff_event_messages
      where chat_id = ${FOUNDER_ID} and anchor = ${`campaign:${campaign.id}`}
      order by event_id desc limit 1
    `;
    expect(cardRow).toBeDefined();

    // 1. /campanha slash command shows active campaign & controls
    calls = [];
    const cmdRes = await postWebhook({
      update_id: ++updateSeq,
      message: {
        message_id: 201,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        chat: { id: Number(FOUNDER_ID), type: 'private' },
        text: '/campanha',
      },
    });
    expect(cmdRes.status).toBe(200);
    const campCmdMsg = calls.find((c) => c.method === 'sendMessage');
    expect(String(campCmdMsg?.body.text ?? '')).toContain('Campanha Docerias');

    // 2. Swipe-reply directly on the living campaign card steers the director!
    calls = [];
    const swipeRes = await postWebhook({
      update_id: ++updateSeq,
      message: {
        message_id: 202,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        chat: { id: Number(FOUNDER_ID), type: 'private' },
        text: 'Foca em hamburguerias artesanais de BH agora',
        reply_to_message: { message_id: Number(cardRow!.message_id) },
      },
    });
    expect(swipeRes.status).toBe(200);
    const [afterSwipe] = await sql<{ playbook: string }[]>`
      select playbook from crm_campaigns where id = ${campaign.id}
    `;
    expect(afterSwipe!.playbook).toContain('hamburguerias artesanais de BH');

    // 3. Tap Pause, then +$10, then Stop buttons
    await postWebhook({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-p-${key()}`,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        message: {
          message_id: Number(cardRow!.message_id),
          chat: { id: Number(FOUNDER_ID), type: 'private' },
        },
        data: `cp:p:${campaign.id}`,
      },
    });
    expect(
      (
        await sql<{ status: string }[]>`select status from crm_campaigns where id = ${campaign.id}`
      )[0]!.status,
    ).toBe('paused');

    await postWebhook({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-b-${key()}`,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        message: {
          message_id: Number(cardRow!.message_id),
          chat: { id: Number(FOUNDER_ID), type: 'private' },
        },
        data: `cp:b:${campaign.id}`,
      },
    });
    const [afterBump] = await sql<{ status: string; budget_cents: number }[]>`
      select status, budget_cents from crm_campaigns where id = ${campaign.id}
    `;
    expect(afterBump!.status).toBe('active');
    expect(afterBump!.budget_cents).toBe(2500);

    await postWebhook({
      update_id: ++updateSeq,
      callback_query: {
        id: `cb-s-${key()}`,
        from: { id: Number(FOUNDER_ID), first_name: 'Maria' },
        message: {
          message_id: Number(cardRow!.message_id),
          chat: { id: Number(FOUNDER_ID), type: 'private' },
        },
        data: `cp:s:${campaign.id}`,
      },
    });
    expect(
      (
        await sql<{ status: string }[]>`select status from crm_campaigns where id = ${campaign.id}`
      )[0]!.status,
    ).toBe('stopped');
  });

  test('reply-goal ignores store auto-reply robots and wins on genuine human reply; meeting-goal wins on bookMeeting', async () => {
    const waPhone = phone();
    const lead = (
      await controlTx(appSql, (tx) =>
        insertLeadTx(tx, {
          name: 'Padaria Central',
          agent_mode: 'auto',
          whatsapp: waPhone,
          whatsapp_verified: true,
        }),
      )
    ).body.lead;

    // Seed an outbound message from agent marked sent so mark_auto_reply can recognize a robot greeting
    const seededOut = await controlTx(appSql, (tx) =>
      composeMessageTx(tx, {
        leadId: lead.id,
        channel: 'whatsapp',
        body: 'Oi, vi que vocês recebem encomendas por aqui!',
        author: 'agent',
        status: 'queued',
      }),
    );
    await sql`update lead_messages set status = 'sent' where id = ${seededOut.body.message.id}`;

    const replyCamp = (
      await startCampaign(appSql, {
        title: 'Conseguir 1 resposta humana',
        objective: '1 resposta de verdade',
        goalKind: 'reply',
        goalTarget: 1,
        by: 'Maria',
        idemKey: key(),
      })
    ).campaign;

    // Robot greeting arrives → crm-agent marks auto_reply → campaign MUST NOT win!
    await ingestInbound(appSql, {
      channel: 'whatsapp',
      from: waPhone,
      body: 'Olá! Seja bem-vindo à Padaria Central. Nosso horário de atendimento é 8h às 18h.',
    });
    const rtRobot = makeRuntime([
      tools(call('mark_auto_reply', { reason: 'saudação automática de WhatsApp Business' })),
      say('robô marcado'),
    ]);
    await pumpOnly(rtRobot.rt, [lead.id], ['followup']);
    expect(
      (
        await sql<{ status: string }[]>`select status from crm_campaigns where id = ${replyCamp.id}`
      )[0]!.status,
    ).toBe('active');

    // Now a real human writes back → crm-agent answers → campaign WINS!
    await ingestInbound(appSql, {
      channel: 'whatsapp',
      from: waPhone,
      body: 'Oi! Como funciona a plataforma de vocês?',
    });
    const rtHuman = makeRuntime([
      tools(
        call('send_message', {
          body: 'Oi! A Venduá monta sua loja própria para receber pedidos no WhatsApp sem comissão.',
        }),
      ),
      say('respondido'),
    ]);
    await pumpOnly(rtHuman.rt, [lead.id], ['followup']);
    expect(
      (
        await sql<
          { status: string; goal_progress: number }[]
        >`select status, goal_progress from crm_campaigns where id = ${replyCamp.id}`
      )[0],
    ).toEqual({ status: 'won', goal_progress: 1 });

    // Meeting-goal campaign wins immediately when a meeting is booked!
    const meetCamp = (
      await startCampaign(appSql, {
        title: 'Marcar 1 reunião',
        objective: '1 call agendada',
        goalKind: 'meeting',
        goalTarget: 1,
        by: 'Maria',
        idemKey: key(),
      })
    ).campaign;
    // Pick a clean weekday slot (next Monday 14:00 UTC = 11:00 Brasília) and ensure no leftover test booking occupies it
    const slot = new Date(Date.now() + 2 * 86_400_000);
    while (slot.getUTCDay() === 0 || slot.getUTCDay() === 6) {
      slot.setUTCDate(slot.getUTCDate() + 1);
    }
    slot.setUTCHours(14, 0, 0, 0);
    await sql`delete from meetings where starts_at = ${slot}`;
    await bookMeeting(appSql, {
      leadId: lead.id,
      start: slot.toISOString(),
      source: 'staff',
    });
    expect(
      (
        await sql<
          { status: string; goal_progress: number }[]
        >`select status, goal_progress from crm_campaigns where id = ${meetCamp.id}`
      )[0],
    ).toEqual({ status: 'won', goal_progress: 1 });
  });

  test('REST API /control/v1/agent/campaigns* + idempotency + RLS isolation', async () => {
    const createKey = key();
    const body = JSON.stringify({
      title: 'Campanha API',
      objective: 'Conseguir 1 cadastro via API',
      goalKind: 'signup',
      goalTarget: 1,
      budgetUsd: 18,
    });
    const r1 = await ctlReq('/control/v1/agent/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': createKey },
      body,
    });
    expect(r1.status).toBe(201);
    const j1 = (await r1.json()) as { campaign: { id: string; status: string } };
    expect(j1.campaign.status).toBe('active');

    // Replay same Idempotency-Key returns same campaign
    const r2 = await ctlReq('/control/v1/agent/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': createKey },
      body,
    });
    expect(r2.status).toBe(200);
    const j2 = (await r2.json()) as { campaign: { id: string } };
    expect(j2.campaign.id).toBe(j1.campaign.id);

    // GET list & detail
    const listRes = await ctlReq('/control/v1/agent/campaigns?status=open');
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { campaigns: { id: string }[] };
    expect(listJson.campaigns.some((c) => c.id === j1.campaign.id)).toBe(true);

    const detailRes = await ctlReq(`/control/v1/agent/campaigns/${j1.campaign.id}`);
    expect(detailRes.status).toBe(200);

    // Bad UUID returns 400 (never 500)
    const badRes = await ctlReq('/control/v1/agent/campaigns/not-a-uuid');
    expect(badRes.status).toBe(400);

    // Pause, guide, bump budget, stop
    const pauseRes = await ctlReq(`/control/v1/agent/campaigns/${j1.campaign.id}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key() },
      body: JSON.stringify({ reason: 'revisando' }),
    });
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as { campaign: { status: string } }).campaign.status).toBe(
      'paused',
    );

    const stopRes = await ctlReq(`/control/v1/agent/campaigns/${j1.campaign.id}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key() },
      body: JSON.stringify({ reason: 'fim' }),
    });
    expect(stopRes.status).toBe(200);
    expect(((await stopRes.json()) as { campaign: { status: string } }).campaign.status).toBe(
      'stopped',
    );

    // RLS isolation: a store tenant tx cannot read any campaign table!
    const [tenant] = await sql<{ id: string }[]>`
      insert into tenants (name, slug)
      values ('Loja Isolada', ${`loja-rls-${nonce}`})
      returning id
    `;
    const leaked = await withTenant(appSql, tenant!.id, async (tx) => {
      const a = await tx`select * from crm_campaigns`;
      const b = await tx`select * from crm_campaign_leads`;
      const c = await tx`select * from crm_campaign_hunts`;
      return a.length + b.length + c.length;
    });
    expect(leaked).toBe(0);

    // Sanity check campaignMetricsTx works under controlTx
    const metrics = await controlTx(appSql, (tx) => campaignMetricsTx(tx, j1.campaign.id));
    expect(metrics?.campaign.status).toBe('stopped');
  });
});
