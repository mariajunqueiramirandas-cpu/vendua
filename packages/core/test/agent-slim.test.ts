import { describe, expect, test } from 'bun:test';
import { slimToolOut } from '../src/agent/runner.ts';

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
    expect(String(slim.pages[0].text)).toContain('read_pages offset:16000');
    expect(slim.pages[0].textChars).toBe(30_000);
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
});
