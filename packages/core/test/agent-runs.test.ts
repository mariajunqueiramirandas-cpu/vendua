import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
// the harness loads the app (and the agent registry) before crm/index.ts, which needs it loaded first
import { crmBench, type ToolOutcome } from './crm-harness.ts';
import { CRM_STATES } from '../src/agent-host/agents/crm/index.ts';
import { DEFAULT_GUARDRAILS, validateSetting } from '../src/modules/integrations.ts';
import { getLeadDetail } from '../src/modules/leads.ts';

describe('toolsets — research reaches the lead kinds, lightly for reply', () => {
  const names = (kind: keyof typeof CRM_STATES) => CRM_STATES[kind];

  test('triage gets the research kit', () => {
    const t = names('triage');
    for (const t_ of ['web_search', 'read_pages', 'serp', 'maps_lookup', 'instagram_profile']) {
      expect(t).toContain(t_);
    }
    // send stays out — a new lead can never be sent unreviewed
    expect(t).not.toContain('send_message');
    // the prospect ledger stays discovery's; `plan` reaches lead kinds as the
    // persisted negotiation checklist
    expect(t).not.toContain('book');
    expect(t).toContain('plan');
  });

  test('reply gets light lookups only — read_pages included, capped', () => {
    const r = names('reply');
    expect(r).toContain('serp');
    expect(r).toContain('web_search');
    // a lead can send a link — reply reads it, but bounded (per-run call
    // cap in executeTool); the heavy monid lookups stay out
    expect(r).toContain('read_pages');
    expect(r).not.toContain('maps_lookup');
    expect(r).not.toContain('instagram_profile');
    expect(r).toContain('send_message');
    expect(r).toContain('plan');
  });

  test('outreach carries the fresh-card research kit', () => {
    // The merged staff-card path: one run researches → dossiers → contacts.
    const o = names('outreach');
    for (const t_ of ['web_search', 'read_pages', 'serp', 'maps_lookup', 'instagram_profile']) {
      expect(o).toContain(t_);
    }
    expect(o).toContain('send_message');
    expect(o).toContain('plan');
    expect(o).not.toContain('book');
  });
});

describe('guardrails — pacing knobs', () => {
  test('defaults: inbound reply immediate, first contact off', () => {
    expect(DEFAULT_GUARDRAILS.inboundReplyDelayMin).toBe(0);
    expect(DEFAULT_GUARDRAILS.firstContactDelayMin).toBe(0);
  });

  test('validateSetting accepts the new keys in range', () => {
    expect(() =>
      validateSetting('guardrails', { inboundReplyDelayMin: 15, firstContactDelayMin: 60 }),
    ).not.toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 0 })).not.toThrow();
  });

  test('validateSetting rejects out-of-range and non-integers', () => {
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1441 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1.5 })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: '60' })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 10081 })).toThrow();
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('plan — lead-scoped checklist (db)', () => {
  const b = crmBench('agent-runs');
  beforeAll(b.setup);
  afterAll(b.teardown);

  /** the plan the lead's agent_plan holds after the call */
  const planOf = (leadId: string) => getLeadDetail(b.sql, leadId).then((d) => d!.agentPlan);

  test('reply plan persists on the lead and ticks across calls', async () => {
    const l = await b.lead({ name: 'Plan Lead' });
    const wrote = await b.runTools(
      [
        [
          'plan',
          {
            items: [
              { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
              { step: 'qualificação: quem decide', status: 'todo' },
              { step: 'commit: enviar proposta' },
            ],
          },
        ],
      ],
      { leadId: l.id, kind: 'reply' },
    );
    expect(wrote.outcomes[0]).toMatchObject({ name: 'plan', ok: true });
    expect(await planOf(l.id)).toEqual([
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'qualificação: quem decide', status: 'todo', note: null },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ]);

    // tick — merge by step flips statuses, keeps notes
    await b.runTools(
      [
        [
          'plan',
          {
            items: [
              { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
              { step: 'qualificação: quem decide', status: 'done', note: 'dona decide sozinha' },
              { step: 'commit: enviar proposta', status: 'todo' },
            ],
          },
        ],
      ],
      { leadId: l.id, kind: 'reply' },
    );
    expect((await planOf(l.id))[1]).toEqual({
      step: 'qualificação: quem decide',
      status: 'done',
      note: 'dona decide sozinha',
    });
  });

  test('omitted steps survive a merge — only skip removes', async () => {
    const l = await b.lead({ name: 'Merge Lead' });
    await b.runTools(
      [['plan', { items: [{ step: 'contexto', status: 'done' }, { step: 'qualificação' }] }]],
      { leadId: l.id, kind: 'reply' },
    );
    // second call only mentions one step — the other must not be dropped
    await b.runTools(
      [
        [
          'plan',
          {
            items: [
              { step: 'qualificação', status: 'done', note: 'decisor é a dona' },
              { step: 'commit' },
            ],
          },
        ],
      ],
      { leadId: l.id, kind: 'reply' },
    );
    expect(await planOf(l.id)).toEqual([
      { step: 'contexto', status: 'done', note: null },
      { step: 'qualificação', status: 'done', note: 'decisor é a dona' },
      { step: 'commit', status: 'todo', note: null },
    ]);
  });

  test('skip frees a slot under the 12-item cap', async () => {
    const l = await b.lead({ name: 'Cap Lead' });
    await b.runTools(
      [['plan', { items: Array.from({ length: 12 }, (_, i) => ({ step: `etapa ${i + 1}` })) }]],
      { leadId: l.id, kind: 'reply' },
    );
    await b.runTools(
      [['plan', { items: [{ step: 'etapa 1', status: 'skip' }, { step: 'commit' }] }]],
      { leadId: l.id, kind: 'reply' },
    );
    const plan = await planOf(l.id);
    expect(plan).toHaveLength(12);
    expect(plan.map((s) => s.step)).toContain('commit');
    expect(plan.map((s) => s.step)).not.toContain('etapa 1');
  });

  test('discovery still uses run-scoped memory', async () => {
    const { outcomes } = await b.runTools([['plan', { content: 'campaign' }]], {
      kind: 'discovery',
    });
    expect(outcomes[0]).toMatchObject({ name: 'plan', ok: true, data: { campaign: 'campaign' } });
  });

  test('non-array items are rejected', async () => {
    const l = await b.lead({ name: 'Bad Plan Lead' });
    const { outcomes } = await b.runTools([['plan', {}]], { leadId: l.id, kind: 'reply' });
    expect(outcomes[0]).toMatchObject({ name: 'plan', ok: false });
    expect((outcomes[0] as Extract<ToolOutcome, { ok: boolean }>).content).toStartWith(
      'Argumentos inválidos',
    );
  });

  test('a blank step is rejected', async () => {
    const l = await b.lead({ name: 'Blank Plan Lead' });
    const { outcomes } = await b.runTools([['plan', { items: [{ step: ' ' }] }]], {
      leadId: l.id,
      kind: 'reply',
    });
    expect(outcomes[0]).toMatchObject({ name: 'plan', ok: false });
  });
});
