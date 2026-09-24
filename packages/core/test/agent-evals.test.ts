import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { drain, enqueueRun } from '../src/agent/runner.ts';
import { scriptedProvider, type ScriptedProvider } from '../src/agent/scripted-provider.ts';
import { setTestProvider } from '../src/agent/llm.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, upsertIntegration } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

/**
 * Golden evals — the real pipeline (ingestInbound → drain → runOnce → tools
 * → dispatch) driven by a scripted provider instead of a paid model. Every
 * send goes through the dev `log` channel driver, so nothing leaves the
 * box and nothing costs a cent. CI runs these via plain `bun test`; the
 * live harness (`bun run sim`) stays manual.
 */

// Pure-provider contract — no DB needed, runs everywhere.
describe('scriptedProvider — replay and record', () => {
  test('replays turns in order and records each request', async () => {
    const p = scriptedProvider([
      { text: 'primeiro' },
      { toolCalls: [{ name: 'send_message', args: { leadId: 'L', body: 'oi' } }] },
      { text: 'fim', tokensIn: 10, tokensOut: 5 },
    ]);
    const r1 = await p.chat({
      system: 'sys',
      messages: [{ role: 'user', content: 'a' }],
      tools: [],
    });
    expect(r1.text).toBe('primeiro');
    expect(r1.toolCalls).toEqual([]);
    const r2 = await p.chat({
      system: 'sys',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'primeiro', toolCalls: r1.toolCalls },
      ],
      tools: [{ name: 'send_message', description: 'd', parameters: {} }],
    });
    expect(r2.toolCalls).toEqual([
      { id: 'scripted-2-0', name: 'send_message', args: { leadId: 'L', body: 'oi' } },
    ]);
    const r3 = await p.chat({ system: 'sys', messages: [], tools: [] });
    expect(r3.tokensIn).toBe(10);
    // past the end: a benign 'ok' so an over-run finishes instead of throwing
    const r4 = await p.chat({ system: 'sys', messages: [], tools: [] });
    expect(r4.text).toBe('ok');
    expect(p.turns).toBe(4);
    expect(p.requests).toHaveLength(4);
    expect(p.requests[0]!.messages).toHaveLength(1);
    expect(p.requests[1]!.messages).toHaveLength(2);
    expect(p.requests[1]!.tools[0]!.name).toBe('send_message');
  });

  test('requests snapshot the messages array — later pushes don’t rewrite history', async () => {
    const p = scriptedProvider([{ text: 'a' }, { text: 'b' }]);
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: 'oi' },
    ];
    await p.chat({ system: 's', messages, tools: [] });
    messages.push({ role: 'assistant', content: 'a' });
    await p.chat({ system: 's', messages, tools: [] });
    expect(p.requests[0]!.messages).toHaveLength(1);
    expect(p.requests[1]!.messages).toHaveLength(2);
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('agent evals — golden runs (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const PHONE = () => `+5511${Math.floor(9_0000_0000 + Math.random() * 9999_999)}`;

  const seedChannel = async () => {
    await upsertIntegration(
      sql,
      { kind: 'whatsapp', driver: 'log', enabled: true },
      `eval:${crypto.randomUUID()}`,
    );
  };

  /** Guardrails with the sim-cli trick: quiet hours 00:00→00:00 = never
   *  quiet, plus the per-scenario override. */
  const seedGuardrails = async (patch: Record<string, unknown> = {}) =>
    sql`insert into control_settings (key, value)
        values ('guardrails', ${sql.json({ ...DEFAULT_GUARDRAILS, quietStart: '00:00', quietEnd: '00:00', ...patch } as never)})
        on conflict (key) do update set value = excluded.value`;

  const seedLead = async (whatsapp: string, fields: Record<string, unknown> = {}) => {
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Eval Lead', agent_mode: 'auto', whatsapp, ...fields }),
    );
    return created.body.lead.id;
  };

  /** Park leftovers from earlier tests so drain only picks up ours. */
  const cancelQueued = async () =>
    sql`update agent_runs set status = 'canceled' where status = 'queued'`;

  /** Drive a scripted inbound → drain until the run reaches a terminal
   *  status; returns the finished run row. */
  const runInbound = async (provider: ScriptedProvider, whatsapp: string, pmid: string) => {
    setTestProvider(provider);
    try {
      const res = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: whatsapp,
        body: 'oi — quero saber do plano',
        providerMessageId: pmid,
      });
      if ('ignored' in res) throw new Error(`inbound ignored: ${res.ignored}`);
      // ingest kicks a floating drain; ours waits on the row — either way
      // the run ends terminal before this returns.
      await drain(sql);
      const deadline = Date.now() + 15_000;
      for (;;) {
        const run = (
          await sql<{ id: string; status: string; steps: unknown[]; error: string | null }[]>`
            select id, status, steps, error from agent_runs
            where lead_id = ${res.leadId} order by created_at desc limit 1`
        )[0];
        if (run && ['done', 'failed', 'canceled'].includes(run.status)) return { res, run };
        if (Date.now() > deadline) throw new Error('run never reached a terminal status');
        await new Promise((r) => setTimeout(r, 40));
        await drain(sql);
      }
    } finally {
      setTestProvider(null);
    }
  };

  const outbound = (leadId: string) =>
    sql<{ status: string; body: string; is_farewell: boolean; error: string | null }[]>`
      select m.status, m.body, m.is_farewell, m.error from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and m.direction = 'out' and m.author = 'agent'
      order by m.created_at`;

  test('inbound reply — scripted send_message lands as sent on the log channel', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails({ firstContactDraftOnly: false });
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const p = scriptedProvider([
      {
        toolCalls: [
          { name: 'send_message', args: { leadId, body: 'Oi! Posso te ajudar com isso.' } },
        ],
      },
      { text: 'respondido.' },
    ]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    const msgs = await outbound(leadId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe('sent');
    expect(msgs[0]!.body).toContain('Posso te ajudar');
    // the runner fed the tool result back — the closing turn saw it
    const last = p.requests.at(-1)!;
    expect(last.messages.some((m) => m.role === 'tool' && m.name === 'send_message')).toBe(true);
  });

  test('firstContactDraftOnly forces the first outbound into the approvals queue', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails({ firstContactDraftOnly: true });
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const p = scriptedProvider([
      { toolCalls: [{ name: 'send_message', args: { leadId, body: 'Primeira mensagem.' } }] },
      { text: 'drafted.' },
    ]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    const msgs = await outbound(leadId);
    expect(msgs).toHaveLength(1);
    // landed for review, not on the wire — and the run still counts as acted
    expect(msgs[0]!.status).toBe('draft');
    const lead = (await sql<{ state: string }[]>`select state from leads where id = ${leadId}`)[0]!;
    expect(lead.state).toBe('lead');
  });

  test('unsubscribe intent suppresses the lead; later runs are refused', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails();
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const p = scriptedProvider([
      {
        toolCalls: [
          { name: 'unsubscribe', args: { leadId, reason: 'pediu para sair', reply: 'Tudo bem!' } },
        ],
      },
      { text: 'feito.' },
    ]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    const lead = (
      await sql<{ unsubscribed_at: string | null }[]>`
        select unsubscribed_at from leads where id = ${leadId}`
    )[0]!;
    expect(lead.unsubscribed_at).not.toBeNull();
    const msgs = await outbound(leadId);
    expect(msgs.some((m) => m.is_farewell && m.status === 'sent')).toBe(true);
    // a fresh run never reaches the pipeline — insert is fine (only the cap
    // refuses there), so it parks queued until drain cancels it
    const nextId = await enqueueRun(sql, { kind: 'outreach', leadId });
    expect(nextId).not.toBeNull();
    await drain(sql);
    const next = (
      await sql<{ status: string; error: string | null }[]>`
        select status, error from agent_runs where id = ${nextId!}`
    )[0]!;
    expect(next.status).toBe('canceled');
    expect(next.error).toBe('descadastrado');
    // and a new inbound doesn't mint another reply run
    const before = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from agent_runs where lead_id = ${leadId} and kind = 'reply'`
    )[0]!.n;
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from: wa,
      body: 'oi de novo',
      providerMessageId: `eval:${crypto.randomUUID()}`,
    });
    const after = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from agent_runs where lead_id = ${leadId} and kind = 'reply'`
    )[0]!.n;
    expect(after).toBe(before);
  });

  test('loop guard suppresses an identical repeated send — only one lands', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails({ firstContactDraftOnly: false });
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const call = { name: 'send_message', args: { leadId, body: 'Mesmo texto, de novo.' } };
    const p = scriptedProvider([{ toolCalls: [call] }, { toolCalls: [call] }, { text: 'pronto.' }]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    const msgs = await outbound(leadId);
    expect(msgs).toHaveLength(1);
    const steps = run.steps as { type?: string; name?: string; out?: { error?: string } }[];
    const repeat = steps.find(
      (s) => s.type === 'tool' && s.name === 'send_message' && s.out?.error,
    );
    expect(repeat?.out?.error).toContain('REPEAT');
  });

  test('finish gate nudges a reply run that tries to end without acting', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails({ firstContactDraftOnly: false });
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const p = scriptedProvider([
      { text: 'Hmm, deixa eu olhar o contexto.' },
      { toolCalls: [{ name: 'send_message', args: { leadId, body: 'Achei — aqui está.' } }] },
      { text: 'feito.' },
    ]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    // the nudge was journaled AND fed back to the next request
    const steps = run.steps as { type?: string; text?: string }[];
    expect(steps.some((s) => s.type === 'nudge')).toBe(true);
    const second = p.requests[1]!;
    const lastMsg = second.messages.at(-1)!;
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.role === 'user' ? lastMsg.content : '').toContain('Ação pendente');
    const msgs = await outbound(leadId);
    expect(msgs[0]!.status).toBe('sent');
  });

  test('cost cap refuses the next run once a lead crosses its lifetime spend', async () => {
    await migrate(sql, MIGRATIONS);
    await cancelQueued();
    await seedChannel();
    await seedGuardrails({ firstContactDraftOnly: false, leadLifetimeCostCapUsd: 0.05 });
    const wa = PHONE();
    const leadId = await seedLead(wa);
    const p = scriptedProvider([
      {
        toolCalls: [{ name: 'send_message', args: { leadId, body: 'Custa caro essa resposta.' } }],
        costUsd: 0.06,
      },
      { text: 'feito.' },
    ]);
    const { run } = await runInbound(p, wa, `eval:${crypto.randomUUID()}`);
    expect(run.status).toBe('done');
    // finishRun's cap check already flags: 'cost-cap' activity + [humano] task
    const flag = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from lead_activities
        where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'`
    )[0]!.n;
    expect(flag).toBe(1);
    const task = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from lead_tasks
        where lead_id = ${leadId} and title like '[humano]%'`
    )[0]!.n;
    expect(task).toBe(1);
    // and the cap now refuses new runs outright
    expect(await enqueueRun(sql, { kind: 'reply', leadId })).toBeNull();
    expect(await enqueueRun(sql, { kind: 'outreach', leadId })).toBeNull();
  });
});
