import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkComponent, type CheckResult } from './check.ts';
import { config, type ComponentId } from './config.ts';
import { empty, parseHistory, record, type History, type Incident } from './history.ts';
import { render } from './render.ts';

// One run: read the published history, check everything, fetch staff incidents, write build/.
// STATUS_HISTORY_URL (default <public url>/history.json) or STATUS_HISTORY_FILE is the history.

const cfg = config();
const out = process.env.STATUS_OUT || join(import.meta.dir, '..', 'build');
const gha = process.env.GITHUB_ACTIONS === 'true';
const warn = (m: string) => console.log(gha ? `::warning::${m}` : `warning: ${m}`);

async function previous(): Promise<History> {
  const file = process.env.STATUS_HISTORY_FILE;
  if (file) {
    const f = Bun.file(file);
    if (!(await f.exists())) return empty();
    const h = parseHistory(await f.text());
    if (!h) throw new Error(`${file} is not a status history`);
    return h;
  }
  const url = process.env.STATUS_HISTORY_URL || `${cfg.publicUrl}/history.json`;
  const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
  // first publish: nothing there yet
  if (res.status === 404) {
    warn(`no history at ${url}; starting a new one`);
    return empty();
  }
  // anything else would wipe 90 days of history: fail, and the last published page stays up
  if (!res.ok) throw new Error(`history ${url}: HTTP ${res.status}`);
  const h = parseHistory(await res.text());
  if (!h) throw new Error(`history ${url}: not a status history`);
  return h;
}

const SEVERITIES = new Set(['info', 'degraded', 'outage']);
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Core's feed, validated; null when it didn't answer (the last known incidents stay). */
async function incidents(): Promise<Incident[] | null> {
  try {
    const res = await fetch(cfg.incidentsUrl, {
      headers: { 'user-agent': 'VenduaStatus/1 (+https://status.vendua.com.br)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { incidents?: unknown };
    if (!Array.isArray(body.incidents)) throw new Error('no incidents array');
    return body.incidents
      .filter(
        (i): i is Incident =>
          typeof i === 'object' &&
          i !== null &&
          str(i.id, 64) &&
          str(i.title, 120) &&
          (i.body === null || str(i.body, 1000)) &&
          SEVERITIES.has(i.severity) &&
          str(i.startedAt, 40) &&
          (i.resolvedAt === null || str(i.resolvedAt, 40)),
      )
      .slice(0, 50)
      .map(({ id, title, body, severity, startedAt, resolvedAt }) => ({
        id,
        title,
        body,
        severity,
        startedAt,
        resolvedAt,
      }));
  } catch (e) {
    warn(`incidents ${cfg.incidentsUrl}: ${(e as Error).message}`);
    return null;
  }
}

const prev = await previous();
const [results, feed] = await Promise.all([
  Promise.all(cfg.components.map(async (c) => [c.id, await checkComponent(c)] as const)),
  incidents(),
]);
for (const [id, r] of results) {
  console.log(`${id}: ${r.state}${r.ms === null ? '' : ` ${r.ms} ms`}`);
  if (r.detail) warn(`${id}: ${r.detail}`);
}

const h = record(
  prev,
  new Date(),
  Object.fromEntries(results) as Record<ComponentId, CheckResult>,
  feed,
);
await mkdir(out, { recursive: true });
await cp(join(import.meta.dir, '..', 'static'), out, { recursive: true });
await writeFile(join(out, 'history.json'), JSON.stringify(h));
await writeFile(join(out, 'index.html'), render(h, cfg.components, cfg.adminOrigin));
console.log(`wrote ${out}`);
