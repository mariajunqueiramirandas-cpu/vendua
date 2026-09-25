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

  // lead + whatsapp thread so messages/runs have somewhere to live
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
    approvedAt?: Date | null;
    dispatchAttemptedAt?: Date | null;
    updatedAt?: Date | null;
    historical?: boolean;
    createdAt?: Date;
  }) => {
    await sql`
      insert into lead_messages
        (thread_id, direction, author, body, status, approved_by, approved_at,
         dispatch_attempted_at, updated_at, historical, created_at)
      values (
        ${opts.threadId}, ${opts.direction}, ${opts.author ?? 'agent'}, 'm',
        ${opts.status}, ${opts.approvedBy ?? null}, ${opts.approvedAt ?? null},
        ${opts.dispatchAttemptedAt ?? null}, ${opts.updatedAt ?? new Date()},
        ${opts.historical ?? false}, ${opts.createdAt ?? new Date()}
      )`;
  };

  // reset every metric source per test: sibling files' leftover rows and stray
  // drains can touch 'queued' — nothing here seeds it
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
    // 'canceled', not 'queued': queued rows are fair game to other files' sweeps/drains
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
    // A: contacted and replied — counts both sides; explicit offsets make order deterministic
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
    // C: wrote BEFORE the first send — contacted, but the inbound can't be credited as a reply
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

  test('outbound attributes each event to its own timestamp — compose, approve, dispatch, reject', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const a = await seedLead('Late Approve A');
    const b = await seedLead('Late Approve B');
    const stale = new Date(Date.now() - 20 * 86_400_000);
    // composed 20d ago, approved+dispatched today — each aggregate lands in its event's window
    await seedMessage({
      threadId: a.threadId,
      direction: 'out',
      status: 'sent',
      approvedBy: 'staff',
      approvedAt: new Date(),
      dispatchAttemptedAt: new Date(),
      createdAt: stale,
    });
    // composed 20d ago, rejected today — rejected counts on rejection day
    await seedMessage({
      threadId: b.threadId,
      direction: 'out',
      status: 'rejected',
      createdAt: stale,
      updatedAt: new Date(),
    });
    // draft composed in-window stays on compose time for 'drafted'
    await seedMessage({ threadId: b.threadId, direction: 'out', status: 'draft' });
    const m = await agentMetrics(sql, 7);
    expect(m.outbound).toEqual({ sent: 1, drafted: 1, approved: 1, rejected: 1 });
    // the delayed send also counts as contact inside the window
    expect(m.replies.leadsContacted).toBe(1);
    // 30d window sees the same rows once
    const m30 = await agentMetrics(sql, 30);
    expect(m30.outbound.sent).toBe(1);
    expect(m30.outbound.approved).toBe(1);
  });

  test('wakeups counts pending backlog and fired-in-window', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const stale = new Date(Date.now() - 20 * 86_400_000);
    await sql`
      insert into agent_wakeups (kind, at, focus, status, created_by, fired_at)
      values
        ('reply', now(), 'follow up', 'pending', 'agent', null),
        ('outreach', now() + interval '1 day', 'retry', 'pending', 'staff', null),
        -- fired_at an hour inside the window: bare now() races the to-boundary under clock skew
        ('reply', now(), 'follow up', 'fired', 'agent', now() - interval '1 hour'),
        ('reply', ${stale}, 'old fire', 'fired', 'agent', ${stale}),
        ('outreach', now(), 'gave up', 'canceled', 'staff', null)`;
    // a wakeup scheduled long ago but fired now attributes to fired_at
    const firedRun = await seedRun({ kind: 'outreach' });
    await sql`
      insert into agent_wakeups (kind, at, focus, status, created_by, fired_run_id, fired_at)
      values ('reply', ${stale}, 'late fire', 'fired', 'agent', ${firedRun}, now() - interval '1 hour')`;
    // a post-fire cancellation bumps updated_at but must not move the metric
    await sql`update agent_wakeups set updated_at = now() + interval '1 day' where focus = 'follow up' and status = 'fired'`;
    const m = await agentMetrics(sql, 7);
    expect(m.wakeups).toEqual({ pending: 2, fired: 2 });
    const m30 = await agentMetrics(sql, 30);
    expect(m30.wakeups).toEqual({ pending: 2, fired: 3 });
  });
});
