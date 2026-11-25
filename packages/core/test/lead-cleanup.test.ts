import { afterAll, describe, expect, test } from 'bun:test';
import { ZERO_USAGE, type ModelGateway } from '@vendua/agent-runtime';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { pendingWakeupsTx, scheduleTimerTx } from '../src/crm/agenda.ts';
import { controlTx } from '../src/modules/control.ts';
import type { SendChannel } from '../src/modules/threads.ts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('CRM lead cleanup', () => {
  const ownerUrl = process.env.TEST_DATABASE_URL!;
  const sql = postgres(ownerUrl);
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      ownerUrl?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
  );
  const created: string[] = [];
  const after = (days: number) => new Date(Date.now() + days * 86_400_000);

  afterAll(async () => {
    await sql`delete from agent_actors where agent_id = 'crm' and subject_id = any(${created}::text[])`;
    await sql`delete from leads where id = any(${created}::uuid[])`;
    await sql.end();
    await appSql.end();
  });

  async function prospect(
    name: string,
    options: {
      age?: number;
      seen?: boolean;
      scheduled?: boolean;
      callback?: boolean;
      channel?: SendChannel;
    } = {},
  ) {
    const [lead] = await sql<
      { id: string }[]
    >`insert into leads (name) values (${name}) returning id`;
    const leadId = lead!.id;
    created.push(leadId);
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, ${options.channel ?? 'instagram'}) returning id`;
    const threadId = thread!.id;
    const [message] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, status, body, created_at, seen_at)
      values (${threadId}, 'out', 'agent', 'sent', ${name}, ${after(-(options.age ?? 30))}, ${options.seen ? after(-20) : null})
      returning id`;
    if (options.scheduled !== false) {
      await controlTx(appSql, async (tx) => {
        await scheduleTimerTx(tx, {
          leadId,
          at: after(2),
          focus: 'follow-up',
          requested: false,
          by: 'agent',
        });
        if (options.callback)
          await scheduleTimerTx(tx, {
            leadId,
            at: after(3),
            focus: 'promessa',
            requested: true,
            by: 'agent',
          });
      });
    }
    return { leadId, threadId, lastMessageId: message!.id };
  }

  const post = (
    app: ReturnType<typeof createApp>,
    action: string,
    body: unknown,
    key = crypto.randomUUID(),
  ) =>
    app.request(`/control/v1/leads/cleanup/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });

  test('reviews all outreach channels and archives stale leads with cross-channel safeguards', async () => {
    const cold = await prospect('mensagens repetitivas', { channel: 'whatsapp', seen: true });
    const stale = await prospect('conversa que vai mudar');
    const callback = await prospect('retorno combinado', { callback: true });
    const recent = await prospect('conversa recente', { age: 1 });
    const unscheduled = await prospect('sem follow-up', { scheduled: false });
    const queued = await prospect('com resposta automática');
    const multi = await prospect('primeira conversa no Instagram, última por email');
    const [email] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${multi.leadId}, 'email') returning id`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${email!.id}, 'out', 'agent', 'email sem resposta', 'delivered', ${after(-18)})`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status, auto_reply)
      values (${queued.threadId}, 'in', 'lead', 'Mensagem automática de ausência', 'received', true)`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status)
      values (${cold.threadId}, 'out', 'agent', 'rascunho antigo', 'draft'),
             (${cold.threadId}, 'out', 'agent', 'envio planejado', 'queued')`;
    const gateway: ModelGateway = {
      async generate(req) {
        expect(req.tools).toEqual([]);
        const request = req.messages[0];
        const part = request?.role === 'user' ? request.parts[0] : undefined;
        if (part?.type !== 'text') throw new Error('expected evidence text');
        const input = JSON.parse(part.text) as {
          focus: string;
          leads: { index: number; seen: string }[];
        };
        expect(input.focus).toBe('priorize repetição');
        return {
          text: JSON.stringify({
            reviews: input.leads.map(({ index, seen }) => ({
              index,
              decision: seen === 'confirmed' ? 'archive' : 'keep',
              reason: 'revisão de teste',
            })),
          }),
          toolCalls: [],
          finish: 'stop',
          usage: ZERO_USAGE,
          model: 'test',
          provider: 'scripted',
          latencyMs: 0,
        };
      },
    };
    const app = createApp({
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      duaMedia: { media: null, gateway },
    });
    const filter = { minDays: 14, scheduledOnly: true };
    const res = await post(app, 'review', { ...filter, criteria: 'priorize repetição' });
    expect(res.status).toBe(200);
    const { leads } = (await res.json()) as {
      leads: { leadId: string; lastMessageId: string; version: string }[];
    };
    expect(leads.find((l) => l.leadId === cold.leadId)).toMatchObject({
      channel: 'whatsapp',
      seen: true,
      hadHumanReply: false,
      recommendation: { decision: 'archive', reason: 'revisão de teste' },
    });
    expect(leads.find((l) => l.leadId === queued.leadId)).toMatchObject({
      channel: 'instagram',
      hadHumanReply: false,
    });
    expect(leads.find((l) => l.leadId === multi.leadId)).toMatchObject({
      channel: 'email',
      threadId: email!.id,
      lastOutboundStatus: 'delivered',
      seen: false,
    });
    expect(leads.map((l) => l.leadId)).not.toContain(callback.leadId);
    expect(leads.map((l) => l.leadId)).not.toContain(recent.leadId);
    expect(leads.map((l) => l.leadId)).not.toContain(unscheduled.leadId);
    const instagramOnly = await post(app, 'review', {
      ...filter,
      channel: 'instagram',
      criteria: 'priorize repetição',
    });
    expect(instagramOnly.status).toBe(200);
    const instagram = (await instagramOnly.json()) as {
      leads: { leadId: string; channel: string }[];
    };
    expect(instagram.leads.map((l) => l.leadId)).toContain(queued.leadId);
    expect(instagram.leads.map((l) => l.leadId)).not.toContain(multi.leadId);
    expect(instagram.leads.every((l) => l.channel === 'instagram')).toBe(true);
    expect((await post(app, 'review', { ...filter, channel: 'manual' })).status).toBe(422);

    // The prospect replies on another channel while the review is open.
    const [wa] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${stale.leadId}, 'whatsapp') returning id`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status)
      values (${wa!.id}, 'in', 'lead', 'Oi, vamos conversar?', 'received')`;
    const picked = new Set([cold.leadId, stale.leadId, multi.leadId]);
    const archiveBody = { ...filter, leads: leads.filter((l) => picked.has(l.leadId)) };
    const key = crypto.randomUUID();
    const action = await post(app, 'archive', archiveBody, key);
    expect(action.status).toBe(200);
    expect(await action.json()).toEqual({
      archived: [cold.leadId, multi.leadId].sort(),
      skipped: [stale.leadId],
    });
    const replay = await post(app, 'archive', archiveBody, key);
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    expect(
      (await sql`select archived_at, next_action_at from leads where id = ${cold.leadId}`)[0],
    ).toMatchObject({ archived_at: expect.any(Date), next_action_at: null });
    const reschedule = await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: cold.leadId,
        at: after(5),
        focus: 'nova tentativa',
        requested: false,
        by: 'agent',
      }),
    );
    expect(reschedule).toEqual({ error: 'lead arquivado' });
    expect(await controlTx(appSql, (tx) => pendingWakeupsTx(tx, cold.leadId))).toEqual([]);
    const messages = await sql<
      { status: string }[]
    >`select status from lead_messages where thread_id = ${cold.threadId} order by status`;
    expect(messages.map((m) => m.status)).toEqual(['rejected', 'rejected', 'sent']);
  });
});
