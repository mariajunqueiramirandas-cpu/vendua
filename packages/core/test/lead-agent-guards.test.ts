import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun } from '../src/agent/runner.ts';
import { scheduleWakeupTx } from '../src/agent/wakeups.ts';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import { addInboundMessage, composeMessageTx } from '../src/modules/threads.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  e164Phone,
  insertLeadTx,
  leadInsert,
  leadPatch,
  updateLead,
} from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('lead phones are stored as E.164', () => {
  test('a typed BR number gains +55; an explicit country code and jids are kept', () => {
    expect(e164Phone('(31) 98765-4321')).toBe('+5531987654321');
    expect(e164Phone('031 98765-4321')).toBe('+5531987654321');
    expect(e164Phone('(31) 3333-4444')).toBe('+553133334444');
    expect(e164Phone('5531987654321')).toBe('+5531987654321');
    expect(e164Phone('+1 415 555 1234')).toBe('+14155551234');
    expect(e164Phone('98765-4321')).toBeNull();
    expect(e164Phone('447911123456')).toBeNull();
    expect(e164Phone('123456789012345@lid')).toBeNull();
  });

  test('staff create, CSV import and agent patches all normalize', () => {
    const ins = leadInsert({ name: 'X', whatsapp: '(31) 98765-4321', phone: '31 3333-4444' });
    expect(ins.whatsapp).toBe('+5531987654321');
    expect(ins.phone).toBe('+553133334444');
    expect(leadPatch({ whatsapp: '31987654321' }, 'agent').whatsapp).toBe('+5531987654321');
    // what can't be placed stays as typed — the send refuses it
    expect(leadInsert({ name: 'Y', whatsapp: '9876-5432' }).whatsapp).toBe('9876-5432');
    expect(leadInsert({ name: 'Z', whatsapp: '123456789012345@lid' }).whatsapp).toBe(
      '123456789012345@lid',
    );
  });

  test('an agent-set next action keeps the 10-minute floor; staff may set one due now', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(() => leadPatch({ nextActionAt: past }, 'agent')).toThrow(/10 minutes/);
    expect(leadPatch({ nextActionAt: past }, 'staff').next_action_at).toBe(past);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect(leadPatch({ nextActionAt: later }, 'agent').next_action_at).toBe(later);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('lead agent guards (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const uniq = crypto.randomUUID().slice(0, 8);
  const freshDigits = () => crypto.randomUUID().replace(/\D/g, '').padEnd(8, '7').slice(0, 8);

  const mkCtx = (
    runKind: ToolContext['runKind'],
    leadId: string | null,
    threadId: string | null = null,
  ): ToolContext => ({
    sql,
    runId: `guard-${crypto.randomUUID()}`,
    runKind,
    leadId,
    threadId,
    step: 0,
    claimToken: null,
    pageCache: new Map(),
    briefName: null,
    leadCap: 20,
    channelOverride: null,
    book: new Map(),
    plan: null,
    monid: null,
    seenContacts: new Set(),
    pageReads: 0,
    draftOnly: false,
  });
  const mkLead = async (fields: Record<string, unknown>) =>
    (await controlTx(sql, (tx) => insertLeadTx(tx, fields))).body.lead.id;
  const wakeups = (leadId: string) =>
    sql<{ created_by: string; requested: boolean; status: string; cancel_reason: string | null }[]>`
      select created_by, requested, status, cancel_reason from agent_wakeups
      where lead_id = ${leadId} order by created_at
    `;
  const book = (leadId: string, createdBy: 'agent' | 'staff', requested: boolean) =>
    controlTx(sql, (tx) =>
      scheduleWakeupTx(tx, {
        leadId,
        at: new Date(Date.now() + 86_400_000),
        focus: 'retomar',
        requested,
        runId: null,
        createdBy,
        floor: false,
      }),
    );

  afterEach(async () => {
    await sql`delete from control_settings where key in ('guardrails', 'agent')`;
  });

  test('a message recorded by an attempt that died before the gate is answered on retry', async () => {
    await migrate(sql, MIGRATIONS);
    // the parked start keeps the run queued (no drain claims it) while we look
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const from = `55119${freshDigits()}@s.whatsapp.net`;
    const pmid = `lost-gate-${uniq}`;
    // first attempt: the message commits, then the process dies before the gate tx
    const first = await addInboundMessage(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi, quero saber mais',
      providerMessageId: pmid,
    });
    expect(first?.alreadySeen).toBe(false);
    const inbox = () =>
      sql`select 1 from agent_inbox where lead_id = ${first!.leadId} and payload->>'messageId' = ${first!.messageId}`;
    expect(await inbox()).toHaveLength(0);
    // the provider retries: the message is seen, but nothing filed it — the gate runs now
    const retry = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi, quero saber mais',
      providerMessageId: pmid,
    });
    if ('ignored' in retry) throw new Error('unexpected ignore');
    expect(retry.alreadySeen).toBe(true);
    expect(await inbox()).toHaveLength(1);
    const runs = await sql`
      select 1 from agent_runs where lead_id = ${first!.leadId} and status = 'queued' and source = 'inbound'
    `;
    expect(runs).toHaveLength(1);
    // a further retry finds the request filed — no second one
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi, quero saber mais',
      providerMessageId: pmid,
    });
    expect(await inbox()).toHaveLength(1);
    await sql`update agent_runs set status = 'canceled' where lead_id = ${first!.leadId} and status = 'queued'`;
    // no orphan mail left behind for other files' sweeps to trip on
    await sql`update agent_inbox set consumed_at = now() where lead_id = ${first!.leadId}`;
  });

  test('an inbound while replies are switched off parks and is answered once they are back', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value)
      values ('agent', ${sql.json({ level: 'supervised', jobs: { reply: false } } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const from = `55119${freshDigits()}@s.whatsapp.net`;
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'tem horário amanhã?',
      providerMessageId: `parked-${uniq}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [run] = await sql<{ id: string }[]>`
      select id from agent_runs where lead_id = ${res.leadId} and status = 'queued' and source = 'inbound'
    `;
    expect(run).toBeDefined();
    const filed = await sql`
      select 1 from agent_inbox where lead_id = ${res.leadId} and payload->>'messageId' = ${res.messageId}
    `;
    expect(filed).toHaveLength(1);
    // ahead of any queued run a concurrent test file leaves on the shared DB
    await sql`update agent_runs set priority = -1 where id = ${run!.id}`;
    expect((await claimRun(sql))?.id).not.toBe(run!.id);
    await sql`delete from control_settings where key = 'agent'`;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(run!.id);
    await sql`update agent_runs set status = 'canceled' where id = ${run!.id}`;
    await sql`update agent_inbox set consumed_at = now() where lead_id = ${res.leadId}`;
  });

  test('a lead going live stops the sales agent and its own dates; staff dates stay', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead({ name: `live-${uniq}`, agent_mode: 'auto', state: 'invited' });
    await book(leadId, 'agent', true);
    await book(leadId, 'staff', false);
    await updateLead(sql, leadId, { state: 'live' }, `guard-live-${uniq}`, 'system');
    const [lead] = await sql<{ agent_mode: string; state: string }[]>`
      select agent_mode, state from leads where id = ${leadId}
    `;
    expect(lead).toEqual({ agent_mode: 'off', state: 'live' });
    const w = await wakeups(leadId);
    expect(w.find((x) => x.created_by === 'agent')).toMatchObject({
      status: 'canceled',
      cancel_reason: 'loja no ar',
    });
    expect(w.find((x) => x.created_by === 'staff')?.status).toBe('pending');
  });

  test("the agent's whatsapp to a store owner's number never goes out", async () => {
    await migrate(sql, MIGRATIONS);
    const national = `119${freshDigits()}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`guard-${uniq}`}, 'Loja Guard') returning id
    `;
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${t!.id}, 'Dona', ${national}, 'owner') returning id
    `;
    // a membership counts once its person signed in with a WhatsApp code
    await sql`
      insert into merchant_sessions (tenant_id, user_id, secret_hash, expires_at, proof_kind, proof_subject)
      values (${t!.id}, ${u!.id}, ${`h-${uniq}`}, now() + interval '1 day', 'phone', ${national})
    `;
    const leadId = await mkLead({ name: `merchant-${uniq}`, whatsapp: `+55${national}` });
    const send = async (author: 'agent' | 'staff') => {
      const composed = await controlTx(sql, (tx) =>
        composeMessageTx(tx, {
          leadId,
          channel: 'whatsapp',
          body: 'oi',
          author,
          status: 'queued',
        }),
      );
      return dispatchMessage(sql, composed.body.message.id);
    };
    expect(await send('agent')).toEqual({ ok: false, reason: 'número de lojista' });
    // staff may still write to a customer — only the sales agent is held off
    expect((await send('staff')).reason).not.toBe('número de lojista');
  });

  test('a whatsapp number with no country code is refused at send', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead({ name: `noddi-${uniq}`, whatsapp: '98765-4321' });
    const composed = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId,
        channel: 'whatsapp',
        body: 'oi',
        author: 'staff',
        status: 'queued',
      }),
    );
    const out = await dispatchMessage(sql, composed.body.message.id);
    expect(out).toEqual({ ok: false, reason: 'número de whatsapp sem DDI' });
  });

  test('create_lead takes only its declared fields; its date is the agent’s own', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value)
      values ('agent', ${sql.json({ newLeadMode: { discovery: 'draft' } } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const ctx = mkCtx('discovery', null);
    const out = (await executeTool(ctx, 'c1', 'create_lead', {
      name: `created-${uniq}`,
      whatsapp: `+55119${freshDigits()}`,
      findings: 'doceria artesanal, vende pelo whatsapp, sem link próprio de pedidos',
      agentMode: 'auto',
      state: 'live',
      owner: 'quem-quiser',
      nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
    })) as { lead?: { id: string } };
    const leadId = out.lead!.id;
    const [lead] = await sql<{ agent_mode: string; state: string; owner: string | null }[]>`
      select agent_mode, state, owner from leads where id = ${leadId}
    `;
    expect(lead!.state).toBe('lead');
    expect(lead!.agent_mode).toBe('draft');
    expect(lead!.owner).toBeNull();
    expect([...(await wakeups(leadId))]).toEqual([
      { created_by: 'agent', requested: false, status: 'pending', cancel_reason: null },
    ]);
    const past = (await executeTool(ctx, 'c2', 'create_lead', {
      name: `past-${uniq}`,
      whatsapp: `+55119${freshDigits()}`,
      findings: 'doceria artesanal, vende pelo whatsapp, sem link próprio de pedidos',
      nextActionAt: new Date(Date.now() - 60_000).toISOString(),
    }).catch((e: Error) => ({ error: e.message }))) as { error?: string };
    expect(past.error).toContain('10 minutes');
  });

  test('a run with no lead touches only the leads it created', async () => {
    await migrate(sql, MIGRATIONS);
    const other = await mkLead({ name: `foreign-${uniq}` });
    const ctx = mkCtx('discovery', null);
    for (const [name, args] of [
      ['update_lead', { id: other, archived: true }],
      ['add_note', { leadId: other, body: 'x' }],
      ['get_lead', { id: other }],
    ] as const) {
      const r = (await executeTool(ctx, `x-${name}`, name, args)) as { error?: string };
      expect(r.error).toContain('LEAD_MISMATCH');
    }
    const [o] = await sql<{ archived_at: Date | null }[]>`
      select archived_at from leads where id = ${other}
    `;
    expect(o!.archived_at).toBeNull();
    const made = (await executeTool(ctx, 'mk', 'create_lead', {
      name: `own-${uniq}`,
      whatsapp: `+55119${freshDigits()}`,
      findings: 'pizzaria de bairro, pedidos só por telefone e ifood',
    })) as { lead: { id: string } };
    const upd = (await executeTool(ctx, 'up', 'update_lead', {
      id: made.lead.id,
      city: 'Recife',
    })) as { error?: string; lead?: { city: string } };
    expect(upd.error).toBeUndefined();
    expect(upd.lead?.city).toBe('Recife');
  });

  test('a thread-bound handoff drops the dates the agent booked', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead({ name: `handoff-${uniq}`, agent_mode: 'auto' });
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await book(leadId, 'agent', true);
    await book(leadId, 'staff', false);
    const out = await executeTool(mkCtx('reply', leadId, thread!.id), 'h1', 'request_human', {
      leadId,
      reason: 'quer falar com alguém',
    });
    expect(out).toEqual({ handedOff: true });
    const w = await wakeups(leadId);
    expect(w.find((x) => x.created_by === 'agent')?.status).toBe('canceled');
    expect(w.find((x) => x.created_by === 'staff')?.status).toBe('pending');
  });

  test('update_lead refuses an agent date that is already due', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead({ name: `floor-${uniq}` });
    const out = (await executeTool(mkCtx('reply', leadId), 'f1', 'update_lead', {
      id: leadId,
      nextActionAt: new Date(Date.now() - 3_600_000).toISOString(),
    }).catch((e: Error) => ({ error: e.message }))) as { error?: string };
    expect(out.error).toContain('10 minutes');
    expect(await wakeups(leadId)).toHaveLength(0);
  });
});
