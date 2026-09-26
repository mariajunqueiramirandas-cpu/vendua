import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  executeTool,
  bookDigest,
  registeredToolNames,
  toolsFor,
  type ToolContext,
  type ToolGate,
} from '../src/agent/tools.ts';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { DEFAULT_PITCH, type Pitch } from '../src/modules/integrations.ts';
import { MonidBudget } from '../src/agent/channels/monid.ts';

// book/plan never touch sql; monid tools hit fetch — stub it per test.
const ctx = (): ToolContext => ({
  sql: null as never,
  runId: 't',
  runKind: 'discovery',
  leadId: null,
  threadId: null,
  step: 0,
  claimToken: null,
  pageCache: new Map(),
  briefName: null,
  leadCap: 20,
  channelOverride: null,
  book: new Map(),
  plan: null,
  monid: new MonidBudget(0.25),
  seenContacts: new Set(),
  pageReads: 0,
  draftOnly: false,
});

const realFetch = globalThis.fetch;
beforeEach(() => {
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

describe('book — working memory', () => {
  test('upsert merges channels and tried, list renders the digest', async () => {
    const c = ctx();
    await executeTool(c, '1', 'book', {
      action: 'upsert',
      name: 'Padaria da Ponte',
      city: 'Saquarema',
      channels: { instagram: '@apadariadaponte' },
      tried: ['ig'],
    });
    await executeTool(c, '2', 'book', {
      action: 'upsert',
      name: 'padaria da ponte',
      channels: { whatsapp: '+5522999990000' },
      tried: ['hub'],
      status: 'resolved',
    });
    const e = c.book.get('padaria da ponte')!;
    expect(e.channels.instagram).toBe('@apadariadaponte');
    expect(e.channels.whatsapp).toBe('+5522999990000');
    expect(e.tried).toEqual(['ig', 'hub']);
    expect(e.status).toBe('resolved');
    expect(bookDigest(c.book)).toContain('instagram+whatsapp');
    // re-upserting a known channel isn't progress — the tool reports only what actually landed
    const again = (await executeTool(c, '3', 'book', {
      action: 'upsert',
      name: 'Padaria da Ponte',
      channels: { instagram: '@apadariadaponte' },
      tried: ['serp'],
    })) as { addedChannels: string[] };
    expect(again.addedChannels).toEqual([]);
  });
});

describe('plan — self-authored campaign plan', () => {
  test('stores and echoes the book', async () => {
    const c = ctx();
    const out = (await executeTool(c, 'p', 'plan', { content: 'maps primeiro' })) as {
      plan: string;
    };
    expect(c.plan).toBe('maps primeiro');
    expect(out.plan).toBe('maps primeiro');
  });
});

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

describe('monid enrichment tools', () => {
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
    const c = ctx();
    const out = (await executeTool(c, 'i', 'instagram_profile', {
      handle: '@apadariadaponte',
    })) as {
      profile: { biography: string; externalUrl: string };
      foundContacts: { phones: string[] };
      next?: string[];
      spentUsd: number;
    };
    expect(out.profile.biography).toContain('99968-8525');
    expect(out.foundContacts.phones).toContain('+5522999688525');
    expect(out.next?.[0]).toContain('linktr.ee');
    expect(out.spentUsd).toBe(0.003);
    expect(c.monid!.spent).toBe(0.003);
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
    const c = ctx();
    const out = (await executeTool(c, 'm', 'maps_lookup', {
      query: 'padaria',
      city: 'Saquarema',
      limit: 3,
    })) as {
      candidates: { name: string | null; phone: string | null; whatsappLikely: boolean }[];
      next: string[];
    };
    expect(sent).toContain('"location":"Saquarema, Brasil"');
    expect(out.candidates[0]!.phone).toBe('+55 22 99987-3674');
    // BR mobile = whatsapp line; landline (…3343-xxxx) is not
    expect(out.candidates[0]!.whatsappLikely).toBe(true);
    expect(out.candidates[1]!.whatsappLikely).toBe(false);
    expect(out.next[0]).toContain('Doceria Y');
    expect(out.next[0]).toContain('serp');
  });

  test('returns the honest error when the key is missing', async () => {
    delete process.env.MONID_API_KEY;
    const c = ctx();
    const out = (await executeTool(c, 's', 'serp', { query: 'x' })) as { error: string };
    expect(out.error).toContain('MONID_API_KEY');
  });
});

describe('unconfigured tools — hidden, refused, never named', () => {
  const MONID = ['maps_lookup', 'instagram_profile', 'serp'];
  const DISC = ['web_search', 'read_pages'];
  const off = new Map(MONID.map((n) => [n, 'MONID_API_KEY não configurada']));
  const all = registeredToolNames();
  const mentioned = (text: string) => all.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
  const KINDS = ['triage', 'reply', 'outreach', 'discovery', 'strategist'] as const;
  const disabled = (...names: string[]) => new Map(names.map((n) => [n, 'x']));
  const GATES: Record<string, ToolGate> = {
    full: { disabled: new Map(), channels: ['whatsapp', 'instagram', 'email'] },
    noMonid: { disabled: disabled(...MONID), channels: ['whatsapp'] },
    noDiscovery: { disabled: disabled(...DISC), channels: ['email'] },
    noResearch: { disabled: disabled(...MONID, ...DISC), channels: ['instagram'] },
    noChannels: { disabled: disabled('send_message'), channels: [] },
    noMemory: { disabled: disabled('remember', 'set_fact'), channels: ['whatsapp'] },
  };

  // The per-turn lead gate — install is fine, this lead can't be reached right now.
  // The static prompt never sees these (a harness note announces them), so only defs are checked.
  const TURN_GATES: Record<string, ToolGate> = {
    leadBlocked: {
      disabled: disabled('send_message'),
      channels: [],
      draftChannels: ['manual'],
    },
    nothing: {
      disabled: disabled(
        ...MONID,
        ...DISC,
        'send_message',
        'draft_message',
        'remember',
        'set_fact',
      ),
      channels: [],
      draftChannels: [],
    },
  };

  test('toolsFor drops disabled tools', () => {
    const names = toolsFor('discovery', { disabled: off, channels: ['whatsapp'] }).map(
      (t) => t.name,
    );
    expect(names).not.toContain('serp');
    expect(names).not.toContain('maps_lookup');
    expect(names).toContain('web_search');
  });

  test('a disabled tool called anyway is refused before it runs', async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const c = { ...ctx(), disabledTools: off };
    const out = (await executeTool(c, 's', 'serp', { query: 'x' })) as { error: string };
    expect(out.error).toMatch(/^TOOL_DISABLED/);
    expect(fetched).toBe(false);
  });

  // The invariant: nothing the model reads names a tool it wasn't offered.
  test.each([...Object.keys(GATES), ...Object.keys(TURN_GATES)])(
    '%s: prompt + tool defs name only offered tools',
    (g) => {
      const install = g in GATES;
      const gate = (GATES[g] ?? TURN_GATES[g])!;
      for (const kind of KINDS) {
        const defs = toolsFor(kind, gate);
        const offered = new Set(defs.map((d) => d.name));
        for (const goal of install ? (['meeting', 'negotiation'] as const) : []) {
          for (const bookingUrl of [null, 'https://cal.example/x']) {
            for (const offer of ['', 'R$ 49/mês'] as string[]) {
              const p = buildSystemPrompt(
                kind,
                { ...DEFAULT_PITCH, offer } as Pitch,
                '',
                { facts: [] },
                {
                  goal,
                  bookingUrl,
                  tools: offered,
                  channels: gate.channels,
                },
              );
              expect({ kind, goal, extra: mentioned(p).filter((n) => !offered.has(n)) }).toEqual({
                kind,
                goal,
                extra: [],
              });
            }
          }
        }
        for (const d of defs) {
          const extra = mentioned(d.description + JSON.stringify(d.parameters)).filter(
            (n) => !offered.has(n),
          );
          expect({ kind, tool: d.name, extra }).toEqual({ kind, tool: d.name, extra: [] });
        }
      }
    },
  );

  test('discovery loses the arsenal lines of tools it lacks', () => {
    const tools = new Set(toolsFor('discovery', GATES.noMonid!).map((t) => t.name));
    const p = buildSystemPrompt('discovery', DEFAULT_PITCH, '', { facts: [] }, { tools });
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
      {
        tools: new Set(toolsFor('reply', GATES.noResearch!).map((t) => t.name)),
      },
    );
    expect(reply).toContain('DOSSIÊ fraco num outbound e sem pesquisa externa nesta instalação');
    expect(reply).toContain('ORIGEM inbound (ela nos procurou)');
    const outreach = buildSystemPrompt(
      'outreach',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        tools: new Set(toolsFor('outreach', GATES.noResearch!).map((t) => t.name)),
      },
    );
    expect(outreach).toContain('sem pesquisa externa nesta instalação');
    expect(outreach).toContain('Não mande nada: create_task para humano');
    expect(outreach).not.toContain('a primeira mensagem já chega perguntando quem é');
  });

  test('channel args list only live channels; none → manual drafts only', () => {
    const def = (kind: string, name: string, gate: ToolGate) =>
      toolsFor(kind, gate).find((t) => t.name === name)!;
    const chan = (d: { parameters: Record<string, unknown> }) =>
      (d.parameters as { properties: { channel: { enum: string[] } } }).properties.channel.enum;
    const wa: ToolGate = { disabled: new Map(), channels: ['whatsapp'] };
    expect(chan(def('reply', 'send_message', wa))).toEqual(['whatsapp']);
    expect(chan(def('reply', 'draft_message', wa))).toEqual(['whatsapp', 'manual']);
    for (const gate of [GATES.noChannels!, TURN_GATES.leadBlocked!]) {
      const draft = def('triage', 'draft_message', gate);
      expect(chan(draft)).toEqual(['manual']);
      expect((draft.parameters as { required: string[] }).required).toContain('channel');
      const unsub = def('reply', 'unsubscribe', gate);
      expect((unsub.parameters as { properties: object }).properties).not.toHaveProperty('reply');
    }
    // the registry itself is untouched
    expect(chan(toolsFor('reply').find((t) => t.name === 'send_message')!)).toContain('email');
  });

  test('the prompt states which channels are live', () => {
    const none = buildSystemPrompt('reply', DEFAULT_PITCH, '', { facts: [] }, { channels: [] });
    expect(none).toContain('nenhum canal de envio (whatsapp/instagram/email) está conectado');
    const partial = buildSystemPrompt(
      'outreach',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        channels: ['whatsapp'],
      },
    );
    expect(partial).toContain('Desligado(s) nesta instalação: instagram, email');
    expect(partial).not.toContain('Instagram: DM frio');
    const full = buildSystemPrompt('outreach', DEFAULT_PITCH, '', { facts: [] });
    expect(full).not.toContain('Desligado');
  });
});
