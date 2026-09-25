import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { sweepDigest, digestConfigTx } from '../modules/digest.ts';
import { sweepPipelineSnapshots } from '../modules/forecast.ts';
import { sweepMeetingReminders } from '../modules/meetings.ts';
import { log } from '../platform/log.ts';
import { agentSettingTx } from './policy.ts';
import { drain, flagCappedLeads, stopClaims, sweepBriefs, sweepStrategist } from './runner.ts';
import { anchorTx } from './schedule-anchors.ts';
import { sweepWakeups } from './wakeups.ts';

// The scheduler (ADR 0016): two loops that never wait on each other — the work loop runs
// agent runs (minutes each), the job loop runs the recurring routines (seconds each), so a
// long run can't make a meeting reminder late. Each job is isolated: one failing never
// skips the others, and every run is recorded in scheduled_jobs for the CRM.

const agentLog = log.child({ mod: 'scheduler' });

export const TICK_MS = 15_000;

type Result = number | boolean | void;

export interface ScheduledJob {
  name: string;
  label: string;
  /** human cadence for the CRM */
  cadence: (tx: Sql) => Promise<string>;
  /** next time it will do work, when it's anchored to the clock (null = every tick) */
  nextAt?: (tx: Sql) => Promise<Date | null>;
  /** false = the job is switched off in settings (shown as such, still ticks harmlessly) */
  enabled?: (tx: Sql) => Promise<boolean>;
  run: (sql: Sql) => Promise<Result>;
}

const everyTick = async () => 'a cada 15s';
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const JOBS: readonly ScheduledJob[] = [
  {
    name: 'agenda',
    label: 'agenda — retornos, follow-ups e datas da equipe',
    cadence: everyTick,
    run: sweepWakeups,
  },
  {
    name: 'meeting-reminders',
    label: 'lembretes de reunião (24h e 1h antes)',
    cadence: everyTick,
    run: sweepMeetingReminders,
  },
  {
    name: 'briefs',
    label: 'briefs de descoberta',
    cadence: async (tx) => `todo dia às ${hh((await agentSettingTx(tx)).schedule.discoveryHour)}`,
    nextAt: async (tx) =>
      (await anchorTx(tx, { hour: (await agentSettingTx(tx)).schedule.discoveryHour })).next,
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
    enabled: async (tx) => {
      const a = await agentSettingTx(tx);
      return a.level !== 'off' && a.jobs.strategist;
    },
    run: sweepStrategist,
  },
  {
    name: 'digest',
    label: 'resumo diário por e-mail',
    cadence: async (tx) => `todo dia às ${hh((await digestConfigTx(tx)).hour)}`,
    nextAt: async (tx) => (await anchorTx(tx, { hour: (await digestConfigTx(tx)).hour })).next,
    enabled: async (tx) => {
      const d = await digestConfigTx(tx);
      return d.enabled && Boolean(d.to);
    },
    run: sweepDigest,
  },
  {
    name: 'pipeline-snapshot',
    label: 'foto diária do funil',
    cadence: async () => 'todo dia à meia-noite',
    nextAt: async (tx) => (await anchorTx(tx, { hour: 0 })).next,
    run: sweepPipelineSnapshots,
  },
  {
    name: 'cost-caps',
    label: 'teto de custo por lead',
    cadence: everyTick,
    run: flagCappedLeads,
  },
];

/** the work loop, recorded alongside the jobs so a stuck queue shows up the same way */
export const QUEUE_JOB = { name: 'queue', label: 'fila do agente (runs)' } as const;

const asCount = (r: Result): number => (typeof r === 'number' ? r : r ? 1 : 0);

async function record(
  sql: Sql,
  name: string,
  started: Date,
  outcome: { ok: true; result: number } | { ok: false; error: string },
): Promise<void> {
  const ok = outcome.ok;
  const result = outcome.ok ? outcome.result : null;
  const error = outcome.ok ? null : outcome.error.slice(0, 1000);
  await controlTx(
    sql,
    (tx) => tx`
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
    `,
  ).catch((e) => agentLog.warn({ err: e, job: name }, 'could not record job run'));
}

/** Run one job isolated — its failure is recorded and logged, never thrown. */
export async function runJob(sql: Sql, job: Pick<ScheduledJob, 'name' | 'run'>): Promise<boolean> {
  const started = new Date();
  try {
    const result = asCount(await job.run(sql));
    await record(sql, job.name, started, { ok: true, result });
    return true;
  } catch (e) {
    agentLog.error({ err: e, job: job.name }, 'scheduled job failed');
    await record(sql, job.name, started, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** One pass over every job, in order, each isolated. */
export async function runJobsOnce(sql: Sql): Promise<void> {
  for (const job of JOBS) await runJob(sql, job);
}

let workTimer: ReturnType<typeof setInterval> | null = null;
let jobTimer: ReturnType<typeof setInterval> | null = null;
let working: Promise<unknown> | null = null;
let jobbing: Promise<unknown> | null = null;

export function startScheduler(sql: Sql, tickMs = TICK_MS) {
  if (workTimer || jobTimer) return;
  stopClaims(false);
  workTimer = setInterval(() => {
    if (working) return;
    working = runJob(sql, { name: QUEUE_JOB.name, run: drain }).finally(() => {
      working = null;
    });
  }, tickMs);
  jobTimer = setInterval(() => {
    if (jobbing) return;
    jobbing = runJobsOnce(sql).finally(() => {
      jobbing = null;
    });
  }, tickMs);
  workTimer.unref?.();
  jobTimer.unref?.();
  // first pass right away — a deploy shouldn't wait a tick to catch up on due work
  jobbing = runJobsOnce(sql).finally(() => {
    jobbing = null;
  });
}

/** Stop both loops: no new claims, let the run in hand and the job pass finish (bounded).
 *  A run still going at the deadline is recovered by the lease after restart. */
export async function stopScheduler(graceMs = 25_000): Promise<void> {
  stopClaims(true);
  if (workTimer) clearInterval(workTimer);
  if (jobTimer) clearInterval(jobTimer);
  workTimer = jobTimer = null;
  const inFlight = [working, jobbing].filter(Boolean) as Promise<unknown>[];
  if (!inFlight.length) return;
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
    const entries: { name: string; label: string; job?: ScheduledJob }[] = [
      { name: QUEUE_JOB.name, label: QUEUE_JOB.label },
      ...JOBS.map((j) => ({ name: j.name, label: j.label, job: j })),
    ];
    for (const { name, label, job } of entries) {
      const r = byName.get(name);
      out.push({
        name,
        label,
        cadence: job ? await job.cadence(tx) : 'contínua',
        enabled: job?.enabled ? await job.enabled(tx) : true,
        nextAt: job?.nextAt ? iso(await job.nextAt(tx)) : null,
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
