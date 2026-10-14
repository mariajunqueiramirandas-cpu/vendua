import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { huntSubjectTx, leadSubjectTx } from '../src/agent-host/agents/crm/context.ts';
import { EMPTY_TURN } from '../src/agent-host/agents/crm/shared.ts';
import { leadFactsTx, rememberTx } from '../src/modules/agent-memory.ts';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { leadInsert, insertLeadTx } from '../src/modules/leads.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

// The memory tools and feeds on Agent Runtime v3: the strategist's `remember`, a lead's `set_fact`,
// what a lead's and a hunt's subject read back, and the discovery debrief a finished turn writes.
// Memory names the turn that wrote it (crm_turns.turn_id).

const feedOf = (s: { memory: { facts: string[]; agentNotes?: string[] } }) => [
  ...s.memory.facts,
  ...(s.memory.agentNotes ?? []),
];

describe.skipIf(!OWNER_URL)('agent memory v2 wiring (db)', () => {
  const b = crmBench('memory-wiring');
  const { sql, mine, runTools } = b;
  const uniq = crypto.randomUUID().slice(0, 8);
  const nm = (s: string) => `wm-${uniq}-${s}`;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => mine.clear());

  const mkLead = (name: string, segment: string | null = null) =>
    controlTx(sql, async (tx) => {
      const r = await insertLeadTx(tx, leadInsert({ name: `${name}-${uniq}`, whatsapp: null }));
      const id = r.body.lead.id;
      if (segment) await tx`update leads set segment = ${segment} where id = ${id}`;
      return id;
    });

  /** the turn a finished run wrote: the newest crm_turns row of its actor */
  const turnOf = async (actorId: string) =>
    (
      await sql<{ turn_id: string }[]>`
        select turn_id from crm_turns where actor_id = ${actorId} order by finished_at desc limit 1`
    )[0]!.turn_id;

  // a discovery turn parks unless a research tool is configured: the mock provider stands in
  async function withMockDiscovery(fn: () => Promise<void>) {
    const prior = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'`;
    await upsertIntegration(
      b.appSql,
      { kind: 'discovery', driver: 'mock', enabled: true },
      b.key(),
    );
    try {
      await fn();
    } finally {
      await sql`delete from control_integrations where kind = 'discovery'`;
      for (const d of prior)
        await upsertIntegration(
          b.appSql,
          { kind: 'discovery', driver: d.driver, enabled: d.enabled },
          b.key(),
        );
    }
  }

  const myItems = (scope?: string) =>
    sql<
      {
        scope: string;
        segment: string | null;
        content: string;
        source: string;
        source_run_id: string | null;
      }[]
    >`
      select scope, segment, content, source, source_run_id
      from agent_memory_items
      where content like ${`wm-${uniq}-%`}
      ${scope ? sql`and scope = ${scope}` : sql``}
      order by content`;

  test('remember writes agent_memory_items with agent source, dedupes', async () => {
    // remember is strategist-only: lead-driven jobs read untrusted text (M3)
    const fact = nm('docerias respondem melhor à noite');
    const first = await runTools([['remember', { fact }]], { kind: 'strategist' });
    expect(first.outcomes[0]).toMatchObject({
      name: 'remember',
      ok: true,
      data: { remembered: fact, scope: 'workspace' },
    });
    const firstTurn = await turnOf(first.actorId);

    await runTools([['remember', { fact }]], { kind: 'strategist' });
    const rows = await myItems('workspace');
    expect(rows.map((r) => r.content)).toEqual([fact]);
    expect(rows[0]!.source).toBe('agent');
    expect(rows[0]!.source_run_id).toBe(firstTurn);

    const seg = await runTools(
      [
        [
          'remember',
          { fact: nm('padarias têm pico antes das 9h'), scope: 'segment', segment: nm('PADARIAS') },
        ],
      ],
      { kind: 'strategist' },
    );
    expect(seg.outcomes[0]).toMatchObject({ name: 'remember', ok: true });
    const segRows = await myItems('segment');
    expect(segRows).toHaveLength(1);
    expect(segRows[0]!.segment).toBe(nm('padarias'));

    const bad = await runTools([['remember', { fact: 'x', scope: 'segment' }]], {
      kind: 'strategist',
    });
    expect(bad.outcomes[0]).toMatchObject({
      name: 'remember',
      ok: false,
      content: expect.stringContaining('segment'),
    });
    const empty = await runTools([['remember', { fact: '  ' }]], { kind: 'strategist' });
    expect(empty.outcomes[0]).toMatchObject({ name: 'remember', ok: false });

    const legacy = await sql`
      select 1 from control_settings
      where key = 'agent_memory' and value::text like ${`%wm-${uniq}%`}
    `;
    expect(legacy).toHaveLength(0);
  });

  test('set_fact upserts lead_facts bound to the run lead', async () => {
    const leadId = await mkLead('fact');
    const bad = await runTools([['set_fact', { key: 'BAD KEY', value: 'x' }]], {
      leadId,
      kind: 'reply',
    });
    expect(bad.outcomes[0]).toMatchObject({
      name: 'set_fact',
      ok: false,
      content: expect.stringContaining('Argumentos inválidos'),
    });
    const badConf = await runTools([['set_fact', { key: 'size', value: 'x', confidence: 2 }]], {
      leadId,
      kind: 'reply',
    });
    expect(badConf.outcomes[0]).toMatchObject({ name: 'set_fact', ok: false });

    const out = await runTools(
      [['set_fact', { key: 'fleet_size', value: '12', confidence: 0.8 }]],
      { leadId, kind: 'reply' },
    );
    expect(out.outcomes[0]).toMatchObject({
      name: 'set_fact',
      ok: true,
      data: { fact: { key: 'fleet_size', value: '12', confidence: 0.8, source: 'agent' } },
    });
    const [row] = await sql<{ source_run_id: string }[]>`
      select source_run_id from lead_facts where lead_id = ${leadId} and key = 'fleet_size'`;
    expect(row!.source_run_id).toBe(await turnOf(out.actorId));

    await runTools([['set_fact', { key: 'fleet_size', value: '14' }]], { leadId, kind: 'reply' });
    const facts = await controlTx(sql, (tx) => leadFactsTx(tx, leadId));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ key: 'fleet_size', value: '14', confidence: 1 });

    // a lead's job takes its lead from the actor: an id in the arguments writes nowhere
    const other = await mkLead('fact-other');
    await runTools([['set_fact', { leadId: other, key: 'fleet_size', value: 'x' }]], {
      leadId,
      kind: 'reply',
    });
    expect(await controlTx(sql, (tx) => leadFactsTx(tx, other))).toEqual([]);
  });

  test('the lead subject renders a FATOS block for the lead', async () => {
    const leadId = await mkLead('fatos');
    await runTools([['set_fact', { key: 'team_size', value: '4 people', confidence: 0.5 }]], {
      leadId,
      kind: 'reply',
    });
    const { text } = await leadSubjectTx(sql, leadId, { ...EMPTY_TURN, kind: 'reply' });
    expect(text).toContain('FATOS');
    expect(text).toContain('team_size: 4 people (confiança 0.5)');
  });

  test('the lead subject stamps ORIGEM from who spoke first — only what reached the wire counts', async () => {
    const origem = async (leadId: string) =>
      (await leadSubjectTx(sql, leadId, { ...EMPTY_TURN, kind: 'reply' })).text;
    const cold = await mkLead('origem-cold');
    const warm = await mkLead('origem-warm');
    const [ct] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${cold}, 'whatsapp') returning id`;
    const [wt] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${warm}, 'whatsapp') returning id`;
    // no conversation yet → cold approach
    expect(await origem(cold)).toContain('ORIGEM: outbound');
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${ct!.id}, 'out', 'agent', 'oi', 'sent', now() - interval '2 hours'),
             (${ct!.id}, 'in', 'lead', 'quem é?', 'received', now() - interval '1 hour')`;
    expect(await origem(cold)).toContain('ORIGEM: outbound');
    // a rejected draft predating the lead's first message was never seen by them
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${wt!.id}, 'out', 'agent', 'rascunho', 'rejected', now() - interval '2 hours'),
             (${wt!.id}, 'in', 'lead', 'vocês fazem loja?', 'received', now() - interval '1 hour')`;
    expect(await origem(warm)).toContain('ORIGEM: inbound');
    // a send still queued when the lead wrote, and a staff note on a manual thread, never reached them
    const early = await mkLead('origem-early');
    const [et] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${early}, 'whatsapp') returning id`;
    const [mt] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${early}, 'manual') returning id`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${mt!.id}, 'out', 'staff', 'nota', 'sent', now() - interval '3 hours'),
             (${et!.id}, 'out', 'agent', 'oi', 'queued', now() - interval '2 hours'),
             (${et!.id}, 'in', 'lead', 'oi, vi o anúncio', 'received', now() - interval '1 hour')`;
    expect(await origem(early)).toContain('ORIGEM: inbound');
  });

  test('the memory feed carries segment learnings of the lead, and the hunt segment', async () => {
    const segment = nm('docerias');
    const leadId = await mkLead('feed', segment);
    await controlTx(sql, async (tx) => {
      await rememberTx(tx, {
        scope: 'segment',
        segment,
        content: nm('seg-learning'),
        source: 'agent',
      });
      await rememberTx(tx, { scope: 'workspace', content: nm('ws-learning'), source: 'agent' });
      await rememberTx(tx, {
        scope: 'segment',
        segment: 'outro-nicho',
        content: nm('miss'),
        source: 'agent',
      });
    });
    const feed = feedOf(await leadSubjectTx(sql, leadId, { ...EMPTY_TURN, kind: 'reply' }));
    expect(feed).toContain(nm('seg-learning'));
    expect(feed).toContain(nm('ws-learning'));
    expect(feed).not.toContain(nm('miss'));

    // the hunt's segment decides its feed (discovery runs have no lead)
    const hunt = feedOf(
      await huntSubjectTx(sql, {
        ...EMPTY_TURN,
        kind: 'discovery',
        params: { segment: 'outro-nicho' },
      }),
    );
    expect(hunt).toContain(nm('miss'));
  });

  test('a discovery debrief is written at the turn end, tagged with the brief segment', () =>
    withMockDiscovery(async () => {
      const query = nm('docerias');
      const segment = nm('padarias');
      const wa = b.phone();
      const made = await runTools(
        [
          [
            'create_lead',
            {
              name: `Padaria ${uniq}`,
              city: 'Campinas',
              whatsapp: `https://wa.me/${wa.replace(/\D/g, '')}`,
              findings: 'Padaria artesanal que vende pelo WhatsApp, sem link de pedido próprio.',
              fitScore: 9,
              intentScore: 8,
            },
          ],
        ],
        { kind: 'discovery', payload: { query, segment } },
      );
      expect(made.outcomes[0]).toMatchObject({ name: 'create_lead', ok: true });
      const rows = await sql<
        { source: string; content: string; segment: string | null; source_run_id: string }[]
      >`
      select source, content, segment, source_run_id from agent_memory_items
      where scope = 'debrief' and content like ${`run ${query}%`}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe('debrief');
      expect(rows[0]!.content).toContain('1 leads (1 c/ whatsapp)');
      expect(rows[0]!.segment).toBe(segment);
      expect(rows[0]!.source_run_id).toBe(await turnOf(made.actorId));

      const feed = feedOf(
        await huntSubjectTx(sql, { ...EMPTY_TURN, kind: 'discovery', params: { segment } }),
      );
      expect(feed.some((c) => c.includes(query))).toBe(true);

      // a turn that files nothing writes no debrief (and reached the model to find that out)
      const dry = nm('dry');
      const idle = await runTools([], { kind: 'discovery', payload: { query: dry } });
      expect(idle.requests).toBe(1);
      const dryRows = await sql`
      select 1 from agent_memory_items where scope = 'debrief' and content like ${`run ${dry}%`}`;
      expect(dryRows).toHaveLength(0);

      const legacy = await sql`
      select 1 from control_settings
      where key = 'agent_memory' and value::text like ${`%wm-${uniq}%`}
    `;
      expect(legacy).toHaveLength(0);
    }));

  test('an emptied v2 table stays empty — legacy facts don’t resurrect', async () => {
    // once the v2 table exists it's the only source — an empty feed must
    // not fall back to the legacy setting
    await sql`delete from agent_memory_items`;
    await controlTx(
      sql,
      (tx) => tx`
      insert into control_settings (key, value)
      values ('agent_memory', ${tx.json({ facts: [nm('legacy-fact')] } as never)})
      on conflict (key) do update set value = excluded.value
    `,
    );
    const leadId = await mkLead('empty-mem');
    const feed = feedOf(await leadSubjectTx(sql, leadId, { ...EMPTY_TURN, kind: 'reply' }));
    expect(feed.some((c) => c.includes(nm('legacy-fact')))).toBe(false);
    expect(feed).toEqual([]);
  });
});
