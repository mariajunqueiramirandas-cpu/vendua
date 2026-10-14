import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { ingestResendEvent } from '../src/crm/channels/email-inbound.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
import { ingestInbound } from '../src/crm/inbound.ts';
import { completeTask } from '../src/modules/activities.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { availableSlots, bookMeeting, cancelByLead } from '../src/modules/meetings.ts';
import { addInboundMessage, approveMessage, rejectMessage } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';
import { call, crmBench, OWNER_URL, say } from './crm-harness.ts';

// ADR 0023 — the CRM and the sales agent record staff events in the same tx as the change.
describe.skipIf(!OWNER_URL)('staff events: CRM + sales agent (db)', () => {
  const b = crmBench('staff-events');
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // TEST_APP_DATABASE_URL runs the code paths as vendua_app under RLS, as prod does
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({ sql: appSql, sessionSecret: 's', controlSecret: 'ctl-ev' });
  const uniq = crypto.randomUUID().slice(0, 8);
  const leads: string[] = [];
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

  // the agent's own draft: a lead turn writes it, as it does on the wire
  const draft = async (leadId: string, body: string) => {
    const { outcomes } = await b.runTools([['draft_message', { channel: 'manual', body }]], {
      leadId,
      kind: 'reply',
    });
    const out = outcomes[0] as {
      ok?: boolean;
      data?: { message?: { id: string }; thread?: { id: string } };
    };
    expect(out.ok).toBe(true);
    return { messageId: out.data!.message!.id, threadId: out.data!.thread!.id };
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

  beforeEach(() => b.mine.clear());
  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await b.setup();
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
         or data->>'messageId' in (
           select m.id::text from lead_messages m join lead_threads t on t.id = m.thread_id
           where t.lead_id = any(${leads}::uuid[]))
    `;
    await sql`delete from meetings where lead_id = any(${leads}::uuid[])`;
    await sql`delete from leads where id = any(${leads}::uuid[])`;
    await sql`delete from provider_events where provider_id = ${`cmp-${uniq}`}`;
    // the bench writes the agent and guardrails settings: restore ours after it
    await b.teardown();
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
    const a = await draft(leadId, 'oi, vi a padaria de vocês, posso te contar como funciona?');
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

    const second = await draft(leadId, 'oi de novo, ficou alguma dúvida?');
    await rejectMessage(appSql, second.messageId, `reject-${uniq}`, 'João');
    expect((await events('draft.resolved', 'messageId', second.messageId))[0]!.data).toEqual({
      messageId: second.messageId,
      outcome: 'rejected',
      by: 'João',
    });
    // the CRM has no per-person identity: its route passes 'staff' (the card reads "no CRM")
    const c = await draft(leadId, 'posso te ligar amanhã?');
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
    const old = await draft(leadId, 'oi, tudo certo por aí?');
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
      agent_mode: 'auto',
    });
    // the first contact drafts; only a draft of that turn is retired by the lead's reply. The
    // expired draft's regeneration is still queued: settle must not run it on this turn's script
    b.mine.clear();
    b.mine.add(replier);
    await controlTx(appSql, (tx) =>
      requestLeadTx(tx, {
        leadId: replier,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${replier}`,
      }),
    );
    const { rt } = b.runtime([
      call('draft_message', {
        channel: 'manual',
        body: 'oi, vi vocês no instagram e queria conversar',
      }),
      say('ok'),
    ]);
    await b.settle(rt);
    const [first] = await b.outbound(replier);
    expect(first!.status).toBe('draft');
    const pendingDraft = { messageId: first!.id };
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
    const reason = 'quer negociar desconto, precisa de alguém da equipe';
    const handed = await b.runTools([['request_human', { reason }]], {
      leadId,
      kind: 'reply',
      payload: { threadId: thread!.id },
    });
    expect(handed.outcomes[0]).toMatchObject({ name: 'request_human', ok: true });
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
    await b.runTools([['request_human', { reason: 'travou' }]], { leadId: unbound, kind: 'reply' });
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
    await b.runTools(
      [
        ['unsubscribe', { reason: 'pediu para não receber mais' }],
        ['unsubscribe', { reason: 'de novo' }],
      ],
      { leadId, kind: 'reply' },
    );
    // a later turn for an opted-out lead is parked: it files nothing and says nothing
    await b.runTools([['unsubscribe', { reason: 'de novo' }]], { leadId, kind: 'reply' });
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

    // reminders already sent for the old time must not suppress the new time's
    await sql`update meetings set reminder_24h_at = now(), reminder_1h_at = now() where id = ${staffMeeting}`;
    const newStart = await pick();
    expect(
      (await control('PATCH', `/control/v1/meetings/${staffMeeting}`, { startsAt: newStart }))
        .status,
    ).toBe(200);
    expect(
      (
        await sql`select reminder_24h_at, reminder_1h_at from meetings where id = ${staffMeeting}`
      )[0],
    ).toEqual({ reminder_24h_at: null, reminder_1h_at: null });
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

  test('agent.run_failed: a turn that keeps failing is reported once', async () => {
    await b.settings('autopilot');
    const l = await b.lead({ name: `Falha ${uniq}` });
    leads.push(l.id);
    await b.inbound(l.whatsapp!);
    const { rt } = b.runtime(() => ({ error: { status: 400, message: 'bad request' } }));
    // the store claims on the database clock: bring each retry's backoff forward
    for (let i = 0; i < 6; i++) {
      await b.settle(rt);
      await sql`
        update agent_actors set next_wake_at = now()
        where subject_id = ${l.id} and next_wake_at is not null`;
    }
    const [t] = await b.turns(l.id);
    expect(t).toMatchObject({ status: 'failed', kind: 'reply' });
    const failed = await events('agent.run_failed', 'runId', t!.turn_id);
    expect(failed).toHaveLength(1);
    expect(failed[0]!).toMatchObject({
      tenant_id: null,
      anchor: null,
      dedupe_key: `run:${t!.turn_id}:failed`,
      severity: 'warning',
    });
    expect(failed[0]!.data).toMatchObject({
      runId: t!.turn_id,
      job: 'reply',
      leadId: l.id,
      leadName: `Falha ${uniq}`,
    });
    expect(String(failed[0]!.data.error)).toMatch(/gave up after \d+ attempts/);
  });

  test('agent.cost_cap: once per lead and cap level', async () => {
    const leadId = await mkLead({ name: `Teto ${uniq}`, agent_mode: 'auto' });
    await sql`
      insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status, started_at, cost_cents)
      values (gen_random_uuid(), gen_random_uuid(), 'crm', 'reply', 'whatsapp', ${leadId}, 'done', now(), 50)`;
    try {
      await setGuardrails({ leadLifetimeCostCapUsd: 0.1 });
      // a capped lead's turn makes no model call
      const first = await b.runTools([], { leadId, kind: 'reply' });
      expect(first.requests).toBe(0);
      const second = await b.runTools([], { leadId, kind: 'reply' });
      expect(second.requests).toBe(0);
      // the two capped turns (the seeded row came first) say why they ran no model call
      expect((await b.turns(leadId)).slice(-2).map((t) => t.error?.includes('custo'))).toEqual([
        true,
        true,
      ]);
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
      expect((await b.runTools([], { leadId, kind: 'reply' })).requests).toBe(0);
      rows = await events('agent.cost_cap', 'leadId', leadId);
      expect(rows.map((r) => r.data.capCents)).toEqual([10, 20]);
    } finally {
      await setGuardrails({});
    }
  });
});
