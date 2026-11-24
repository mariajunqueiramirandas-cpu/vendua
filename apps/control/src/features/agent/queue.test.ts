// @ts-nocheck -- apps/control has no @types/bun, and its tsc includes every .ts; run with `bun test`
import { describe, expect, test } from 'bun:test';
import type { AgentRun, LeadListItem, Wakeup } from '@/lib/api.ts';
import { buildQueue, dedupeLeadSchedule } from './queue.ts';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const LATER = '2026-11-24T14:00:00.000Z';
const SOONER = '2026-11-24T12:30:00.000Z';

function makeLead(overrides: Partial<LeadListItem> = {}): LeadListItem {
  return {
    id: 'lead-1',
    name: 'Maria',
    tenantId: null,
    businessName: 'Doceria Maria',
    phone: null,
    whatsapp: '+5585999990000',
    whatsappVerified: true,
    email: null,
    instagram: null,
    website: null,
    city: 'Fortaleza',
    segment: 'doceria',
    source: 'whatsapp',
    owner: null,
    tags: [],
    dealValueCents: null,
    state: 'contacted',
    agentMode: 'auto',
    agentGoal: 'negotiation',
    agentPlan: [],
    fitScore: 9,
    fitReason: null,
    intentScore: null,
    intentReason: null,
    emailBouncedAt: null,
    nextActionAt: null,
    lostReason: null,
    archivedAt: null,
    unsubscribedAt: null,
    agentPausedAt: null,
    discoveredVia: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    score: 80,
    openTasks: 0,
    overdueTasks: 0,
    pendingDrafts: 0,
    lastActivityAt: null,
    ...overrides,
  };
}

function makeWakeup(overrides: Partial<Wakeup> = {}): Wakeup {
  return {
    id: 'mbox-1',
    leadId: 'lead-1',
    leadName: 'Maria',
    kind: 'outreach',
    at: LATER,
    focus: 'confirmar se viu a loja de exemplo',
    status: 'pending',
    requested: false,
    createdBy: 'agent',
    createdByRunId: null,
    firedRunId: null,
    cancelReason: null,
    createdAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'mbox-1',
    kind: 'outreach',
    status: 'queued',
    lead_id: 'lead-1',
    thread_id: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_cents: 0,
    error: null,
    created_at: '2026-11-24T10:00:00.000Z',
    started_at: null,
    finished_at: null,
    run_at: LATER,
    source: 'followup',
    promised: false,
    lead_name: 'Maria',
    thread_agent_enabled: null,
    ...overrides,
  };
}

describe('buildQueue deduplication', () => {
  test('collapses wakeup + matching scheduled run + mirrored nextActionAt into a single item', () => {
    const lead = makeLead({ nextActionAt: LATER });
    const wakeup = makeWakeup({ id: 'mbox-1', at: LATER });
    const run = makeRun({ id: 'mbox-1', run_at: LATER });

    const q = buildQueue([lead], [run], [wakeup], NOW);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      key: 'wakeup:mbox-1',
      what: 'follow-up',
      detail: 'confirmar se viu a loja de exemplo',
      cancel: { kind: 'wakeup', id: 'mbox-1' },
    });
  });

  test('keeps genuinely separate delayed runs (different mailbox id) alongside a wakeup', () => {
    const lead = makeLead({ nextActionAt: LATER });
    const wakeup = makeWakeup({ id: 'mbox-1', at: LATER });
    const delayedReply = makeRun({
      id: 'mbox-2',
      kind: 'reply',
      source: 'inbound',
      run_at: SOONER,
    });

    const q = buildQueue([lead], [delayedReply], [wakeup], NOW);
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({
      key: 'run:mbox-2',
      what: 'o lead escreveu',
      cancel: { kind: 'run', id: 'mbox-2' },
    });
    expect(q[1]).toMatchObject({
      key: 'wakeup:mbox-1',
      cancel: { kind: 'wakeup', id: 'mbox-1' },
    });
  });

  test('falls back to lead.nextActionAt only when no wakeup or scheduled run covers the lead', () => {
    const lead = makeLead({ nextActionAt: LATER });
    const q = buildQueue([lead], [], [], NOW);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      key: 'lead:lead-1',
      what: 'retorno agendado',
      cancel: null,
    });
  });

  test('hides automated follow-ups on paused leads, but keeps promised callbacks', () => {
    const paused = makeLead({ agentPausedAt: '2026-11-24T11:00:00.000Z', nextActionAt: LATER });
    const autoFollowup = makeWakeup({ id: 'mbox-auto', requested: false, createdBy: 'agent' });
    const promised = makeWakeup({
      id: 'mbox-prom',
      requested: true,
      focus: 'lead pediu pra chamar às 14h',
    });

    const q = buildQueue(
      [paused],
      [makeRun({ id: 'mbox-auto' }), makeRun({ id: 'mbox-prom', promised: true })],
      [autoFollowup, promised],
      NOW,
    );
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      key: 'wakeup:mbox-prom',
      what: 'retorno pedido',
      promised: true,
      origin: 'lead',
    });
  });

  test('suppresses archived and unsubscribed leads even for promised callbacks', () => {
    const unsub = makeLead({ unsubscribedAt: '2026-11-24T11:00:00.000Z' });
    const promised = makeWakeup({ id: 'mbox-prom', requested: true });
    const q = buildQueue([unsub], [makeRun({ id: 'mbox-prom', promised: true })], [promised], NOW);
    expect(q).toHaveLength(0);
  });
});

describe('dedupeLeadSchedule', () => {
  test('removes scheduled runs duplicating wakeups and hides mirrored nextActionAt', () => {
    const lead = makeLead({ nextActionAt: LATER });
    const wakeups = [makeWakeup({ id: 'mbox-1' })];
    const runs = [
      makeRun({ id: 'mbox-1' }),
      makeRun({ id: 'mbox-2', kind: 'reply', source: 'inbound', run_at: SOONER }),
    ];

    const res = dedupeLeadSchedule(lead, runs, wakeups);
    expect(res.wakeups).toHaveLength(1);
    expect(res.extraRuns).toHaveLength(1);
    expect(res.extraRuns[0]!.id).toBe('mbox-2');
    expect(res.fallbackNextActionAt).toBeNull();
  });
});
