import type { CheckResult, State } from './check.ts';
import type { ComponentId } from './config.ts';

// The page's memory lives in the page: each run reads the published history.json, adds its
// results and publishes both again, so nothing is committed back to the repo.

export const DAYS = 90;
export const TZ = 'America/Sao_Paulo';

export interface Incident {
  id: string;
  title: string;
  body: string | null;
  severity: 'info' | 'degraded' | 'outage';
  startedAt: string;
  resolvedAt: string | null;
}

/** one day (Brasília) of runs; `unknown` runs aren't counted */
export interface Day {
  date: string;
  ok: number;
  slow: number;
  down: number;
}

export interface ComponentHistory {
  state: State;
  /** when the current state began */
  since: string;
  checkedAt: string;
  days: Day[];
}

export interface History {
  version: 1;
  updatedAt: string;
  components: Partial<Record<ComponentId, ComponentHistory>>;
  incidents: Incident[];
  /** the last time Core's feed answered: the incidents shown are from then */
  incidentsAt: string | null;
}

export const empty = (): History => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  components: {},
  incidents: [],
  incidentsAt: null,
});

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const dayOf = (d: Date) => dayFmt.format(d);

/** Parses a published history.json; anything that isn't one of ours is null. */
export function parseHistory(text: string): History | null {
  try {
    const h = JSON.parse(text) as History;
    if (h?.version !== 1 || typeof h.components !== 'object' || !Array.isArray(h.incidents))
      return null;
    return h;
  } catch {
    return null;
  }
}

export function record(
  prev: History,
  now: Date,
  results: Partial<Record<ComponentId, CheckResult>>,
  incidents: Incident[] | null,
): History {
  const at = now.toISOString();
  const today = dayOf(now);
  const oldest = dayOf(new Date(now.getTime() - (DAYS - 1) * 86_400_000));
  const components: History['components'] = {};
  for (const [id, r] of Object.entries(results) as [ComponentId, CheckResult][]) {
    const before = prev.components[id];
    const days = (before?.days ?? []).filter((d) => d.date >= oldest && d.date <= today);
    if (r.state !== 'unknown') {
      let d = days.find((x) => x.date === today);
      if (!d) days.push((d = { date: today, ok: 0, slow: 0, down: 0 }));
      d[r.state]++;
    }
    components[id] = {
      state: r.state,
      since: before && before.state === r.state ? before.since : at,
      checkedAt: at,
      days,
    };
  }
  return {
    version: 1,
    updatedAt: at,
    components,
    incidents: incidents ?? prev.incidents,
    incidentsAt: incidents ? at : prev.incidentsAt,
  };
}

/** Share of a day's runs that answered (slow counts as answered). */
export const uptime = (d: Pick<Day, 'ok' | 'slow' | 'down'>) => {
  const n = d.ok + d.slow + d.down;
  return n ? (d.ok + d.slow) / n : null;
};

export function uptimeOver(days: Day[]) {
  return uptime(
    days.reduce((a, d) => ({ ok: a.ok + d.ok, slow: a.slow + d.slow, down: a.down + d.down }), {
      ok: 0,
      slow: 0,
      down: 0,
    }),
  );
}
