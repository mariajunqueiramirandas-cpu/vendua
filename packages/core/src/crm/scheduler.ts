import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import {
  deliverStaffEvents,
  discordEnabledTx,
  discordNextAtTx,
} from '../modules/discord/deliver.ts';
import {
  discordDigestCadenceTx,
  discordDigestNextAtTx,
  sweepDiscordDigest,
} from '../modules/discord/digest.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { sweepPipelineSnapshots } from '../modules/forecast.ts';
import { nextReminderAtTx, sendMeetingReminders, syncMeetingEffects } from '../modules/meetings.ts';
import { log } from '../platform/log.ts';
import { sweepBriefs, sweepStrategist } from './board.ts';
import { adoptLegacy } from './legacy.ts';
import { agentSettingTx } from './policy.ts';
import { anchorTx } from './schedule-anchors.ts';

// The CRM's routines (ADR 0017): nothing polls. Each routine has a due time in the database;
// the loop sleeps until the earliest one, and Postgres notifications (migration 0048 triggers,
// delivered on commit) wake it the moment something changes. A reconcile pass every RECONCILE_MS
// is the safety net for a change nobody notified: when it finds work, that is a missed event and
// it says so in the log. The CRM agents' own work runs on Agent Runtime v3 (ADR 0030): its
// mailbox, timers and scheduler (agent-host/scheduler.ts); these routines only file the board's
// daily and weekly work into it.

const agentLog = log.child({ mod: 'scheduler' });

export const CHANNEL = 'vendua_agent';
export const RECONCILE_MS = 10 * 60_000;
/** notifications arrive in bursts (one per row) — one pass serves the burst */
const DEBOUNCE_MS = 250;
/** a reminder held by quiet hours / no reachable channel / a failed send */
const BLOCKED_REMINDER_RETRY_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** a notification: the table that changed and the lead it concerns (null = workspace-wide) */
export interface WakeEvent {
  t: string;
  l: string | null;
}

type Outcome = number | boolean | void | { n: number; retryInMs?: number | undefined };

export interface ScheduledJob {
  name: string;
  label: string;
  /** human cadence for the CRM */
  cadence: (tx: Sql) => Promise<string>;
  /** next time it has work by the clock (null = only when an event says so); `since` is
   *  when the pass that just ran started — work that came due after it still counts */
  nextAt?: (tx: Sql, since?: Date) => Promise<Date | null>;
  /** the changes that can give it work now */
  wakesOn?: (ev: WakeEvent) => boolean;
  /** recovery only — runs at boot and on the reconcile pass, never from events */
  reconcileOnly?: boolean;
  /** false = the job is switched off in settings (shown as such, still runs harmlessly) */
  enabled?: (tx: Sql) => Promise<boolean>;
  run: (sql: Sql) => Promise<Outcome>;
}

const on =
  (...tables: string[]) =>
  (ev: WakeEvent) =>
    tables.includes(ev.t);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const JOBS: readonly ScheduledJob[] = [
  {
    name: 'meeting-reminders',
    label: 'lembretes de reunião (24h e 1h antes)',
    cadence: async () => '24h e 1h antes de cada call',
    nextAt: nextReminderAtTx,
    wakesOn: on('meetings', 'control_settings'),
    run: async (sql) => {
      const r = await sendMeetingReminders(sql);
      return { n: r.sent, retryInMs: r.blocked ? BLOCKED_REMINDER_RETRY_MS : undefined };
    },
  },
  {
    name: 'meeting-sync',
    label: 'reuniões — salas e Google Agenda em dia',
    cadence: async () => 'verificação a cada 10 min',
    reconcileOnly: true,
    run: syncMeetingEffects,
  },
  {
    name: 'briefs',
    label: 'briefs de descoberta',
    cadence: async (tx) => `todo dia às ${hh((await agentSettingTx(tx)).schedule.discoveryHour)}`,
    nextAt: async (tx) =>
      (await anchorTx(tx, { hour: (await agentSettingTx(tx)).schedule.discoveryHour })).next,
    // a new/re-armed brief runs right away
    wakesOn: on('control_settings', 'discovery_briefs'),
    enabled: async (tx) => {
      const a = await agentSettingTx(tx);
      return a.level !== 'off' && a.jobs.discovery;
    },
    run: sweepBriefs,
  },
  {
    name: 'weekly-review',
    label: 'revisão semanal do funil',
    cadence: async (tx) => {
      const { weeklyDay, weeklyHour } = (await agentSettingTx(tx)).schedule;
      return `toda ${WEEKDAY[weeklyDay]} às ${hh(weeklyHour)}`;
    },
    nextAt: async (tx) => {
      const { weeklyDay, weeklyHour } = (await agentSettingTx(tx)).schedule;
      return (await anchorTx(tx, { hour: weeklyHour, weekday: weeklyDay })).next;
    },
    wakesOn: on('control_settings'),
    enabled: async (tx) => {
      const a = await agentSettingTx(tx);
      return a.level !== 'off' && a.jobs.strategist;
    },
    run: sweepStrategist,
  },
  {
    name: 'pipeline-snapshot',
    label: 'foto diária do funil',
    cadence: async () => 'todo dia à meia-noite',
    nextAt: async (tx) => (await anchorTx(tx, { hour: 0 })).next,
    wakesOn: on('control_settings'),
    run: sweepPipelineSnapshots,
  },
  {
    name: 'discord',
    label: 'avisos da equipe no Discord',
    cadence: async () => 'na hora de cada evento',
    nextAt: discordNextAtTx,
    // a new staff event, or the bot's config changing
    wakesOn: on('staff_events', 'control_integrations', 'control_settings'),
    enabled: discordEnabledTx,
    run: (sql) => deliverStaffEvents(sql),
  },
  {
    name: 'discord-digest',
    label: 'resumo diário no Discord',
    cadence: discordDigestCadenceTx,
    nextAt: discordDigestNextAtTx,
    wakesOn: on('control_settings', 'control_integrations'),
    enabled: discordEnabledTx,
    run: sweepDiscordDigest,
  },
  {
    name: 'legacy-adopt',
    label: 'migração — trabalho pendente do agente antigo para o runtime v3',
    cadence: async () => 'no boot e na reconciliação',
    reconcileOnly: true,
    run: adoptLegacy,
  },
];

const asCount = (r: Outcome): number =>
  typeof r === 'number' ? r : typeof r === 'boolean' ? (r ? 1 : 0) : r ? r.n : 0;

async function record(
  sql: Sql,
  name: string,
  started: Date,
  outcome: { ok: true; result: number } | { ok: false; error: string },
): Promise<void> {
  const ok = outcome.ok;
  const result = outcome.ok ? outcome.result : null;
  const error = outcome.ok ? null : outcome.error.slice(0, 1000);
  await controlTx(sql, async (tx) => {
    const [prev] = await tx<{ failing_since: Date | null }[]>`
      select failing_since from scheduled_jobs where name = ${name} for update
    `;
    await tx`
      insert into scheduled_jobs as j
        (name, last_started_at, last_finished_at, last_ok, last_error, last_result,
         last_work_at, failing_since, runs, failures)
      values (${name}, ${started}, now(), ${ok}, ${error}, ${result},
              case when ${result ?? 0}::int > 0 then now() end,
              case when ${ok} then null else now() end, 1, ${ok ? 0 : 1})
      on conflict (name) do update set
        last_started_at = excluded.last_started_at,
        last_finished_at = excluded.last_finished_at,
        last_ok = excluded.last_ok,
        last_error = excluded.last_error,
        last_result = excluded.last_result,
        last_work_at = coalesce(excluded.last_work_at, j.last_work_at),
        failing_since = case when ${ok} then null else coalesce(j.failing_since, now()) end,
        runs = j.runs + 1,
        failures = j.failures + ${ok ? 0 : 1}
    `;
    await staffJobEventTx(tx, name, prev?.failing_since ?? null, error);
  }).catch((e) => agentLog.warn({ err: e, job: name }, 'could not record job run'));
}

/** a job still failing this long (≥2 runs, with the backoff) is worth telling the team */
const FAILING_ALERT_MS = 2 * 60_000;

/** One `job.failing` per failing episode, and a `job.recovered` only for an alerted one. */
async function staffJobEventTx(
  tx: Sql,
  name: string,
  failingSince: Date | null,
  error: string | null,
): Promise<void> {
  if (!failingSince) return;
  const label = JOBS.find((j) => j.name === name)?.label ?? name;
  const episode = `job.failing:${name}:${new Date(failingSince).getTime()}`;
  if (error !== null) {
    if (Date.now() - new Date(failingSince).getTime() < FAILING_ALERT_MS) return;
    await recordStaffEventTx(
      tx,
      'job.failing',
      { job: name, label, error },
      { dedupeKey: episode },
    );
    return;
  }
  const alerted = await tx`select 1 from staff_events where dedupe_key = ${episode}`;
  if (alerted[0])
    await recordStaffEventTx(
      tx,
      'job.recovered',
      { job: name, label, failingSince: new Date(failingSince).toISOString() },
      { dedupeKey: `job.recovered:${name}:${new Date(failingSince).getTime()}` },
    );
}

type JobRun = { ok: true; n: number; retryInMs?: number | undefined } | { ok: false };

async function execJob(sql: Sql, job: Pick<ScheduledJob, 'name' | 'run'>): Promise<JobRun> {
  const started = new Date();
  try {
    const out = await job.run(sql);
    const n = asCount(out);
    await record(sql, job.name, started, { ok: true, result: n });
    return { ok: true, n, retryInMs: typeof out === 'object' && out ? out.retryInMs : undefined };
  } catch (e) {
    agentLog.error({ err: e, job: job.name }, 'scheduled job failed');
    await record(sql, job.name, started, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false };
  }
}

/** Run one job isolated — its failure is recorded and logged, never thrown. */
export async function runJob(sql: Sql, job: Pick<ScheduledJob, 'name' | 'run'>): Promise<boolean> {
  return (await execJob(sql, job)).ok;
}

/** A loop that sleeps until a due time or a poke — never on a fixed tick. */
class Loop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private wantAt = Infinity;
  running: Promise<void> | null = null;
  stopped = false;

  constructor(
    private readonly name: string,
    private readonly body: () => Promise<Date | null>,
  ) {}

  poke(delayMs = DEBOUNCE_MS) {
    this.at(Date.now() + delayMs);
  }

  at(when: number) {
    if (this.stopped || !Number.isFinite(when)) return;
    // mid-pass: the pass reads state as it goes, so fold the request into what runs after
    if (this.running) {
      this.wantAt = Math.min(this.wantAt, when);
      return;
    }
    if (when >= this.timerAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = when;
    this.timer = setTimeout(
      () => this.fire(),
      Math.min(Math.max(0, when - Date.now()), MAX_TIMEOUT_MS),
    );
    this.timer.unref?.();
  }

  private fire() {
    this.timer = null;
    this.timerAt = Infinity;
    this.running = (async () => {
      let next: number;
      try {
        next = (await this.body())?.getTime() ?? Infinity;
      } catch (e) {
        agentLog.error({ err: e, loop: this.name }, 'scheduler pass failed');
        next = Date.now() + 30_000;
      }
      this.running = null;
      const want = this.wantAt;
      this.wantAt = Infinity;
      this.at(Math.min(next, want));
    })();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

interface SchedulerState {
  sql: Sql;
  jobList: readonly ScheduledJob[];
  jobs: Loop;
  /** jobs an event (or boot/reconnect) asked to run */
  dirtyJobs: Set<string>;
  /** jobs only the reconcile asked to run — work found there is a missed event */
  reconcileJobs: Set<string>;
  /** per job: next due by the clock, including its retry */
  jobNext: Map<string, number>;
  failStreak: Map<string, number>;
  reconcileTimer: ReturnType<typeof setTimeout> | null;
  unlisten: (() => Promise<void>) | null;
  stopped: boolean;
}

let state: SchedulerState | null = null;

function onEvent(s: SchedulerState, ev: WakeEvent) {
  let jobs = false;
  for (const j of s.jobList) {
    if (!j.reconcileOnly && j.wakesOn?.(ev)) {
      s.dirtyJobs.add(j.name);
      jobs = true;
    }
  }
  if (jobs) s.jobs.poke();
}

/** boot, a reconnected listener (notifications may have been lost) — everything, now */
function wakeAll(s: SchedulerState) {
  for (const j of s.jobList) s.dirtyJobs.add(j.name);
  s.jobs.poke(0);
}

const failBackoff = (streak: number) => Math.min(30_000 * 2 ** (streak - 1), RECONCILE_MS);

async function jobPass(s: SchedulerState): Promise<Date | null> {
  const sql = s.sql;
  const now = Date.now();
  const due = s.jobList.filter(
    (j) =>
      s.dirtyJobs.has(j.name) ||
      s.reconcileJobs.has(j.name) ||
      (s.jobNext.get(j.name) ?? Infinity) <= now + 50,
  );
  const missedOnly = new Set(
    due
      .filter(
        (j) =>
          !j.reconcileOnly &&
          s.reconcileJobs.has(j.name) &&
          !s.dirtyJobs.has(j.name) &&
          (s.jobNext.get(j.name) ?? Infinity) > now + 50,
      )
      .map((j) => j.name),
  );
  for (const j of due) {
    s.dirtyJobs.delete(j.name);
    s.reconcileJobs.delete(j.name);
  }
  for (const j of due) {
    const started = Date.now();
    const out = await execJob(sql, j);
    let retry = Infinity;
    if (!out.ok) {
      const streak = (s.failStreak.get(j.name) ?? 0) + 1;
      s.failStreak.set(j.name, streak);
      retry = Date.now() + failBackoff(streak);
    } else {
      s.failStreak.delete(j.name);
      if (out.retryInMs) retry = Date.now() + out.retryInMs;
      if (out.n > 0 && missedOnly.has(j.name)) {
        agentLog.warn(
          { job: j.name, result: out.n },
          'reconcile found due work — a change went un-notified',
        );
      }
    }
    let next = Infinity;
    if (j.nextAt) {
      next = await controlTx(sql, (tx) => j.nextAt!(tx, new Date(started)))
        .then((d) => d?.getTime() ?? Infinity)
        .catch((e) => {
          agentLog.warn({ err: e, job: j.name }, 'could not compute next due time');
          return Date.now() + 30_000;
        });
    }
    // came due while the pass ran (it started before the due time — early timer, the
    // driver's ms truncation, an event just before): the pass couldn't see it, run again now.
    // `>=`: next is truncated to the ms, so a row due within the pass's first ms reads as equal
    // (a parked one costs at most one extra pass — the next one starts after it)
    if (out.ok && next >= started && next <= Date.now()) next = Date.now();
    // still "due now" right after running would spin: after a failure the backoff decides;
    // after a success it's a nextAt bug, not work
    else if (next <= Date.now()) {
      if (out.ok) agentLog.warn({ job: j.name }, 'job still due right after running — backing off');
      next = out.ok ? Date.now() + 30_000 : Infinity;
    }
    s.jobNext.set(j.name, Math.min(next, retry));
  }
  const soonest = Math.min(...s.jobList.map((j) => s.jobNext.get(j.name) ?? Infinity));
  return Number.isFinite(soonest) ? new Date(soonest) : null;
}

function scheduleReconcile(s: SchedulerState) {
  s.reconcileTimer = setTimeout(() => {
    if (s.stopped) return;
    for (const j of s.jobList) s.reconcileJobs.add(j.name);
    s.jobs.poke(0);
    scheduleReconcile(s);
  }, RECONCILE_MS);
  s.reconcileTimer.unref?.();
}

async function listen(s: SchedulerState): Promise<void> {
  for (let attempt = 0; !s.stopped; attempt++) {
    try {
      const sub = await s.sql.listen(
        CHANNEL,
        (payload) => {
          let ev: WakeEvent;
          try {
            ev = JSON.parse(payload) as WakeEvent;
          } catch {
            return;
          }
          if (typeof ev?.t === 'string') onEvent(s, ev);
        },
        // first subscribe and every reconnect: anything sent while we weren't listening is lost
        () => wakeAll(s),
      );
      s.unlisten = sub.unlisten;
      if (s.stopped) await sub.unlisten().catch(() => {});
      return;
    } catch (e) {
      const waitMs = Math.min(1000 * 2 ** attempt, 60_000);
      agentLog.error({ err: e, waitMs }, 'scheduler could not LISTEN — retrying');
      // meanwhile the loops still run on their due times and the reconcile
      wakeAll(s);
      await new Promise((r) => setTimeout(r, waitMs).unref?.());
    }
  }
}

/** `only` narrows what runs (tests): a subset of the jobs. */
export function startScheduler(sql: Sql, only?: { jobs?: string[] }): void {
  if (state) return;
  const s: SchedulerState = {
    sql,
    jobList: only?.jobs ? JOBS.filter((j) => only.jobs!.includes(j.name)) : JOBS,
    jobs: null as unknown as Loop,
    dirtyJobs: new Set(),
    reconcileJobs: new Set(),
    jobNext: new Map(),
    failStreak: new Map(),
    reconcileTimer: null,
    unlisten: null,
    stopped: false,
  };
  s.jobs = new Loop('jobs', () => jobPass(s));
  state = s;
  scheduleReconcile(s);
  void listen(s);
}

/** Stop the loop and let the pass in hand finish (bounded). */
export async function stopScheduler(graceMs = 25_000): Promise<void> {
  const s = state;
  state = null;
  if (!s) return;
  s.stopped = true;
  s.jobs.stop();
  if (s.reconcileTimer) clearTimeout(s.reconcileTimer);
  await s.unlisten?.().catch(() => {});
  const inFlight = [s.jobs.running].filter(Boolean) as Promise<unknown>[];
  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise((r) => setTimeout(r, graceMs).unref?.()),
  ]);
}

export interface Routine {
  name: string;
  label: string;
  cadence: string;
  enabled: boolean;
  nextAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastResult: number | null;
  lastWorkAt: string | null;
  failingSince: string | null;
  runs: number;
  failures: number;
}

type JobRow = {
  name: string;
  last_started_at: Date | null;
  last_finished_at: Date | null;
  last_ok: boolean | null;
  last_error: string | null;
  last_result: number | null;
  last_work_at: Date | null;
  failing_since: Date | null;
  runs: string;
  failures: string;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** GET /agent/routines — every routine with its schedule and last recorded run */
export async function listRoutines(sql: Sql): Promise<Routine[]> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<JobRow[]>`select * from scheduled_jobs`;
    const byName = new Map(rows.map((r) => [r.name, r]));
    const out: Routine[] = [];
    for (const job of JOBS) {
      const { name, label } = job;
      const r = byName.get(name);
      out.push({
        name,
        label,
        cadence: await job.cadence(tx),
        enabled: job.enabled ? await job.enabled(tx) : true,
        nextAt: job.nextAt ? iso(await job.nextAt(tx)) : null,
        lastStartedAt: iso(r?.last_started_at ?? null),
        lastFinishedAt: iso(r?.last_finished_at ?? null),
        lastOk: r?.last_ok ?? null,
        lastError: r?.last_error ?? null,
        lastResult: r?.last_result ?? null,
        lastWorkAt: iso(r?.last_work_at ?? null),
        failingSince: iso(r?.failing_since ?? null),
        runs: Number(r?.runs ?? 0),
        failures: Number(r?.failures ?? 0),
      });
    }
    return out;
  });
}
