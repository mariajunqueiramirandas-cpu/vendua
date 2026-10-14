import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { jsonSchemaOf } from '@vendua/agent-runtime';
import { workspaceTx, type Workspace } from '../src/agent-host/agents/crm/context.ts';
import { crmDiscovery, DISCOVERY_TOOLS } from '../src/agent-host/agents/crm/discovery.ts';
import { CRM_STATES, crmAgent, offered } from '../src/agent-host/agents/crm/index.ts';
import { buildSystemPrompt } from '../src/agent-host/agents/crm/prompts.ts';
import { crmStrategist } from '../src/agent-host/agents/crm/strategist.ts';
import { MonidBudget } from '../src/crm/channels/monid.ts';
import type { JobKind } from '../src/crm/policy.ts';
import { DEFAULT_PITCH, type Pitch, upsertIntegration } from '../src/modules/integrations.ts';
import type { Sql } from '../src/platform/db.ts';
import { crmBench, OWNER_URL, type ToolOutcome } from './crm-harness.ts';

/** The mock discovery provider on for a describe's runs (a discovery run parks with no research
 *  provider); the returned restore puts the prior discovery rows back as they were. */
async function mockDiscovery(db: Sql, key: () => string) {
  const prior = await db<{ driver: string; enabled: boolean }[]>`
    select driver, enabled from control_integrations where kind = 'discovery'`;
  await upsertIntegration(db, { kind: 'discovery', driver: 'mock', enabled: true }, key());
  return async () => {
    if (!prior.some((p) => p.driver === 'mock'))
      await db`delete from control_integrations where kind = 'discovery' and driver = 'mock'`;
    for (const p of prior)
      await db`update control_integrations set enabled = ${p.enabled}
        where kind = 'discovery' and driver = ${p.driver}`;
  };
}

// The discovery agent's book and plan, its monid lookups and what the workspace offers. Tools run
// on the real runtime (crm-harness), so the spend and the offer come from what the install has.

const dataOf = <T>(o: ToolOutcome | undefined): T => (o as { data: T }).data;

describe('MonidBudget', () => {
  test('refuses calls past the cap with a model-readable error', () => {
    const b = new MonidBudget(0.01);
    b.reserve(0.008);
    expect(() => b.reserve(0.005)).toThrow(/monid budget/);
    expect(() => b.reserve(0.002)).not.toThrow();
    // parallel calls each reserve up-front — a stale balance can't double-spend
    b.reconcile(0.002, 0.001);
    expect(b.spent).toBeCloseTo(0.009);
  });
});

type Gate = { disabled: Record<string, string>; channels: string[] };
const asWorkspace = (g: Gate) => g as unknown as Workspace;

const MONID = ['maps_lookup', 'instagram_profile', 'serp'];
const DISC = ['web_search', 'read_pages'];
const disabled = (...names: string[]) => Object.fromEntries(names.map((n) => [n, 'x']));
const KINDS: JobKind[] = ['triage', 'reply', 'outreach', 'discovery', 'strategist'];

const GATES: Record<string, Gate> = {
  full: { disabled: {}, channels: ['whatsapp', 'instagram', 'email'] },
  noMonid: { disabled: disabled(...MONID), channels: ['whatsapp'] },
  noDiscovery: { disabled: disabled(...DISC), channels: ['email'] },
  noResearch: { disabled: disabled(...MONID, ...DISC), channels: ['instagram'] },
  noChannels: { disabled: disabled('send_message'), channels: [] },
  noMemory: { disabled: disabled('remember', 'set_fact'), channels: ['whatsapp'] },
};

// The per-turn lead gate — install is fine, this lead can't be reached right now. The static
// prompt never sees these (a harness note announces them), so only the tool defs are checked.
const TURN_GATES: Record<string, Gate> = {
  leadBlocked: { disabled: disabled('send_message'), channels: [] },
  nothing: {
    disabled: disabled(...MONID, ...DISC, 'send_message', 'draft_message', 'remember', 'set_fact'),
    channels: [],
  },
};

/** The tools a job is offered under a workspace, as the agent's offer computes them. */
function offeredFor(kind: JobKind, g: Gate): Set<string> {
  if (kind === 'discovery') return new Set(DISCOVERY_TOOLS.filter((n) => !g.disabled[n]));
  if (kind === 'strategist')
    return new Set(['remember', 'propose_brief'].filter((n) => !g.disabled[n]));
  return offered(kind, asWorkspace(g));
}

const AGENT_OF = {
  triage: crmAgent,
  reply: crmAgent,
  outreach: crmAgent,
  discovery: crmDiscovery,
  strategist: crmStrategist,
} as const;

/** The model's view of each tool a job is offered: its description and JSON parameters. */
function defsOf(kind: JobKind, names: Set<string>) {
  return AGENT_OF[kind].def.tools
    .filter((t) => names.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: jsonSchemaOf(t.input, t.jsonSchema),
    }));
}

const ALL_TOOLS = [
  ...new Set(
    [...crmAgent.def.tools, ...crmDiscovery.def.tools, ...crmStrategist.def.tools].map(
      (t) => t.name,
    ),
  ),
];
const mentioned = (text: string) => ALL_TOOLS.filter((n) => new RegExp(`\\b${n}\\b`).test(text));

describe('unconfigured tools — hidden, refused, never named', () => {
  // The invariant: nothing the model reads names a tool it wasn't offered.
  const checkGate = (g: string) => {
    const install = g in GATES;
    const gate = (GATES[g] ?? TURN_GATES[g])!;
    for (const kind of KINDS) {
      const names = offeredFor(kind, gate);
      for (const goal of install ? (['meeting', 'negotiation'] as const) : []) {
        for (const bookingUrl of [null, 'https://cal.example/x']) {
          for (const offer of ['', 'R$ 49/mês']) {
            const p = buildSystemPrompt(
              kind,
              { ...DEFAULT_PITCH, offer } as Pitch,
              '',
              { facts: [] },
              { goal, bookingUrl, tools: names, channels: gate.channels },
            );
            expect({ kind, goal, extra: mentioned(p).filter((n) => !names.has(n)) }).toEqual({
              kind,
              goal,
              extra: [],
            });
          }
        }
      }
      for (const d of defsOf(kind, names)) {
        const extra = mentioned(d.description + JSON.stringify(d.parameters)).filter(
          (n) => !names.has(n),
        );
        expect({ kind, tool: d.name, extra }).toEqual({ kind, tool: d.name, extra: [] });
      }
    }
  };
  for (const g of [...Object.keys(GATES), ...Object.keys(TURN_GATES)]) {
    const name = `${g}: prompt + tool defs name only offered tools`;
    test(name, () => checkGate(g));
  }

  test('discovery loses the arsenal lines of tools it lacks', () => {
    const tools = new Set(offeredFor('discovery', GATES.noMonid!));
    const p = buildSystemPrompt(
      'discovery',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      { tools, channels: [] },
    );
    expect(p).not.toContain('- maps_lookup(');
    expect(p).not.toContain('- serp(');
    expect(p).toContain('- web_search(query, purpose)');
  });

  test('no research at all → reply asks only on inbound, outreach sends nothing blind', () => {
    const reply = buildSystemPrompt(
      'reply',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      { tools: offeredFor('reply', GATES.noResearch!), channels: ['instagram'] },
    );
    expect(reply).toContain('DOSSIÊ fraco num outbound e sem pesquisa externa nesta instalação');
    expect(reply).toContain('ORIGEM inbound (ela nos procurou)');
    const outreach = buildSystemPrompt(
      'outreach',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      { tools: offeredFor('outreach', GATES.noResearch!), channels: ['instagram'] },
    );
    expect(outreach).toContain('sem pesquisa externa nesta instalação');
    expect(outreach).toContain('Não mande nada: create_task para humano');
    expect(outreach).not.toContain('a primeira mensagem já chega perguntando quem é');
  });

  test('the prompt states which channels are live', () => {
    const none = buildSystemPrompt(
      'reply',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      { tools: new Set(CRM_STATES.reply), channels: [] },
    );
    expect(none).toContain('nenhum canal de envio (whatsapp/instagram/email) está conectado');
    const partial = buildSystemPrompt(
      'outreach',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      { tools: new Set(CRM_STATES.outreach), channels: ['whatsapp'] },
    );
    expect(partial).toContain('Desligado(s) nesta instalação: instagram, email');
    expect(partial).not.toContain('Instagram: DM frio');
    const full = buildSystemPrompt(
      'outreach',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        tools: new Set(CRM_STATES.outreach),
        channels: ['whatsapp', 'instagram', 'email'],
      },
    );
    expect(full).not.toContain('Desligado');
  });
});

describe.skipIf(!OWNER_URL)('discovery and strategist tools on Runtime v3 (db)', () => {
  const b = crmBench('strategist-tools');
  const { sql } = b;
  const realFetch = globalThis.fetch;

  let restoreDiscovery = async () => {};
  beforeAll(async () => {
    await b.setup();
    restoreDiscovery = await mockDiscovery(sql as unknown as Sql, b.key);
  });
  afterAll(async () => {
    await restoreDiscovery();
    await b.teardown();
  });
  beforeEach(() => {
    b.mine.clear();
    process.env.MONID_API_KEY = 'test-key';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.MONID_API_KEY;
  });

  const stubMonid = (output: unknown[], assert?: (body: string) => void) => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      assert?.(String(init?.body));
      return new Response(JSON.stringify({ output, cost: { value: 0.003, currency: 'USD' } }), {
        status: 200,
      });
    }) as typeof fetch;
  };

  test('book — working memory: upsert merges channels and tried', async () => {
    const { outcomes } = await b.runTools(
      [
        [
          'book',
          {
            action: 'upsert',
            name: 'Padaria da Ponte',
            city: 'Saquarema',
            channels: { instagram: '@apadariadaponte' },
            tried: ['ig'],
          },
        ],
        [
          'book',
          {
            action: 'upsert',
            name: 'padaria da ponte',
            channels: { whatsapp: '+5522999990000' },
            tried: ['hub'],
            status: 'resolved',
          },
        ],
        // re-upserting a known channel isn't progress — the tool reports only what actually landed
        [
          'book',
          {
            action: 'upsert',
            name: 'Padaria da Ponte',
            channels: { instagram: '@apadariadaponte' },
            tried: ['serp'],
          },
        ],
      ],
      { kind: 'discovery' },
    );
    const e = dataOf<{
      entry: { channels: Record<string, string>; tried: string[]; status: string };
    }>(outcomes[1]).entry;
    expect(e.channels.instagram).toBe('@apadariadaponte');
    expect(e.channels.whatsapp).toBe('+5522999990000');
    expect(e.tried).toEqual(['ig', 'hub']);
    expect(e.status).toBe('resolved');
    expect(JSON.parse((outcomes[2] as { content: string }).content).addedChannels).toEqual([]);
  });

  test('book — working memory: list renders the digest', async () => {
    const { outcomes } = await b.runTools(
      [
        [
          'book',
          {
            action: 'upsert',
            name: 'Padaria da Ponte',
            channels: { instagram: '@apadariadaponte' },
          },
        ],
        [
          'book',
          { action: 'upsert', name: 'Padaria da Ponte', channels: { whatsapp: '+5522999990000' } },
        ],
        ['book', { action: 'list' }],
      ],
      { kind: 'discovery' },
    );
    expect(dataOf<{ book: string }>(outcomes[2]).book).toContain('whatsapp+instagram');
  });

  test('plan — self-authored campaign plan', async () => {
    const { outcomes } = await b.runTools([['plan', { content: 'maps primeiro' }]], {
      kind: 'discovery',
    });
    expect(outcomes[0]).toMatchObject({ name: 'plan', ok: true });
    expect(dataOf<{ stored: boolean; campaign: string }>(outcomes[0])).toMatchObject({
      stored: true,
      campaign: 'maps primeiro',
    });
  });

  test('instagram_profile normalizes bio + externalUrl, and hints the hub', async () => {
    stubMonid([
      {
        username: 'apadariadaponte',
        fullName: 'Padaria Da Ponte',
        biography: 'artesanal 📞 (22) 99968-8525',
        externalUrl: 'https://linktr.ee/padariadaponte',
        followersCount: 1249,
        businessCategoryName: 'Bakery',
      },
    ]);
    const { outcomes } = await b.runTools([['instagram_profile', { handle: '@apadariadaponte' }]], {
      kind: 'discovery',
    });
    const out = dataOf<{
      profile: { biography: string; externalUrl: string };
      foundContacts: { phones: string[] };
      next?: string[];
      spentUsd: number;
      monidUsd: number;
    }>(outcomes[0]);
    expect(out.profile.biography).toContain('99968-8525');
    expect(out.foundContacts.phones).toContain('+5522999688525');
    expect(out.next?.[0]).toContain('linktr.ee');
    expect(out.spentUsd).toBe(0.003);
    // the turn's monid balance, carried in the result for the fold
    expect(out.monidUsd).toBe(0.003);
  });

  test('maps_lookup anchors bare city on Brasil and hints phone-less candidates', async () => {
    let sent = '';
    stubMonid(
      [
        { name: 'Padaria X', phone: '+55 22 99987-3674', address: 'Rua A' },
        { name: 'Padaria Fixa', phone: '+55 22 3343-4882' },
        { title: 'Doceria Y' },
      ],
      (body) => (sent = body),
    );
    const { outcomes } = await b.runTools(
      [['maps_lookup', { query: 'padaria', city: 'Saquarema', limit: 3 }]],
      { kind: 'discovery' },
    );
    expect(sent).toContain('"location":"Saquarema, Brasil"');
    const out = dataOf<{
      candidates: { name: string | null; phone: string | null; whatsappLikely: boolean }[];
      next: string[];
    }>(outcomes[0]);
    expect(out.candidates[0]!.phone).toBe('+55 22 99987-3674');
    // BR mobile = whatsapp line; landline (…3343-xxxx) is not
    expect(out.candidates[0]!.whatsappLikely).toBe(true);
    expect(out.candidates[1]!.whatsappLikely).toBe(false);
    expect(out.next[0]).toContain('Doceria Y');
    expect(out.next[0]).toContain('serp');
  });

  test('toolsFor drops disabled tools', async () => {
    delete process.env.MONID_API_KEY;
    const ws = await workspaceTx(sql);
    expect(ws.disabled).toMatchObject({ serp: 'MONID_API_KEY não configurada' });
    const lead = offered('outreach', ws);
    for (const n of MONID) expect(lead.has(n)).toBe(false);
    expect(lead.has('draft_message')).toBe(true);
    const discovery = DISCOVERY_TOOLS.filter((n) => !ws.disabled[n]);
    for (const n of MONID) expect(discovery).not.toContain(n);
    expect(discovery).toContain('web_search');
  });

  test('a disabled tool called anyway is refused before it runs', async () => {
    delete process.env.MONID_API_KEY;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const { outcomes } = await b.runTools([['serp', { query: 'x' }]], { kind: 'discovery' });
    expect(outcomes[0]!.blocked).toMatch(/^(state_gate|available):/);
    expect(fetched).toBe(false);
  });
});
