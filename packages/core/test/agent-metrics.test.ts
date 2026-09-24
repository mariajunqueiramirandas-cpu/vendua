import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { agentMetrics } from '../src/modules/agent-metrics.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { ensureThread } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('agentMetrics (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');

  /** A lead + whatsapp thread so outbound/inbound messages have somewhere
   *  to live; returns ids the test composes messages/runs against. */
  const seedLead = async (name: string) => {
    const created = await controlTx(sql, (tx) => insertLeadTx(tx, { name, agent_mode: 'auto' }));
    const leadId = created.body.lead.id;
    const thread = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'whatsapp', {}));
    return { leadId, threadId: thread.id };
  };

  const seedRun = async (opts: {
    kind: string;
    leadId?: string | null;
    status?: string;
    steps?: unknown[];
    costCents?: number;
    createdAt?: Date;
  }) => {
    const rows = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, steps, cost_cents, created_at, finished_at)
      values (
        ${opts.kind}, ${opts.leadId ?? null}, ${opts.status ?? 'done'},
        ${sql.json((opts.steps ?? []) as never[])}, ${opts.costCents ?? 0},
        ${opts.createdAt ?? new Date()}, ${opts.status === 'queued' ? null : new Date()}
      )
      returning id`;
    return rows[0]!.id;
  };

  const seedMessage = async (opts: {
    threadId: string;
    direction: 'in' | 'out';
    status: string;
    author?: string;
    approvedBy?: string | null;
    historical?: boolean;
    createdAt?: Date;
  }) => {
    await sql`
      insert into lead_messages
        (thread_id, direction, author, body, status, approved_by, historical, created_at)
      values (
        ${opts.threadId}, ${opts.direction}, ${opts.author ?? 'agent'}, 'm',
        ${opts.status}, ${opts.approvedBy ?? null}, ${opts.historical ?? false},
        ${opts.createdAt ?? new Date()}
      )`;
  };

  // Every metric source must be reset per test: sibling files leave
  // agent_wakeups/agent_runs/lead_messages rows behind, and floating drains
  // from their ingest calls can claim or mint queued rows mid-test. Nothing
  // here seeds 'queued' — the only status foreign sweeps and drains touch.
  const clean = async () => {
    await sql`delete from agent_wakeups`;
    await sql`delete from lead_messages`;
    await sql`delete from agent_runs`;
  };

  test('empty window returns zeroed contract shape', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const m = await agentMetrics(sql, 7);
    expect(m.byKind.map((k) => k.kind)).toEqual([
      'triage',
      'reply',
      'outreach',
      'discovery',
      'strategist',
    ]);
    for (const k of m.byKind) {
      expect(k.runs).toBe(0);
      expect(k.actedRate).toBe(0);
      expect(k.costUsd).toBe(0);
    }
    expect(m.outbound).toEqual({ sent: 0, drafted: 0, approved: 0, rejected: 0 });
    expect(m.replies).toEqual({ leadsContacted: 0, leadsReplied: 0, replyRate: 0 });
    expect(m.wakeups).toEqual({ pending: 0, fired: 0 });
  });

  test('byKind counts statuses; actedRate mirrors runActed over the journal', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const { leadId } = await seedLead('Metrics Lead');
    const actedSteps = [
      { type: 'model', content: 'ok', toolCalls: [] },
      {
        type: 'tool',
        name: 'send_message',
        args: { leadId, body: 'oi' },
        out: { message: { id: 'm1', status: 'sent' } },
      },
    ];
    const noisySteps = [
      // error'd / blocked / ignored results and pending entries never count
      { type: 'tool', name: 'send_message', args: {}, out: { blocked: true } },
      { type: 'tool', name: 'update_lead', args: {}, out: { ignored: true } },
      { type: 'tool', name: 'create_task', args: {}, out: { error: 'boom' } },
      { type: 'tool', name: 'send_message', args: {}, pending: true },
      // read tools don't count even when clean
      { type: 'tool', name: 'web_search', args: {}, out: { results: [] } },
    ];
    await seedRun({ kind: 'reply', leadId, steps: actedSteps });
    await seedRun({ kind: 'reply', leadId, steps: actedSteps });
    await seedRun({ kind: 'reply', leadId, steps: noisySteps });
    await seedRun({ kind: 'reply', leadId, status: 'failed' });
    await seedRun({ kind: 'reply', leadId, status: 'canceled' });
    await seedRun({ kind: 'outreach', leadId, steps: actedSteps, costCents: 250 });
    // 'canceled' — not 'queued': queued rows are fair game to every other
    // file's sweep/delete and to stray drains surviving file boundaries.
    await seedRun({ kind: 'discovery', steps: actedSteps, status: 'canceled' });
    const m = await agentMetrics(sql, 7);
    const reply = m.byKind.find((k) => k.kind === 'reply')!;
    expect(reply.runs).toBe(5);
    expect(reply.done).toBe(3);
    expect(reply.failed).toBe(1);
    expect(reply.canceled).toBe(1);
    expect(reply.actedRate).toBeCloseTo(2 / 3, 5);
    const outreach = m.byKind.find((k) => k.kind === 'outreach')!;
    expect(outreach.runs).toBe(1);
    expect(outreach.done).toBe(1);
    expect(outreach.actedRate).toBe(1);
    expect(outreach.costUsd).toBe(2.5);
    expect(outreach.avgCostUsd).toBe(2.5);
    const discovery = m.byKind.find((k) => k.kind === 'discovery')!;
    expect(discovery.runs).toBe(1);
    expect(discovery.done).toBe(0);
    expect(discovery.canceled).toBe(1);
    expect(discovery.actedRate).toBe(0);
    // non-done rows don't drag the done-only average either
    expect(discovery.avgSteps).toBe(0);
    expect(reply.avgSteps).toBe(3);
  });

  test('outbound and replies read lead_messages, windowed', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const a = await seedLead('Replier A');
    const b = await seedLead('Replier B');
    const c = await seedLead('Early Writer');
    const stale = new Date(Date.now() - 20 * 86_400_000);
    // A: contacted and replied — counts on both sides. Explicit offsets make
    // the reply order deterministic (future timestamps fall outside `to`).
    await seedMessage({
      threadId: a.threadId,
      direction: 'out',
      status: 'sent',
      createdAt: new Date(Date.now() - 10_000),
    });
    await seedMessage({
      threadId: a.threadId,
      direction: 'in',
      status: 'received',
      createdAt: new Date(Date.now() - 5_000),
    });
    // B: contacted twice, never replied; a draft pending and one rejected
    await seedMessage({ threadId: b.threadId, direction: 'out', status: 'delivered' });
    await seedMessage({ threadId: b.threadId, direction: 'out', status: 'sent' });
    await seedMessage({ threadId: b.threadId, direction: 'out', status: 'draft' });
    await seedMessage({
      threadId: b.threadId,
      direction: 'out',
      status: 'sent',
      approvedBy: 'staff',
    });
    await seedMessage({ threadId: b.threadId, direction: 'out', status: 'rejected' });
    // C: wrote BEFORE the agent's first send — contacted, but the inbound
    // can't be credited as a reply (it answers nothing)
    await seedMessage({
      threadId: c.threadId,
      direction: 'in',
      status: 'received',
      createdAt: new Date(Date.now() - 10_000),
    });
    await seedMessage({
      threadId: c.threadId,
      direction: 'out',
      status: 'sent',
      createdAt: new Date(Date.now() - 5_000),
    });
    // staff-authored and historical-inbound rows never enter agent metrics
    await seedMessage({ threadId: a.threadId, direction: 'out', status: 'sent', author: 'staff' });
    await seedMessage({
      threadId: b.threadId,
      direction: 'in',
      status: 'received',
      historical: true,
    });
    // outside the 7d window — invisible here, counted by days=30
    await seedMessage({
      threadId: a.threadId,
      direction: 'out',
      status: 'sent',
      createdAt: stale,
    });
    const m = await agentMetrics(sql, 7);
    expect(m.outbound).toEqual({ sent: 5, drafted: 1, approved: 1, rejected: 1 });
    // C contacted but its only inbound predates the send — not a reply
    expect(m.replies).toEqual({ leadsContacted: 3, leadsReplied: 1, replyRate: 1 / 3 });
    const m30 = await agentMetrics(sql, 30);
    expect(m30.outbound.sent).toBe(6);
  });

  test('wakeups counts pending backlog and fired-in-window', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const stale = new Date(Date.now() - 20 * 86_400_000);
    await sql`
      insert into agent_wakeups (kind, at, focus, status, created_by)
      values
        ('reply', now(), 'follow up', 'pending', 'agent'),
        ('outreach', now() + interval '1 day', 'retry', 'pending', 'staff'),
        ('reply', now(), 'follow up', 'fired', 'agent'),
        ('reply', ${stale}, 'old fire', 'fired', 'agent'),
        ('outreach', now(), 'gave up', 'canceled', 'staff')`;
    // A wakeup scheduled long ago that only fired now attributes to the
    // firing run's created_at, not the requested `at`.
    const firedRun = await seedRun({ kind: 'outreach' });
    await sql`
      insert into agent_wakeups (kind, at, focus, status, created_by, fired_run_id)
      values ('reply', ${stale}, 'late fire', 'fired', 'agent', ${firedRun})`;
    const m = await agentMetrics(sql, 7);
    expect(m.wakeups).toEqual({ pending: 2, fired: 2 });
    const m30 = await agentMetrics(sql, 30);
    expect(m30.wakeups).toEqual({ pending: 2, fired: 3 });
  });
});
