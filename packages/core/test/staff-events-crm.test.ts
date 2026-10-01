import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { ingestResendEvent } from '../src/agent/channels/email-inbound.ts';
import { ingestInbound } from '../src/agent/inbound.ts';
import { setTestProvider } from '../src/agent/llm.ts';
import { drain, enqueueRun, runOnce } from '../src/agent/runner.ts';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import { completeTask } from '../src/modules/activities.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { availableSlots, bookMeeting, cancelByLead } from '../src/modules/meetings.ts';
import { addInboundMessage, approveMessage, rejectMessage } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0023 — the CRM and the sales agent record staff events in the same tx as the change.
describe.skipIf(!process.env.TEST_DATABASE_URL)('staff events: CRM + sales agent (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // TEST_APP_DATABASE_URL runs the code paths as vendua_app under RLS, as prod does
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl-ev',
    autoDrain: false,
  });
  const uniq = crypto.randomUUID().slice(0, 8);
  const leads: string[] = [];
  const runs: string[] = [];
  let idem = 0;
  let prevGuardrails: unknown = null;

  type Ev = {
    kind: string;
    tenant_id: string | null;
    anchor: string | null;
    dedupe_key: string | null;
    severity: string;
    data: Record<string, unknown>;
  };
  const events = (kind: string, field: string, value: string) =>
    sql<Ev[]>`
      select kind, tenant_id, anchor, dedupe_key, severity, data from staff_events
      where kind = ${kind} and data->>${field} = ${value} order by id
    `;

  const mkLead = async (fields: Record<string, unknown>) => {
    const id = await controlTx(sql, (tx) => insertLeadTx(tx, fields)).then((r) => r.body.lead.id);
    leads.push(id);
    return id;
  };

  const ctxFor = (leadId: string, over: Partial<ToolContext> = {}): ToolContext => ({
    sql: appSql,
    runId: crypto.randomUUID(),
    runKind: 'reply',
    leadId,
    threadId: null,
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
    ...over,
  });

  const draft = async (ctx: ToolContext, body: string) => {
    const out = (await executeTool(ctx, `d-${++idem}`, 'draft_message', {
      leadId: ctx.leadId,
      channel: 'manual',
      body,
    })) as { message?: { id: string }; thread?: { id: string } };
    expect(out.message?.id).toBeTruthy();
    return { messageId: out.message!.id, threadId: out.thread!.id };
  };

  const control = async (method: string, path: string, body?: unknown, key?: string) => {
    const res = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl-ev',
        ...(method === 'GET' ? {} : { 'idempotency-key': key ?? `ev-${uniq}-${++idem}` }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const setGuardrails = (value: Record<string, unknown>) => sql`
    insert into control_settings (key, value) values ('guardrails', ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value
  `;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    prevGuardrails =
      (
        await sql<{ value: unknown }[]>`select value from control_settings where key = 'guardrails'`
      )[0]?.value ?? null;
    // other suites leave caps behind — this one runs on the defaults
    await setGuardrails({});
  });

  afterAll(async () => {
    await sql`
      delete from staff_events
      where data->>'leadId' = any(${leads})
         or data->>'runId' = any(${runs})
         or data->>'messageId' in (
           select m.id::text from lead_messages m join lead_threads t on t.id = m.thread_id
           where t.lead_id = any(${leads}::uuid[]))
    `;
    await sql`delete from meetings where lead_id = any(${leads}::uuid[])`;
    await sql`delete from agent_runs where id = any(${runs}::uuid[]) or lead_id = any(${leads}::uuid[])`;
    await sql`delete from leads where id = any(${leads}::uuid[])`;
    await sql`delete from provider_events where provider_id = ${`cmp-${uniq}`}`;
    if (prevGuardrails === null) await sql`delete from control_settings where key = 'guardrails'`;
    else await setGuardrails(prevGuardrails as Record<string, unknown>);
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('lead.created / lead.replied: inbound only, once per message', async () => {
    const digits = `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const from = `${digits}@s.whatsapp.net`;
    const first = (await addInboundMessage(appSql, {
      channel: 'whatsapp',
      from,
      fromName: `Carla ${uniq}`,
      body: 'oi, quero saber como funciona o cardápio online',
      providerMessageId: `in1-${uniq}`,
    }))!;
    leads.push(first.leadId);
    expect(first.leadCreated).toBe(true);
    const created = await events('lead.created', 'leadId', first.leadId);
    expect(created).toHaveLength(1);
    expect(created[0]!).toMatchObject({ tenant_id: null, anchor: null, severity: 'info' });
    expect(created[0]!.data).toEqual({
      leadId: first.leadId,
      leadName: `Carla ${uniq}`,
      business: null,
      channel: 'whatsapp',
      excerpt: 'oi, quero saber como funciona o cardápio online',
    });

    const reply = (await addInboundMessage(appSql, {
      channel: 'whatsapp',
      from,
      body: 'e quanto custa?',
      providerMessageId: `in2-${uniq}`,
    }))!;
    expect(reply.leadId).toBe(first.leadId);
    // a provider retry, the history import and the account's own echo add nothing
    await addInboundMessage(appSql, {
      channel: 'whatsapp',
      from,
      body: 'e quanto custa?',
      providerMessageId: `in2-${uniq}`,
    });
    await addInboundMessage(appSql, {
      channel: 'whatsapp',
      from,
      body: 'mensagem antiga',
      providerMessageId: `in3-${uniq}`,
      historical: true,
    });
    await addInboundMessage(appSql, {
      channel: 'whatsapp',
      from,
      body: 'respondi pelo celular',
      providerMessageId: `in4-${uniq}`,
      direction: 'out',
    });
    const replied = await events('lead.replied', 'leadId', first.leadId);
    expect(replied).toHaveLength(1);
    expect(replied[0]!).toMatchObject({
      tenant_id: null,
      anchor: null,
      dedupe_key: `lead.replied:${reply.messageId}`,
    });
    expect(replied[0]!.data).toEqual({
      leadId: first.leadId,
      leadName: `Carla ${uniq}`,
      business: null,
      channel: 'whatsapp',
      threadId: reply.threadId,
      messageId: reply.messageId,
      excerpt: 'e quanto custa?',
    });
    expect(await events('lead.created', 'leadId', first.leadId)).toHaveLength(1);
  });

  test('draft.pending for agent drafts only; approve and reject close the card', async () => {
    const leadId = await mkLead({ name: `Rascunho ${uniq}`, business_name: 'Padaria Sol' });
    const a = await draft(
      ctxFor(leadId),
      'oi, vi a padaria de vocês, posso te contar como funciona?',
    );
    const pending = await events('draft.pending', 'messageId', a.messageId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!).toMatchObject({ tenant_id: null, anchor: `draft:${a.messageId}` });
    expect(pending[0]!.data).toEqual({
      messageId: a.messageId,
      threadId: a.threadId,
      leadId,
      leadName: `Rascunho ${uniq}`,
      business: 'Padaria Sol',
      channel: 'manual',
      subject: null,
      body: 'oi, vi a padaria de vocês, posso te contar como funciona?',
    });

    const key = `approve-${uniq}`;
    await approveMessage(appSql, a.messageId, 'Maria', key);
    const replay = await approveMessage(appSql, a.messageId, 'Maria', key);
    expect(replay.replayed).toBe(true);
    const approved = await events('draft.resolved', 'messageId', a.messageId);
    expect(approved).toHaveLength(1);
    expect(approved[0]!).toMatchObject({ tenant_id: null, anchor: `draft:${a.messageId}` });
    expect(approved[0]!.data).toEqual({ messageId: a.messageId, outcome: 'approved', by: 'Maria' });

    const b = await draft(ctxFor(leadId), 'oi de novo, ficou alguma dúvida?');
    await rejectMessage(appSql, b.messageId, `reject-${uniq}`, 'João');
    expect((await events('draft.resolved', 'messageId', b.messageId))[0]!.data).toEqual({
      messageId: b.messageId,
      outcome: 'rejected',
      by: 'João',
    });
    // the CRM has no per-person identity: its route passes 'staff' (the card reads "no CRM")
    const c = await draft(ctxFor(leadId), 'posso te ligar amanhã?');
    expect((await control('POST', `/control/v1/messages/${c.messageId}/reject`)).status).toBe(200);
    expect((await events('draft.resolved', 'messageId', c.messageId))[0]!.data).toMatchObject({
      outcome: 'rejected',
      by: 'staff',
    });

    // a staff draft is the staff's own: no card opens, none closes
    const staff = await control('POST', `/control/v1/threads/${a.threadId}/messages`, {
      body: 'nota da equipe',
    });
    expect(staff.status).toBe(201);
    const staffId = staff.body.message.id as string;
    expect(await events('draft.pending', 'messageId', staffId)).toHaveLength(0);
    await rejectMessage(appSql, staffId, `reject-staff-${uniq}`, 'João');
    expect(await events('draft.resolved', 'messageId', staffId)).toHaveLength(0);
  });

  test('draft.resolved superseded: an expired draft regenerates, a lead reply retires it', async () => {
    const leadId = await mkLead({ name: `Expira ${uniq}`, agent_mode: 'auto' });
    const old = await draft(ctxFor(leadId), 'oi, tudo certo por aí?');
    await sql`update lead_messages set created_at = now() - interval '30 days' where id = ${old.messageId}`;
    const res = await approveMessage(appSql, old.messageId, 'Maria', `stale-${uniq}`);
    expect(res.body.stale).toBe(true);
    expect((await events('draft.resolved', 'messageId', old.messageId))[0]!.data).toEqual({
      messageId: old.messageId,
      outcome: 'superseded',
      by: null,
    });

    const digits = `55219${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const replier = await mkLead({
      name: `Responde ${uniq}`,
      whatsapp: `+${digits}`,
      whatsapp_verified: true,
      agent_mode: 'off',
    });
    const outreach = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId: replier,
      source: 'first_contact',
    }))!;
    runs.push(outreach);
    await sql`update agent_runs set status = 'done', finished_at = now() where id = ${outreach}`;
    const pendingDraft = await draft(
      ctxFor(replier, { runId: outreach, runKind: 'outreach' }),
      'oi, vi vocês no instagram e queria conversar',
    );
    await ingestInbound(appSql, {
      channel: 'whatsapp',
      from: `${digits}@s.whatsapp.net`,
      body: 'oi! me conta mais',
      providerMessageId: `sup-${uniq}`,
    });
    const [msg] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${pendingDraft.messageId}
    `;
    expect(msg!.status).toBe('rejected');
    const resolved = await events('draft.resolved', 'messageId', pendingDraft.messageId);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.data).toEqual({
      messageId: pendingDraft.messageId,
      outcome: 'superseded',
      by: null,
    });
    expect(await events('lead.replied', 'leadId', replier)).toHaveLength(1);
  });

  test('handoff.requested from request_human; handoff.resolved when the [humano] task closes', async () => {
    const leadId = await mkLead({ name: `Humano ${uniq}`, business_name: 'Doceria Lua' });
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    const ctx = ctxFor(leadId, { threadId: thread!.id });
    const reason = 'quer negociar desconto, precisa de alguém da equipe';
    await executeTool(ctx, 'h1', 'request_human', { leadId, reason });
    await executeTool(ctx, 'h1', 'request_human', { leadId, reason }); // replayed claim
    const [task] = await sql<{ id: string }[]>`
      select id from lead_tasks where lead_id = ${leadId} and title like '[humano]%'
    `;
    const requested = await events('handoff.requested', 'leadId', leadId);
    expect(requested).toHaveLength(1);
    expect(requested[0]!).toMatchObject({
      tenant_id: null,
      anchor: `handoff:${task!.id}`,
      severity: 'warning',
    });
    expect(requested[0]!.data).toEqual({
      taskId: task!.id,
      leadId,
      leadName: `Humano ${uniq}`,
      business: 'Doceria Lua',
      channel: 'whatsapp',
      threadId: thread!.id,
      reason,
    });

    // an unbound run hands the whole lead over
    const unbound = await mkLead({ name: `Humano2 ${uniq}` });
    await executeTool(ctxFor(unbound), 'h2', 'request_human', {
      leadId: unbound,
      reason: 'travou',
    });
    expect((await events('handoff.requested', 'leadId', unbound))[0]!.data).toMatchObject({
      channel: null,
      threadId: null,
      reason: 'travou',
    });

    await completeTask(appSql, task!.id, true, `done-${uniq}`, 'Ana');
    // reopened and closed again from the CRM: still one resolution
    expect((await control('PATCH', `/control/v1/tasks/${task!.id}`, { done: false })).status).toBe(
      200,
    );
    expect((await control('PATCH', `/control/v1/tasks/${task!.id}`, { done: true })).status).toBe(
      200,
    );
    const resolved = await events('handoff.resolved', 'taskId', task!.id);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!).toMatchObject({
      tenant_id: null,
      anchor: `handoff:${task!.id}`,
      dedupe_key: `handoff:${task!.id}:resolved`,
    });
    expect(resolved[0]!.data).toEqual({ taskId: task!.id, leadId, by: 'Ana' });

    // an ordinary task is not a handoff
    const [plain] = await sql<{ id: string }[]>`
      insert into lead_tasks (lead_id, title, created_by) values (${leadId}, 'ligar amanhã', 'staff')
      returning id
    `;
    await completeTask(appSql, plain!.id, true, `done-plain-${uniq}`, 'Ana');
    expect(await events('handoff.resolved', 'taskId', plain!.id)).toHaveLength(0);
  });

  test('lead.milestone on invited and live, once per lead and state', async () => {
    const leadId = await mkLead({ name: `Marco ${uniq}`, business_name: 'Empório Norte' });
    const key = `ms-${uniq}`;
    expect(
      (await control('PATCH', `/control/v1/leads/${leadId}`, { state: 'invited' }, key)).status,
    ).toBe(200);
    await control('PATCH', `/control/v1/leads/${leadId}`, { state: 'invited' }, key); // replay
    await control('PATCH', `/control/v1/leads/${leadId}`, { state: 'contacted' });
    await control('PATCH', `/control/v1/leads/${leadId}`, { state: 'invited' }); // flip-flop
    await control('PATCH', `/control/v1/leads/${leadId}`, { state: 'live' });
    const rows = await events('lead.milestone', 'leadId', leadId);
    expect(rows.map((r) => r.data)).toEqual([
      {
        leadId,
        leadName: `Marco ${uniq}`,
        business: 'Empório Norte',
        from: 'lead',
        to: 'invited',
        by: 'staff',
      },
      {
        leadId,
        leadName: `Marco ${uniq}`,
        business: 'Empório Norte',
        from: 'invited',
        to: 'live',
        by: 'staff',
      },
    ]);
    expect(rows.map((r) => r.dedupe_key)).toEqual([
      `milestone:${leadId}:invited`,
      `milestone:${leadId}:live`,
    ]);
    expect(rows.every((r) => r.tenant_id === null && r.anchor === null)).toBe(true);
  });

  test('lead.unsubscribed: by the agent and by a spam complaint, once', async () => {
    const leadId = await mkLead({ name: `Sair ${uniq}`, business_name: 'Bar do Zé' });
    const ctx = ctxFor(leadId);
    await executeTool(ctx, 'u1', 'unsubscribe', { leadId, reason: 'pediu para não receber mais' });
    await executeTool(ctx, 'u1', 'unsubscribe', { leadId, reason: 'pediu para não receber mais' });
    await executeTool(ctx, 'u2', 'unsubscribe', { leadId, reason: 'de novo' });
    const byAgent = await events('lead.unsubscribed', 'leadId', leadId);
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0]!).toMatchObject({ tenant_id: null, anchor: null });
    expect(byAgent[0]!.data).toEqual({
      leadId,
      leadName: `Sair ${uniq}`,
      business: 'Bar do Zé',
      by: 'agent',
      reason: 'pediu para não receber mais',
    });

    const addr = `queixa-${uniq}@example.test`;
    const complainer = await mkLead({ name: `Queixa ${uniq}`, email: addr });
    const rawKey = Buffer.from('vendua-test-webhook-key-32bytes!!!');
    const prevSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${rawKey.toString('base64')}`;
    try {
      const raw = JSON.stringify({
        type: 'email.complained',
        data: { email_id: `cmp-${uniq}`, to: [addr] },
      });
      const deliver = () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const id = `cmp-msg-${uniq}`;
        const sig = `v1,${createHmac('sha256', rawKey).update(`${id}.${ts}.${raw}`).digest('base64')}`;
        return ingestResendEvent(appSql, raw, { id, timestamp: ts, signature: sig });
      };
      expect(await deliver()).toMatchObject({ ok: true, leadId: complainer });
      await deliver(); // Resend retries
    } finally {
      if (prevSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = prevSecret;
    }
    const byComplaint = await events('lead.unsubscribed', 'leadId', complainer);
    expect(byComplaint).toHaveLength(1);
    expect(byComplaint[0]!.data).toEqual({
      leadId: complainer,
      leadName: `Queixa ${uniq}`,
      business: null,
      by: 'complaint',
      reason: null,
    });
  });

  test('meeting.booked / meeting.changed: link, lead cancel, staff book, reschedule, cancel', async () => {
    const pick = async (minAheadMs = 0) => {
      const { slots } = await availableSlots(sql, new Date());
      const slot = slots.find((s) => s.start.getTime() > Date.now() + minAheadMs);
      expect(slot).toBeTruthy();
      return slot!.start.toISOString();
    };

    // the public link: books, bumps the lead to invited, and the lead cancels it
    const viaLink = await mkLead({ name: `Call ${uniq}`, business_name: 'Café Bom' });
    const start = await pick(13 * 3600_000);
    const booked = await bookMeeting(appSql, { leadId: viaLink, start, source: 'link' });
    expect(booked.created).toBe(true);
    expect((await bookMeeting(appSql, { leadId: viaLink, start, source: 'link' })).created).toBe(
      false,
    );
    const meetingId = booked.meeting.id;
    const linkBooked = await events('meeting.booked', 'meetingId', meetingId);
    expect(linkBooked).toHaveLength(1);
    expect(linkBooked[0]!).toMatchObject({
      tenant_id: null,
      anchor: `meeting:${meetingId}`,
      severity: 'success',
    });
    expect(linkBooked[0]!.data).toEqual({
      meetingId,
      leadId: viaLink,
      leadName: `Call ${uniq}`,
      business: 'Café Bom',
      startsAt: start,
      source: 'link',
      roomUrl: null,
    });
    expect((await events('lead.milestone', 'leadId', viaLink)).map((r) => r.data)).toEqual([
      {
        leadId: viaLink,
        leadName: `Call ${uniq}`,
        business: 'Café Bom',
        from: 'lead',
        to: 'invited',
        by: 'system',
      },
    ]);
    await cancelByLead(appSql, viaLink, meetingId);
    await cancelByLead(appSql, viaLink, meetingId); // a retry replays the cancelled row
    const cancelled = await events('meeting.changed', 'meetingId', meetingId);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!).toMatchObject({ anchor: `meeting:${meetingId}`, severity: 'warning' });
    expect(cancelled[0]!.data).toEqual({
      meetingId,
      leadId: viaLink,
      leadName: `Call ${uniq}`,
      change: 'cancelled',
      by: 'lead',
      startsAt: start,
    });

    // staff: book (replayed), reschedule, cancel
    const viaStaff = await mkLead({ name: `Equipe ${uniq}` });
    const staffStart = await pick();
    const key = `book-${uniq}`;
    const made = await control(
      'POST',
      '/control/v1/meetings',
      { leadId: viaStaff, start: staffStart },
      key,
    );
    expect(made.status).toBe(201);
    await control('POST', '/control/v1/meetings', { leadId: viaStaff, start: staffStart }, key);
    const staffMeeting = made.body.meeting.id as string;
    const staffBooked = await events('meeting.booked', 'meetingId', staffMeeting);
    expect(staffBooked).toHaveLength(1);
    expect(staffBooked[0]!.data).toMatchObject({ source: 'staff', startsAt: staffStart });
    expect((await events('lead.milestone', 'leadId', viaStaff))[0]!.data).toMatchObject({
      to: 'invited',
      by: 'staff',
    });

    const newStart = await pick();
    expect(
      (await control('PATCH', `/control/v1/meetings/${staffMeeting}`, { startsAt: newStart }))
        .status,
    ).toBe(200);
    expect(
      (await control('PATCH', `/control/v1/meetings/${staffMeeting}`, { status: 'cancelled' }))
        .status,
    ).toBe(200);
    const changes = await events('meeting.changed', 'meetingId', staffMeeting);
    expect(changes.map((r) => [r.data, r.severity])).toEqual([
      [
        {
          meetingId: staffMeeting,
          leadId: viaStaff,
          leadName: `Equipe ${uniq}`,
          change: 'rescheduled',
          by: 'staff',
          startsAt: newStart,
        },
        'info',
      ],
      [
        {
          meetingId: staffMeeting,
          leadId: viaStaff,
          leadName: `Equipe ${uniq}`,
          change: 'cancelled',
          by: 'staff',
          startsAt: newStart,
        },
        'warning',
      ],
    ]);
  });

  test('agent.run_failed: a run that throws, and one that kept dying, each once', async () => {
    const leadId = await mkLead({ name: `Falha ${uniq}`, agent_mode: 'auto' });
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    runs.push(runId);
    // claimed ahead of whatever else is queued in this database
    await sql`update agent_runs set priority = -100 where id = ${runId}`;
    setTestProvider({
      name: 'boom',
      chat: async () => {
        throw new Error('provedor de LLM fora do ar');
      },
    });
    try {
      expect(await runOnce(appSql)).toBe(true);
    } finally {
      setTestProvider(null);
    }
    const [run] = await sql<{ status: string; error: string }[]>`
      select status, error from agent_runs where id = ${runId}
    `;
    expect(run!.status).toBe('failed');
    expect(run!.error).toContain('provedor de LLM fora do ar');
    const failed = await events('agent.run_failed', 'runId', runId);
    expect(failed).toHaveLength(1);
    expect(failed[0]!).toMatchObject({
      tenant_id: null,
      anchor: null,
      dedupe_key: `run:${runId}:failed`,
      severity: 'warning',
    });
    expect(failed[0]!.data).toEqual({
      runId,
      job: 'reply',
      leadId,
      leadName: `Falha ${uniq}`,
      error: run!.error,
      attempts: 1,
    });

    // a board-scoped run whose worker kept dying lands failed at the attempt cap
    const dead = (await enqueueRun(sql, { kind: 'outreach' }))!;
    runs.push(dead);
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`
      update agent_runs set status = 'running', claim_token = 'stale', started_at = ${stale},
        alive_at = ${stale}, max_attempts = 1
      where id = ${dead}
    `;
    await drain(appSql, 0, { orphans: false });
    await drain(appSql, 0, { orphans: false });
    const terminal = await events('agent.run_failed', 'runId', dead);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.data).toEqual({
      runId: dead,
      job: 'outreach',
      leadId: null,
      leadName: null,
      error: 'attempt cap reached — run kept dying mid-execution',
      attempts: 1,
    });
  });

  test('agent.cost_cap: once per lead and cap level', async () => {
    const leadId = await mkLead({ name: `Teto ${uniq}`, agent_mode: 'auto' });
    const spent = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    runs.push(spent);
    await sql`
      update agent_runs set status = 'done', finished_at = now(), cost_cents = 50 where id = ${spent}
    `;
    try {
      await setGuardrails({ leadLifetimeCostCapUsd: 0.1 });
      expect(await enqueueRun(appSql, { kind: 'outreach', leadId })).toBeNull();
      expect(await enqueueRun(appSql, { kind: 'outreach', leadId })).toBeNull();
      let rows = await events('agent.cost_cap', 'leadId', leadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!).toMatchObject({
        tenant_id: null,
        anchor: null,
        dedupe_key: `costcap:${leadId}:10`,
      });
      expect(rows[0]!.data).toEqual({
        leadId,
        leadName: `Teto ${uniq}`,
        spentCents: 50,
        capCents: 10,
      });
      // a raised cap that is still crossed flags again, at the new level
      await setGuardrails({ leadLifetimeCostCapUsd: 0.2 });
      expect(await enqueueRun(appSql, { kind: 'outreach', leadId })).toBeNull();
      rows = await events('agent.cost_cap', 'leadId', leadId);
      expect(rows.map((r) => r.data.capCents)).toEqual([10, 20]);
    } finally {
      await setGuardrails({});
    }
  });
});
