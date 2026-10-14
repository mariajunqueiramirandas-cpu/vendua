import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { scheduleTimerTx } from '../src/crm/agenda.ts';
import { agentMetrics } from '../src/modules/agent-metrics.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { ensureThread } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';

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

  const seedTurn = async (opts: {
    kind: string;
    leadId?: string | null;
    status?: 'done' | 'failed';
    acted?: boolean;
    steps?: number;
    costCents?: number;
  }) => {
    // a second back: the DB clock's microseconds would put a row seeded in the window's last
    // millisecond past its JS-clock end
    await sql`
      insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status, started_at,
                             finished_at, steps, acted, cost_cents)
      values (gen_random_uuid(), gen_random_uuid(), 'crm', ${opts.kind}, 'staff',
              ${opts.leadId ?? null}, ${opts.status ?? 'done'}, now() - interval '1 second',
              now() - interval '1 second', ${opts.steps ?? 0}, ${opts.acted ?? false},
              ${opts.costCents ?? 0})`;
  };

  /** the CRM agent's agenda: timer rows of the lead actors */
  const timers = sql`
    select m.id from agent_mailbox m join agent_actors a on a.id = m.actor_id
    where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = 'crm' and m.kind like 'timer.%'`;

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

  // reset every metric source per test: sibling files leave rows behind
  const clean = async () => {
    await sql`delete from agent_mailbox where id in (${timers})`;
    await sql`delete from lead_messages`;
    await sql`delete from crm_turns`;
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

  test('byKind counts statuses and the acted rate over finished turns', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const { leadId } = await seedLead('Metrics Lead');
    await seedTurn({ kind: 'reply', leadId, acted: true, steps: 2 });
    await seedTurn({ kind: 'reply', leadId, acted: true, steps: 4 });
    await seedTurn({ kind: 'reply', leadId, acted: false, steps: 3 });
    // a failed turn counts as a run, never toward acted or the done-only average
    await seedTurn({ kind: 'reply', leadId, status: 'failed', steps: 9 });
    await seedTurn({ kind: 'outreach', leadId, acted: true, steps: 1, costCents: 250 });
    await seedTurn({ kind: 'discovery', status: 'failed', steps: 5 });
    const m = await agentMetrics(sql, 7);
    const reply = m.byKind.find((k) => k.kind === 'reply')!;
    expect(reply.runs).toBe(4);
    expect(reply.done).toBe(3);
    expect(reply.failed).toBe(1);
    expect(reply.canceled).toBe(0);
    expect(reply.actedRate).toBeCloseTo(2 / 3, 5);
    expect(reply.avgSteps).toBe(3);
    const outreach = m.byKind.find((k) => k.kind === 'outreach')!;
    expect(outreach.runs).toBe(1);
    expect(outreach.done).toBe(1);
    expect(outreach.actedRate).toBe(1);
    expect(outreach.costUsd).toBe(2.5);
    expect(outreach.avgCostUsd).toBe(2.5);
    const discovery = m.byKind.find((k) => k.kind === 'discovery')!;
    expect(discovery.runs).toBe(1);
    expect(discovery.done).toBe(0);
    expect(discovery.actedRate).toBe(0);
    expect(discovery.avgSteps).toBe(0);
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

  test('wakeups counts the pending agenda and dates that came due in the window', async () => {
    await migrate(sql, MIGRATIONS);
    await clean();
    const a = await seedLead('Agenda A');
    const b = await seedLead('Agenda B');
    const c = await seedLead('Agenda C');
    const d = await seedLead('Agenda D');
    const at = (ms: number) => new Date(Date.now() + ms);
    const book = (leadId: string, when: Date, by: 'agent' | 'staff') =>
      controlTx(sql, (tx) =>
        scheduleTimerTx(tx, { leadId, at: when, focus: 'retomar', requested: false, by }),
      );
    await book(a.leadId, at(60 * 60_000), 'agent');
    await book(b.leadId, at(86_400_000), 'staff');
    await book(c.leadId, at(60 * 60_000), 'agent');
    await book(d.leadId, at(60 * 60_000), 'agent');
    // C fired an hour ago; D fired 20 days ago (outside 7d, inside 30d)
    const fire = (leadId: string, ago: string) => sql`
      update agent_mailbox set consumed_by_turn = gen_random_uuid(),
        deliver_at = now() - ${ago}::interval
      where actor_id in (select id from agent_actors where subject_id = ${leadId})`;
    await fire(c.leadId, '1 hour');
    await fire(d.leadId, '20 days');
    const m = await agentMetrics(sql, 7);
    expect(m.wakeups).toEqual({ pending: 2, fired: 1 });
    const m30 = await agentMetrics(sql, 30);
    expect(m30.wakeups).toEqual({ pending: 2, fired: 2 });
  });
});
