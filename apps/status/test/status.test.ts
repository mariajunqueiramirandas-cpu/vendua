import { describe, expect, test } from 'bun:test';
import { best, checkComponent, runCheck, worst, type CheckResult } from '../src/check.ts';
import { config } from '../src/config.ts';
import { DAYS, empty, parseHistory, record, type Incident } from '../src/history.ts';
import { pct, render, summarize } from '../src/render.ts';

const reply =
  (status: number, body: string, headers: Record<string, string> = {}) =>
  async () =>
    new Response(body, { status, headers });

describe('checks', () => {
  test('a 200 with the expected text is ok; a missing marker is down after every attempt', async () => {
    let calls = 0;
    const page = async () => {
      calls++;
      return new Response('<script id="vendua-state">');
    };
    expect((await runCheck({ url: 'u', text: 'id="vendua-state"' }, page, 0)).state).toBe('ok');
    expect(calls).toBe(1);
    const r = await runCheck({ url: 'u', text: 'nope' }, page, 0);
    expect(r.state).toBe('down');
    expect(calls).toBe(4);
  });

  test('a stale edge answer is down, a Cloudflare challenge is unknown, bad JSON is down', async () => {
    const json = (b: unknown) => typeof b === 'object' && b !== null && 'store' in b;
    expect(
      (
        await runCheck(
          { url: 'u', json },
          reply(200, '{"store":{}}', { 'x-vendua-edge-stale': '1' }),
          0,
        )
      ).state,
    ).toBe('down');
    expect(
      (await runCheck({ url: 'u' }, reply(403, 'challenge', { 'cf-mitigated': 'challenge' }), 0))
        .state,
    ).toBe('unknown');
    expect((await runCheck({ url: 'u', json }, reply(200, '<html>'), 0)).state).toBe('down');
    expect((await runCheck({ url: 'u', json }, reply(200, '{"store":{}}'), 0)).state).toBe('ok');
    expect((await runCheck({ url: 'u' }, reply(502, 'bad gateway'), 0)).detail).toContain('502');
  });

  test('one failure then success is ok: a blip is not an outage', async () => {
    let n = 0;
    const flaky = async () => {
      if (n++ === 0) throw new Error('reset');
      return new Response('ok');
    };
    expect((await runCheck({ url: 'u' }, flaky, 0)).state).toBe('ok');
  });

  test('a component is its worst known check', () => {
    const r = (state: CheckResult['state']): CheckResult => ({ state, ms: 1 });
    expect(worst([r('ok'), r('slow')]).state).toBe('slow');
    expect(worst([r('slow'), r('down'), r('ok')]).state).toBe('down');
    expect(worst([r('unknown'), r('ok')]).state).toBe('ok');
    expect(worst([r('unknown'), r('unknown')]).state).toBe('unknown');
  });

  test('stores are probed on any of the fleet: one answering is enough', async () => {
    const r = (state: CheckResult['state']): CheckResult => ({ state, ms: 1 });
    expect(best([r('down'), r('slow'), r('ok')]).state).toBe('ok');
    expect(best([r('down'), r('slow')]).state).toBe('slow');
    expect(best([r('down'), r('down')]).state).toBe('down');
    expect(best([r('down'), r('unknown')]).state).toBe('unknown');
    const lojas = config({}, ['gone.vendua.com.br', 'live.vendua.com.br']).components[0]!;
    const fetchFn = async (url: string) =>
      url.includes('live.')
        ? new Response('<div id="vendua-state">')
        : new Response('{}', { status: 404 });
    expect((await checkComponent(lojas, fetchFn, 0)).state).toBe('ok');
  });

  test('no store to probe is unknown, not an outage', async () => {
    const [lojas, pedidos] = config({}, []).components;
    const never = async () => {
      throw new Error('unreachable');
    };
    expect((await checkComponent(lojas!, never, 0)).state).toBe('unknown');
    expect((await checkComponent(pedidos!, never, 0)).state).toBe('unknown');
  });

  test('STATUS_STORE_HOST pins the probe to one store', () => {
    const lojas = config({ STATUS_STORE_HOST: 'a.vendua.com.br' }, ['b.vendua.com.br'])
      .components[0]!;
    expect(lojas.checks.map((c) => c.url)).toEqual(['https://a.vendua.com.br/']);
  });
});

describe('history', () => {
  const ok: CheckResult = { state: 'ok', ms: 10 };
  const down: CheckResult = { state: 'down', ms: null };
  const t = (iso: string) => new Date(iso);

  test('counts runs per Brasília day and keeps `since` while the state holds', () => {
    // 01:00 UTC is still the previous day in Brasília
    let h = record(empty(), t('2026-09-30T01:00:00Z'), { lojas: ok }, []);
    h = record(h, t('2026-09-30T12:00:00Z'), { lojas: ok }, null);
    h = record(h, t('2026-09-30T12:05:00Z'), { lojas: down }, null);
    h = record(h, t('2026-09-30T12:10:00Z'), { lojas: down }, null);
    const c = h.components.lojas!;
    expect(c.days).toEqual([
      { date: '2026-09-29', ok: 1, slow: 0, down: 0 },
      { date: '2026-09-30', ok: 1, slow: 0, down: 2 },
    ]);
    expect(c.state).toBe('down');
    expect(c.since).toBe('2026-09-30T12:05:00.000Z');
  });

  test('unknown runs are not counted, and days past the window drop off', () => {
    let h = record(empty(), t('2026-01-01T15:00:00Z'), { site: ok }, []);
    h = record(h, t('2026-01-02T15:00:00Z'), { site: { state: 'unknown', ms: null } }, null);
    expect(h.components.site!.days).toHaveLength(1);
    h = record(
      h,
      new Date(Date.parse('2026-01-01T15:00:00Z') + DAYS * 86_400_000),
      { site: ok },
      null,
    );
    expect(h.components.site!.days.map((d) => d.date)).toEqual(['2026-04-01']);
  });

  test('incidents stay from the last good fetch when Core does not answer', () => {
    const inc: Incident = {
      id: 'a',
      title: 'Pix com atraso',
      body: null,
      severity: 'degraded',
      startedAt: '2026-09-30T12:00:00Z',
      resolvedAt: null,
    };
    const a = record(empty(), t('2026-09-30T12:00:00Z'), {}, [inc]);
    const b = record(a, t('2026-09-30T12:05:00Z'), {}, null);
    expect(b.incidents).toEqual([inc]);
    expect(b.incidentsAt).toBe(a.incidentsAt);
  });

  test('only our own history parses', () => {
    const h = record(empty(), new Date(), { site: ok }, []);
    expect(parseHistory(JSON.stringify(h))).toEqual(h);
    expect(parseHistory('<html>loja não encontrada</html>')).toBeNull();
    expect(parseHistory('{"version":2}')).toBeNull();
  });
});

describe('page', () => {
  const specs = config({}).components;
  const now = new Date('2026-09-30T17:32:00Z');
  const all = (state: CheckResult['state']) =>
    Object.fromEntries(specs.map((s) => [s.id, { state, ms: 1 }]));

  test('the headline is the worst of the checks and the open incidents', () => {
    const inc = (severity: Incident['severity'], resolvedAt: string | null = null): Incident => ({
      id: severity,
      title: 't',
      body: null,
      severity,
      startedAt: now.toISOString(),
      resolvedAt,
    });
    expect(summarize(empty(), specs).title).toBe('Ainda sem verificação');
    expect(summarize(record(empty(), now, all('ok'), []), specs).tone).toBe('success');
    expect(summarize(record(empty(), now, all('ok'), [inc('info')]), specs).tone).toBe('success');
    expect(
      summarize(record(empty(), now, all('ok'), [inc('outage', now.toISOString())]), specs).tone,
    ).toBe('success');
    expect(summarize(record(empty(), now, all('ok'), [inc('degraded')]), specs).tone).toBe(
      'warning',
    );
    expect(summarize(record(empty(), now, all('ok'), [inc('outage')]), specs).title).toBe(
      'Parte da Venduá está fora do ar',
    );
    expect(summarize(record(empty(), now, all('down'), []), specs).title).toBe(
      'A Venduá está fora do ar',
    );
  });

  test('staff text is escaped', () => {
    const h = record(empty(), now, all('ok'), [
      {
        id: 'x',
        title: '<img src=x onerror=alert(1)>',
        body: 'a & "b"',
        severity: 'outage',
        startedAt: now.toISOString(),
        resolvedAt: null,
      },
    ]);
    const html = render(h, specs, 'https://painel.vendua.com.br', now);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('a &amp; &quot;b&quot;');
    expect(html.match(/class="bar /g)).toHaveLength(DAYS * specs.length);
  });

  test('percentages round down, pt-BR', () => {
    expect(pct(1)).toBe('100%');
    expect(pct(0.99999)).toBe('99,99%');
    expect(pct(0.5)).toBe('50%');
  });
});
