import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { executeTool, bookDigest, toolsFor, type ToolContext } from '../src/agent/tools.ts';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { DEFAULT_PITCH } from '../src/modules/integrations.ts';
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

describe('unconfigured tools — hidden, refused, and named in the prompt', () => {
  const off = new Map([
    ['serp', 'MONID_API_KEY não configurada'],
    ['maps_lookup', 'MONID_API_KEY não configurada'],
    ['instagram_profile', 'MONID_API_KEY não configurada'],
  ]);

  test('toolsFor drops disabled tools', () => {
    const names = toolsFor('discovery', off).map((t) => t.name);
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

  test('the prompt drops their arsenal lines and says they do not exist', () => {
    const p = buildSystemPrompt(
      'discovery',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        disabledTools: [...off.keys()],
      },
    );
    expect(p).not.toContain('- maps_lookup(query, city)');
    expect(p).not.toContain('- serp(query)');
    expect(p).toContain('- web_search(query, purpose)');
    expect(p).toContain(
      'FERRAMENTAS DESATIVADAS nesta instalação: serp, maps_lookup, instagram_profile',
    );
    const full = buildSystemPrompt('discovery', DEFAULT_PITCH, '', { facts: [] });
    expect(full).not.toContain('FERRAMENTAS DESATIVADAS');
  });

  test('no research at all → lead kinds are told to ask instead', () => {
    const p = buildSystemPrompt(
      'reply',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        disabledTools: ['web_search', 'read_pages', 'serp'],
      },
    );
    expect(p).toContain('pergunte à pessoa o que falta');
  });
});
