import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { executeTool, bookDigest, type ToolContext } from '../src/agent/tools.ts';
import { MonidBudget } from '../src/agent/channels/monid.ts';

// book/plan never touch sql; monid tools hit fetch — stub it per test.
const ctx = (): ToolContext => ({
  sql: null as never,
  runId: 't',
  runKind: 'discovery',
  leadId: null,
  threadId: null,
  step: 0,
  pageCache: new Map(),
  briefName: null,
  leadCap: 20,
  channelOverride: null,
  book: new Map(),
  plan: null,
  monid: new MonidBudget(0.25),
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
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
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
    b.charge(0.008);
    expect(() => b.assertHeadroom(0.005)).toThrow(/monid budget/);
    expect(() => b.assertHeadroom(0.002)).not.toThrow();
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
      [{ name: 'Padaria X', phone: '+55 22 3343-4882', address: 'Rua A' }, { title: 'Doceria Y' }],
      (body) => (sent = body),
    );
    const c = ctx();
    const out = (await executeTool(c, 'm', 'maps_lookup', {
      query: 'padaria',
      city: 'Saquarema',
      limit: 2,
    })) as { candidates: { name: string | null; phone: string | null }[]; next: string[] };
    expect(sent).toContain('"location":"Saquarema, Brasil"');
    expect(out.candidates[0]!.phone).toBe('+55 22 3343-4882');
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
