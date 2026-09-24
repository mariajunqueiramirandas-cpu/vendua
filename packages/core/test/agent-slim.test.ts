import { describe, expect, test } from 'bun:test';
import { pricingFor } from '../src/agent/llm.ts';
import { replayJournal, slimToolOut } from '../src/agent/runner.ts';

const page = (text: string, extra: Record<string, unknown> = {}) => ({
  url: 'https://x.test/p',
  title: 'p',
  text,
  foundContacts: { phones: ['+5521'] },
  nav: [],
  ...extra,
});

describe('slimToolOut', () => {
  test('small results pass through unchanged', () => {
    const out = { ok: true, lead: { id: 'l1', name: 'padaria' } };
    expect(slimToolOut('get_lead', out)).toEqual(out);
    const pagesOut = { pages: [page('short body')] };
    expect(slimToolOut('read_pages', pagesOut)).toEqual(pagesOut);
  });

  test('a read_pages batch shares one text budget — no cap escape', () => {
    const out = {
      pages: Array.from({ length: 6 }, (_, i) =>
        page('x'.repeat(30_000), { url: `https://x.test/p${i}` }),
      ),
    };
    const slim = slimToolOut('read_pages', out) as {
      pages: Record<string, unknown>[];
    };
    const totalText = slim.pages.reduce((n, p) => n + String(p.text ?? '').length, 0);
    // 6×8K per-page caps alone would allow ~48K — the batch budget must
    // cut it below that while every page keeps its metadata.
    expect(totalText).toBeLessThan(48_000);
    expect(slim.pages).toHaveLength(6);
    for (const p of slim.pages) {
      expect(p.foundContacts).toEqual({ phones: ['+5521'] });
      expect(typeof p.textChars).toBe('number');
    }
    const last = String(slim.pages.at(-1)!.text);
    expect(last).toContain('read_pages offset:');
  });

  test('continuation marker prints base+cap so offset reads chain', () => {
    const out = {
      pages: [
        page('', {
          offset: 8_000,
          textChars: 30_000,
          text: 'z'.repeat(22_000),
        }),
      ],
    };
    const slim = slimToolOut('read_pages', out) as { pages: Record<string, unknown>[] };
    const first = slim.pages[0]!;
    expect(String(first.text)).toContain('read_pages offset:16000');
    expect(first.textChars).toBe(30_000);
  });

  test('oversized structured results keep records whole, not mid-JSON', () => {
    const out = {
      next: 'emit diretório para cada candidato',
      results: Array.from({ length: 40 }, (_, i) => ({
        name: `prospect-${i}`,
        snippet: 's'.repeat(3_000),
      })),
      errors: [{ url: 'https://x', error: 'captcha' }],
    };
    const slim = slimToolOut('web_search', out) as Record<string, unknown>;
    expect(slim.next).toBe(out.next); // outcome guidance survives the budget
    expect(slim.errors).toEqual(out.errors);
    const results = slim.results as Record<string, unknown>[];
    // records are never sliced mid-object — the tail drops with a marker.
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(40);
    for (const r of results.slice(0, -1)) {
      expect(typeof r.name).toBe('string');
    }
    expect(String(JSON.stringify(results.at(-1)))).toContain('omitted');
  });

  test('serialized bound drops tail pages as markers — valid JSON always', () => {
    // fat metadata makes the batch exceed hardMax even after text slimming
    const out = {
      pages: Array.from({ length: 6 }, (_, i) =>
        page('x'.repeat(9_000), {
          url: `https://x.test/p${i}`,
          description: 'd'.repeat(400),
          nav: Array.from({ length: 10 }, (_, j) => `https://x.test/nav${j}`),
        }),
      ),
    };
    const replayCaps = { page: 1_000, total: 2_400, str: 800, hardMax: 2_900 };
    const slim = slimToolOut('read_pages', out, replayCaps) as Record<string, unknown>;
    const json = JSON.stringify(slim);
    expect(json.length).toBeLessThanOrEqual(2_900);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(Array.isArray(slim.droppedPages)).toBe(true);
    const dropped = slim.droppedPages as Record<string, unknown>[];
    expect(dropped.every((d) => typeof d.url === 'string')).toBe(true);
  });

  test('replay under the flag keeps the continuation marker inside the cap', () => {
    const prior = [
      { type: 'model', content: null, toolCalls: [{ id: 'c1', name: 'read_pages', args: {} }] },
      {
        type: 'tool',
        name: 'read_pages',
        out: { pages: [page('x'.repeat(30_000))] },
      },
    ];
    const replay = replayJournal(prior, { slim: true });
    const toolMsg = replay.messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.content.length).toBeLessThanOrEqual(3_000);
    expect(toolMsg.content).toContain('read_pages offset:1000');
    expect(toolMsg.content).toContain('foundContacts');
  });

  test('replay under the flag never emits invalid JSON', () => {
    const fat = Array.from({ length: 6 }, (_, i) =>
      page('x'.repeat(9_000), {
        url: `https://x.test/p${i}`,
        description: 'd'.repeat(500),
        nav: Array.from({ length: 12 }, (_, j) => `https://x.test/n${j}`),
      }),
    );
    const prior = [
      { type: 'model', content: null, toolCalls: [{ id: 'c1', name: 'read_pages', args: {} }] },
      { type: 'tool', name: 'read_pages', out: { pages: fat } },
    ];
    const replay = replayJournal(prior, { slim: true });
    const toolMsg = replay.messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.content.length).toBeLessThanOrEqual(3_000);
    expect(() => JSON.parse(toolMsg.content)).not.toThrow();
  });

  test('replay without the flag is unchanged raw-prefix behavior', () => {
    const prior = [
      { type: 'model', content: null, toolCalls: [{ id: 'c1', name: 'read_pages', args: {} }] },
      { type: 'tool', name: 'read_pages', out: { pages: [page('x'.repeat(30_000))] } },
    ];
    const replay = replayJournal(prior);
    const toolMsg = replay.messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.content.length).toBeLessThanOrEqual(3_000);
    expect(toolMsg.content).not.toContain('read_pages offset:');
  });

  test('one oversized page slims its metadata — url + contacts survive', () => {
    // Tail-drop stops at one page; description/title can still overflow
    // hardMax alone, and a whole-result fallback would lose the read.
    const out = {
      pages: [
        page('x'.repeat(20_000), {
          description: 'd'.repeat(40_000),
          nav: ['https://x.test/contato'],
        }),
      ],
    };
    const replayCaps = { page: 1_000, total: 2_400, str: 800, hardMax: 2_900 };
    const slim = slimToolOut('read_pages', out, replayCaps) as Record<string, unknown>;
    const json = JSON.stringify(slim);
    expect(json.length).toBeLessThanOrEqual(2_900);
    const p = (slim.pages as Record<string, unknown>[])[0]!;
    expect(p.url).toBe('https://x.test/p');
    expect(p.foundContacts).toEqual({ phones: ['+5521'] });
    expect(String(p.text)).toContain('read_pages offset:');
  });

  test('fat nav never starves contacts — each gets its own budget slice', () => {
    // A fat nav list must not hide a small foundContacts behind a marker:
    // contacts keep their own allocation and nav trims to the remainder.
    const out = {
      pages: [
        page('x'.repeat(20_000), {
          foundContacts: { phones: ['+5521'] },
          nav: Array.from({ length: 200 }, (_, i) => `https://x.test/nav-${i}`),
        }),
      ],
    };
    const replayCaps = { page: 1_000, total: 2_400, str: 800, hardMax: 2_900 };
    const slim = slimToolOut('read_pages', out, replayCaps) as Record<string, unknown>;
    const json = JSON.stringify(slim);
    expect(json.length).toBeLessThanOrEqual(2_900);
    expect(() => JSON.parse(json)).not.toThrow();
    const p = (slim.pages as Record<string, unknown>[])[0]!;
    expect(p.url).toBe('https://x.test/p');
    expect(String(p.text)).toContain('read_pages offset:');
    expect(p.foundContacts).toEqual({ phones: ['+5521'] });
    // nav trims to the remainder with a count marker — contacts untouched
    const nav = p.nav as string[];
    expect(nav.length).toBeLessThan(200);
    expect(nav.at(-1)).toContain('journaled');
  });

  test('fat contacts degrade to a labeled marker — the head always survives', () => {
    const out = {
      pages: [
        page('x'.repeat(20_000), {
          foundContacts: {
            phones: Array.from({ length: 200 }, (_, i) => `+552199999${i}`),
            emails: Array.from({ length: 200 }, (_, i) => `lead${i}@x.test`),
          },
          nav: Array.from({ length: 60 }, (_, i) => `https://x.test/nav-${i}`),
        }),
      ],
    };
    const replayCaps = { page: 1_000, total: 2_400, str: 800, hardMax: 2_900 };
    const slim = slimToolOut('read_pages', out, replayCaps) as Record<string, unknown>;
    const json = JSON.stringify(slim);
    expect(json.length).toBeLessThanOrEqual(2_900);
    expect(() => JSON.parse(json)).not.toThrow();
    const p = (slim.pages as Record<string, unknown>[])[0]!;
    expect(p.url).toBe('https://x.test/p');
    expect(String(p.text)).toContain('read_pages offset:');
    expect(JSON.stringify(p.foundContacts)).toContain('omitted');
  });

  test('pathological identity falls back to url + read size', () => {
    // A ~3K url leaves no room even for essentials — the minimal fallback
    // keeps a url + size under the ceiling instead of the generic note.
    const out = {
      pages: [page('x'.repeat(20_000), { url: `https://x.test/${'u'.repeat(3_000)}` })],
    };
    const replayCaps = { page: 1_000, total: 2_400, str: 800, hardMax: 2_900 };
    const slim = slimToolOut('read_pages', out, replayCaps) as Record<string, unknown>;
    const json = JSON.stringify(slim);
    expect(json.length).toBeLessThanOrEqual(2_900);
    expect(() => JSON.parse(json)).not.toThrow();
    const p = (slim.pages as Record<string, unknown>[])[0]!;
    expect(String(p.url)).toContain('https://x.test/');
    expect(typeof p.textChars).toBe('number');
  });

  test('recovery primes chased pages without the chasedFrom marker', () => {
    // The live cache banks the raw page; a primed copy keeping chasedFrom
    // would make slicePage skip the offset on the next explicit read.
    const prior = [
      { type: 'model', content: null, toolCalls: [{ id: 'c1', name: 'read_pages', args: {} }] },
      {
        type: 'tool',
        name: 'read_pages',
        out: {
          pages: [
            page('x'.repeat(30_000), {
              url: 'https://linktr.ee/lead',
              chasedFrom: 'https://instagram.com/lead',
            }),
          ],
        },
      },
    ];
    const replay = replayJournal(prior);
    const rec = replay.pageCache.get('linktr.ee/lead') as
      Promise<{ page: Record<string, unknown> }> | undefined;
    expect(rec).toBeDefined();
    return rec!.then(({ page }) => {
      expect(page.chasedFrom).toBeUndefined();
      expect(String(page.text).length).toBe(30_000); // full body re-banked
    });
  });
});

describe('pricingFor', () => {
  test('openrouter provider/namespace strips; :free bills zero; other variants unknown', () => {
    const p = pricingFor('openai/gpt-4o-mini', {});
    expect(p?.in).toBe(0.15);
    // OpenRouter's :free contract bills $0 — not the paid table rate.
    expect(pricingFor('openai/gpt-4o-mini:free', {})).toEqual({
      in: 0,
      cached: 0,
      write: 0,
      out: 0,
    });
    // Other variants carry their own pricing — honest gap, not a fabricated rate.
    expect(pricingFor('openai/gpt-4o-mini:extended', {})).toBeNull();
  });

  test('unprefixed and anthropic ids match as before', () => {
    expect(pricingFor('gemini-3.5-flash-lite', {})?.cached).toBe(0.03);
    expect(pricingFor('claude-haiku-4-5', {})?.write).toBe(1.25);
  });

  test('negative/NaN config rates fall back to the table', () => {
    const bad = pricingFor('gemini-3.5-flash-lite', {
      pricing: { in: -1, out: Number.NaN },
    });
    expect(bad?.in).toBe(0.3); // table row, not the poisoned override
    expect(pricingFor('gemini-3.5-flash-lite', { pricing: { in: 0, out: 0 } })?.in).toBe(0);
  });

  test('partial override inherits the model cache rates — Anthropic bills them', () => {
    // in+out only on an Anthropic model: cached/write come from the table
    // row, not the input rate / zero — cache tokens stay priced.
    expect(pricingFor('claude-haiku-4-5', { pricing: { in: 3, out: 15 } })).toEqual({
      in: 3,
      cached: 0.1,
      write: 1.25,
      out: 15,
    });
    // Same partial override on an unknown model: nothing to inherit → reject.
    expect(pricingFor('my-unknown-model', { pricing: { in: 1, out: 2 } })).toBeNull();
    // On a :free id missing rates zero-fill — never the paid base row.
    expect(pricingFor('openai/gpt-4o-mini:free', { pricing: { in: 0, out: 0 } })).toEqual({
      in: 0,
      cached: 0,
      write: 0,
      out: 0,
    });
  });

  test('valid config override wins over the table', () => {
    const p = pricingFor('gemini-3.5-flash-lite', {
      pricing: { in: 9, cached: 0.9, write: 1.1, out: 99 },
    });
    expect(p).toEqual({ in: 9, cached: 0.9, write: 1.1, out: 99 });
  });

  test('unknown model returns null — an honest gap, not a fabrication', () => {
    expect(pricingFor('liquid/lfm-2.5-2.6b', {})).toBeNull();
  });
});
