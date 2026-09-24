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
});

describe('pricingFor', () => {
  test('openrouter provider/namespace + :variant suffix still price-match', () => {
    const p = pricingFor('openai/gpt-4o-mini', {});
    expect(p?.in).toBe(0.15);
    const f = pricingFor('openai/gpt-4o-mini:free', {});
    expect(f?.out).toBe(0.6);
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
