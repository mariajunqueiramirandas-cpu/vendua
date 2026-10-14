import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  type Lane,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { crmAgent } from '../src/agent-host/agents/crm/index.ts';
import { crmDiscovery } from '../src/agent-host/agents/crm/discovery.ts';
import { crmLogTransport } from '../src/agent-host/agents/crm/shared.ts';
import { crmStrategist } from '../src/agent-host/agents/crm/strategist.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import {
  CRM_AGENT_ID,
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  requestBoardTx,
  requestLeadTx,
  REVIEW_ID,
  REVIEW_SUBJECT,
} from '../src/crm/dispatch.ts';
import { ingestInbound } from '../src/crm/inbound.ts';
import type { JobKind } from '../src/crm/policy.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, upsertIntegration } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';

// The CRM agents' test bench: a scripted model drives the real Runtime v3, Postgres store and host
// hooks under the platform tenant. `settle` runs only the actors a test registered in `mine`, so
// work earlier tests left behind never takes a script meant for this one.

export const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

export const call = (name: string, args: Record<string, unknown> = {}): ScriptedOutput => ({
  toolCalls: [{ name, args } as never],
});
export const say = (text: string): ScriptedOutput => ({ text });

/** What one scripted call came back as: the tool's result, or the guard that refused it. */
export type ToolOutcome =
  | { name: string; ok: boolean; content: string; data: unknown; blocked?: undefined }
  | { name: string; blocked: string; feedback: string };

export function crmBench(tag = 'crm') {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const app = createApp({ sql: appSql, sessionSecret: 's', controlSecret: 'ctl' });
  const nonce = crypto.randomUUID().slice(0, 8);
  let idem = 0;
  const key = () => `${tag}-${nonce}-${++idem}`;
  const phone = () => `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  /** the subjects (lead ids, hunt ids, 'weekly') settle() may run; clear it per test */
  const mine = new Set<string>();

  /** the discovery rows before setup: a hunt with no research tool parks, so the bench runs
   *  discovery on the mock provider and puts back what was there */
  let discoveryWas: { driver: string; enabled: boolean }[] = [];
  async function setup() {
    await migrate(sql as unknown as Sql, join(import.meta.dir, '../db/migrations'));
    await upsertIntegration(
      sql as unknown as Sql,
      { kind: 'whatsapp', driver: 'log', enabled: true },
      key(),
    );
    discoveryWas = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'`;
    await upsertIntegration(
      sql as unknown as Sql,
      { kind: 'discovery', driver: 'mock', enabled: true },
      key(),
    );
  }
  /** every subject this bench ran: its unconsumed work goes at teardown, so a later file's
   *  budgets and queues don't count it */
  const ran = new Set<string>();
  async function teardown() {
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.tenant_id = ${PLATFORM_TENANT_ID}
        and a.subject_id = any(${[...ran]}) and m.consumed_by_turn is null`;
    await sql`delete from control_settings where key in ('agent', 'guardrails')`;
    await sql`delete from control_integrations where kind = 'discovery'`;
    for (const d of discoveryWas)
      await upsertIntegration(
        sql as unknown as Sql,
        { kind: 'discovery', driver: d.driver, enabled: d.enabled },
        key(),
      );
    await sql.end();
    await (appSql as unknown as { end: () => Promise<void> }).end();
  }

  /** The agent setting and guardrails; quiet hours off unless a test turns them on. */
  async function settings(
    level: 'off' | 'copilot' | 'supervised' | 'autopilot',
    g: Record<string, unknown> = {},
    agent: Record<string, unknown> = {},
  ) {
    await sql`insert into control_settings (key, value)
      values ('agent', ${sql.json({ level, ...agent } as never)})
      on conflict (key) do update set value = excluded.value`;
    await sql`insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ ...DEFAULT_GUARDRAILS, quietHoursEnabled: false, ...g } as never)})
      on conflict (key) do update set value = excluded.value`;
  }

  async function lead(fields: Record<string, unknown> = {}) {
    const created = await controlTx(appSql, (tx) =>
      insertLeadTx(tx, { name: 'Doceria Teste', agent_mode: 'auto', whatsapp: phone(), ...fields }),
    );
    mine.add(created.body.lead.id);
    return created.body.lead;
  }

  function runtime(script: ScriptedOutput[] | ((i: number) => ScriptedOutput)) {
    const adapter = scriptedAdapter(typeof script === 'function' ? (_req, i) => script(i) : script);
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    const clock = { offset: 60_000 };
    const rt = new Runtime<Sql>({
      agents: [crmAgent, crmDiscovery, crmStrategist],
      store: new PgActorStore(appSql),
      gateway,
      transports: [crmLogTransport],
      owner: `w-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + clock.offset), sleep: async () => {} },
    });
    return { rt, adapter, clock };
  }

  /** Runs this test's due actors until none is left. The store claims on the database clock. */
  async function settle(rt: Runtime<Sql>, lanes: Lane[] = ['followup', 'background']) {
    for (const id of mine) ran.add(id);
    for (let i = 0; i < 30; i++) {
      await sql`
        update agent_actors set next_wake_at = null
        where tenant_id = ${PLATFORM_TENANT_ID} and not (subject_id = any(${[...mine]}))`;
      let n = 0;
      for (const l of lanes) n += await rt.pump(l, { limit: 10, perTenantCap: 10 });
      if (n === 0) break;
    }
  }

  /**
   * One staff-requested turn that makes these calls in order, then stops. `kind` picks the job
   * (and so the tools offered): triage, reply, outreach (the default) for a lead; discovery and
   * strategist run their own actors (`subject` names the hunt). Returns each call's outcome.
   */
  async function runTools(
    calls: [string, Record<string, unknown>?][],
    opts: {
      leadId?: string;
      kind?: JobKind;
      subject?: string;
      payload?: Record<string, unknown>;
    } = {},
  ): Promise<{ outcomes: ToolOutcome[]; requests: number; actorId: string }> {
    const kind = opts.kind ?? 'outreach';
    let actorId: string;
    if (kind === 'discovery' || kind === 'strategist') {
      const subject = kind === 'strategist' ? REVIEW_ID : (opts.subject ?? crypto.randomUUID());
      mine.add(subject);
      const d = await controlTx(appSql, (tx) =>
        requestBoardTx(tx, {
          agent: kind === 'strategist' ? CRM_STRATEGIST_ID : CRM_DISCOVERY_ID,
          subject: { kind: kind === 'strategist' ? REVIEW_SUBJECT : HUNT_SUBJECT, id: subject },
          kind: 'staff.request',
          source: 'staff',
          dedupeKey: `crm:test:${key()}`,
          payload: { kind, ...opts.payload } as never,
        }),
      );
      actorId = d.actorId;
    } else {
      if (!opts.leadId) throw new Error('runTools: a lead job needs leadId');
      mine.add(opts.leadId);
      await controlTx(appSql, (tx) =>
        requestLeadTx(tx, {
          leadId: opts.leadId!,
          kind: 'staff.request',
          source: 'staff',
          dedupeKey: `crm:test:${key()}`,
          payload: { kind, ...opts.payload } as never,
        }),
      );
      const [a] = await sql<{ id: string }[]>`
        select id from agent_actors where tenant_id = ${PLATFORM_TENANT_ID}
          and agent_id = ${CRM_AGENT_ID} and subject_id = ${opts.leadId}`;
      actorId = a!.id;
    }
    const [{ seq } = { seq: '0' }] = await sql<{ seq: string }[]>`
      select coalesce(max(seq), 0)::text as seq from agent_events where actor_id = ${actorId}`;
    const { rt, adapter } = runtime((i) =>
      i < calls.length ? call(calls[i]![0], calls[i]![1] ?? {}) : say('ok'),
    );
    await settle(rt);
    const events = await sql<{ type: string; payload: Record<string, unknown> }[]>`
      select type, payload from agent_events
      where actor_id = ${actorId} and seq > ${seq}::bigint
        and (type = 'tool.returned' or (type = 'guard.blocked' and payload->>'stage' = 'tool'))
      order by seq`;
    const outcomes = events.map((e): ToolOutcome => {
      const p = e.payload;
      if (e.type === 'guard.blocked')
        return {
          name: String(p.tool),
          blocked: String(p.reason),
          feedback: String(p.feedback ?? ''),
        };
      return {
        name: String(p.name),
        ok: p.ok === true,
        content: String(p.content ?? ''),
        data: p.data ?? null,
      };
    });
    return { outcomes, requests: adapter.requests.length, actorId };
  }

  const turns = (leadId: string) =>
    sql<
      {
        turn_id: string;
        kind: string;
        status: string;
        acted: boolean;
        steps: number;
        source: string;
        error: string | null;
        cost_cents: number;
      }[]
    >`
      select turn_id, kind, status, acted, steps, source, error, cost_cents from crm_turns
      where lead_id = ${leadId} order by finished_at`;
  const outbound = (leadId: string) =>
    sql<{ id: string; status: string; body: string; agent_run_id: string | null }[]>`
      select m.id, m.status, m.body, m.agent_run_id from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and m.direction = 'out' order by m.created_at`;
  /** The subject's mailbox, oldest first (consumed rows included). */
  const mail = (subjectId: string) =>
    sql<
      {
        id: string;
        kind: string;
        source: string;
        payload: Record<string, unknown>;
        consumed_by_turn: string | null;
        deliver_at: Date;
      }[]
    >`
      select m.id, m.kind, m.source, m.payload, m.consumed_by_turn, m.deliver_at
      from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.subject_id = ${subjectId}
      order by m.created_at`;
  const inbound = (whatsapp: string, body = 'oi, quero saber do plano') =>
    ingestInbound(appSql, {
      channel: 'whatsapp',
      from: whatsapp,
      body,
      providerMessageId: `${tag}-${crypto.randomUUID()}`,
    });
  const control = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        'idempotency-key': key(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    sql,
    appSql,
    app,
    nonce,
    key,
    phone,
    mine,
    setup,
    teardown,
    settings,
    lead,
    runtime,
    settle,
    runTools,
    turns,
    outbound,
    mail,
    inbound,
    control,
  };
}
