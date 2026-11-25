import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { scheduleTimerTx } from '../src/crm/agenda.ts';
import {
  CRM_RESET_KEEPS,
  CRM_RESET_OWN_STEPS,
  CRM_RESET_WIPES,
  platformTables,
  unclassifiedPlatform,
} from '../src/crm/reset.ts';
import { controlTx } from '../src/modules/control.ts';
import { migrate, type Sql } from '../src/platform/db.ts';

// Staff zero the CRM (crm/reset.ts). The API runs as vendua_app, so a wipe RLS would quietly skip
// shows up here. The reset takes every CRM row in the database, so this file seeds its own.

const PLATFORM = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!process.env.TEST_DATABASE_URL)('CRM reset (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  );
  const app = createApp({ sql: appSql, sessionSecret: 's', controlSecret: 'ctl' });
  const nonce = crypto.randomUUID().slice(0, 6);
  const tenants: string[] = [];
  const soon = (days: number) => new Date(Date.now() + days * 86_400_000);

  const request = async (method: 'GET' | 'POST', body?: unknown, key = crypto.randomUUID()) => {
    const res = await app.request('http://core.localhost/control/v1/crm/reset', {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        ...(method === 'POST' ? { 'idempotency-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: res.status,
      replay: res.headers.get('x-idempotent-replay'),
      body: (await res.json()) as any,
    };
  };

  /** a lead talking to the agent: a thread, a sent and a queued message, a fact, a task and a
   *  follow-up timer (its actor and mailbox under the platform tenant) */
  const lead = async (name: string, tenantId: string | null = null) => {
    const [l] = await sql<{ id: string }[]>`
      insert into leads (name, tenant_id, intent_score, intent_reason, agent_plan)
      values (${`${name} ${nonce}`}, ${tenantId}, 7, 'quer começar',
              '[{"step":"ligar","status":"todo"}]'::jsonb)
      returning id`;
    const id = l!.id;
    const [t] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${id}, 'whatsapp') returning id`;
    await sql`
      insert into lead_messages (thread_id, direction, author, status, body)
      values (${t!.id}, 'out', 'agent', 'sent', 'oi'), (${t!.id}, 'in', 'lead', 'received', 'oi!')`;
    const [queued] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, status, body)
      values (${t!.id}, 'out', 'agent', 'queued', 'e aí, bora?') returning id`;
    await sql`
      insert into lead_facts (lead_id, key, value, source) values (${id}, 'segmento', 'doces', 'agent')`;
    await sql`insert into lead_tasks (lead_id, title) values (${id}, 'ligar amanhã')`;
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: id,
        at: soon(2),
        focus: 'follow-up',
        requested: false,
        by: 'agent',
      }),
    );
    return { id, threadId: t!.id, queuedId: queued!.id };
  };

  const count = async (q: string, params: unknown[] = []) =>
    (await sql.unsafe<{ n: number }[]>(q, params as never[]))[0]!.n;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    await sql`delete from leads where tenant_id = any(${tenants}::uuid[])`;
    await sql`delete from meetings where booker_name = ${`Call ${nonce}`}`;
    await sql`delete from tenants where id = any(${tenants}::uuid[])`;
    await sql`delete from staff_events where kind = 'crm.reset'`;
    await sql.end();
    await appSql.end();
  });

  test('every platform table is kept, wiped or reset by hand — exactly once', async () => {
    const tables = await platformTables(sql as unknown as Sql);
    expect(unclassifiedPlatform(tables)).toEqual([]);
    const named = [...CRM_RESET_KEEPS, ...CRM_RESET_WIPES, ...CRM_RESET_OWN_STEPS];
    expect(new Set(named).size).toBe(named.length);
    // leads carries a tenant_id (the store it became) but is the CRM's own table
    expect(named.filter((t) => !tables.includes(t) && t !== 'leads')).toEqual([]);
  });

  test('asks for the word, typed', async () => {
    const wrong = await request('POST', { confirm: 'resetar' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('CONFIRM_MISMATCH');
    const missing = await request('POST', {});
    expect(missing.status).toBe(422);
  });

  test('leads, memory and the agents start over; stores, upcoming calls and connections stay', async () => {
    const [store] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`crm-reset-${nonce}`}, 'Doces da Ana') returning id`;
    tenants.push(store!.id);
    const gone = await lead('Padaria');
    const kept = await lead('Doces da Ana', store!.id);

    const [past] = await sql<{ id: string }[]>`
      insert into meetings (lead_id, starts_at, ends_at, status, booker_name)
      values (${gone.id}, ${soon(-3)}, ${soon(-2.95)}, 'done', ${`Call ${nonce}`}) returning id`;
    const [ahead] = await sql<{ id: string }[]>`
      insert into meetings (lead_id, starts_at, ends_at, status, booker_name)
      values (${gone.id}, ${soon(1)}, ${soon(1.05)}, 'scheduled', ${`Call ${nonce}`}) returning id`;
    await sql`
      insert into platform_wa_outbox (to_jid, body, purpose, ref, dedupe_key)
      values ('5522999990001', 'e aí, bora?', 'crm', ${gone.queuedId}, ${`crm:${gone.queuedId}`}),
             ('5522999990002', 'seu código', 'otp', null, ${`otp:${nonce}`})`;
    await sql`
      insert into agent_memory_items (scope, content, source, pinned)
      values ('workspace', 'padarias respondem cedo', 'agent', false),
             ('workspace', 'nunca prometer prazo', 'staff', true)`;
    await sql`
      insert into agent_memory (tenant_id, scope, key, value, confidence, provenance)
      values (${PLATFORM}, ${`lead:${gone.id}`}, 'tom', '"informal"', 0.8, 'turn')`;
    await sql`insert into discovery_briefs (name, query, created_by) values ('Padarias', 'padaria rj', 'staff')`;
    await sql`
      insert into crm_campaigns (title, objective, expires_at, created_by)
      values ('Black Friday', '10 cadastros', ${soon(10)}, 'staff')`;
    await sql`insert into ig_follows (handle, lead_id) values (${`padaria_${nonce}`}, ${gone.id})`;
    await sql`insert into sim_runs (scenario, lead_id) values ('objeção de preço', ${gone.id})`;
    await sql`insert into pipeline_snapshots (taken_on, by_state) values (current_date, '{}')`;
    await sql`
      insert into control_settings (key, value) values ('pitch', '{"product":"Venduá custom"}')
      on conflict (key) do update set value = excluded.value`;
    await sql`
      insert into control_settings (key, value)
      values ('agent', '{"level":"supervised","instructions":"- só fale de bolo"}')
      on conflict (key) do update set value = control_settings.value || excluded.value`;
    expect(
      await count(`select count(*)::int as n from agent_actors where tenant_id = $1`, [PLATFORM]),
    ).toBeGreaterThan(0);

    const preview = await request('GET');
    expect(preview.status).toBe(200);
    expect(preview.body.word).toBe('zerar crm');
    expect(preview.body.counts.leads).toBeGreaterThanOrEqual(1);
    expect(preview.body.counts.keptLeads).toBeGreaterThanOrEqual(1);
    expect(preview.body.counts.memories).toBeGreaterThanOrEqual(5);
    expect(preview.body.counts.meetingsKept).toBeGreaterThanOrEqual(1);

    const key = crypto.randomUUID();
    const res = await request('POST', { confirm: '  Zerar   CRM ' }, key);
    expect(res.status).toBe(200);
    expect(res.body.leads).toBe(preview.body.counts.leads);
    expect(res.body.keptLeads).toBe(preview.body.counts.keptLeads);

    // the agents' runtime under the platform tenant, and every CRM table that is all agent work
    expect(
      await count(`select count(*)::int as n from agent_actors where tenant_id = $1`, [PLATFORM]),
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from agent_mailbox where tenant_id = $1`, [PLATFORM]),
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from agent_memory where tenant_id = $1`, [PLATFORM]),
    ).toBe(0);
    for (const t of CRM_RESET_WIPES)
      expect([t, await count(`select count(*)::int as n from "${t}"`)]).toEqual([t, 0]);

    // the lead that didn't become a store is gone with its conversation
    expect(await count(`select count(*)::int as n from leads where tenant_id is null`)).toBe(0);
    expect(
      await count(`select count(*)::int as n from lead_threads where id = $1`, [gone.threadId]),
    ).toBe(0);

    // the store's lead stays with its conversation and tasks; the agent forgot it
    const [k] = await sql<
      {
        intent_score: number | null;
        agent_plan: unknown[];
        next_action_at: Date | null;
        next_action_source: string | null;
      }[]
    >`select intent_score, agent_plan, next_action_at, next_action_source from leads where id = ${kept.id}`;
    expect(k).toEqual({
      intent_score: null,
      agent_plan: [],
      next_action_at: null,
      next_action_source: 'agent',
    });
    expect(
      await count(`select count(*)::int as n from lead_messages where thread_id = $1`, [
        kept.threadId,
      ]),
    ).toBe(3);
    const [q] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${kept.queuedId}`;
    expect(q!.status).toBe('rejected');
    expect(
      await count(`select count(*)::int as n from lead_tasks where lead_id = $1`, [kept.id]),
    ).toBe(1);

    // the call ahead stays on the agenda without its lead; the one that happened goes
    const meetings = await sql<{ id: string; lead_id: string | null }[]>`
      select id, lead_id from meetings where id in (${past!.id}, ${ahead!.id})`;
    expect([...meetings]).toEqual([{ id: ahead!.id, lead_id: null }]);

    // the gateway no longer has the wiped message to send; other purposes stay
    expect(
      await count(`select count(*)::int as n from platform_wa_outbox where ref = $1`, [
        gone.queuedId,
      ]),
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from platform_wa_outbox where dedupe_key = $1`, [
        `otp:${nonce}`,
      ]),
    ).toBe(1);

    // instructions and pitch back to the defaults; autonomy stays
    const settings = await sql<{ key: string; value: Record<string, unknown> }[]>`
      select key, value from control_settings where key in ('agent', 'pitch')`;
    expect(settings.map((s) => s.key)).toEqual(['agent']);
    expect(settings[0]!.value.instructions).toBeUndefined();
    expect(settings[0]!.value.level).toBe('supervised');

    const [ev] = await sql<{ tenant_id: string | null; data: Record<string, number> }[]>`
      select tenant_id, data from staff_events where kind = 'crm.reset' order by id desc limit 1`;
    expect(ev).toEqual({
      tenant_id: null,
      data: { leads: res.body.leads, keptLeads: res.body.keptLeads },
    });

    // a lost answer replays; it doesn't run again
    const again = await request('POST', { confirm: 'zerar crm' }, key);
    expect(again.status).toBe(200);
    expect(again.replay).toBe('true');
    expect(again.body.resetAt).toBe(res.body.resetAt);
  });
});
