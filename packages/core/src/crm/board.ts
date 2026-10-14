import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import {
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  requestBoardTx,
  REVIEW_ID,
  REVIEW_SUBJECT,
} from './dispatch.ts';
import { agentSettingTx, automationAllowedTx, discoveryBudgetTx } from './policy.ts';
import { anchorTx } from './schedule-anchors.ts';

// The board's clock (ADR 0030 step 3): each enabled brief's daily discovery and the weekly review
// become mailbox rows of their actors. The dedupe key names the anchor, so a slot fires once
// however many passes see it; a run still going makes the next one wait in its mailbox.

const boardLog = log.child({ mod: 'crm-board' });

/** Each enabled brief runs once a day from agent.schedule.discoveryHour (workspace time); a new
 *  or re-armed one runs right away. */
export async function sweepBriefs(sql: Sql): Promise<number> {
  const touched: string[] = [];
  const fired = await controlTx(sql, async (tx) => {
    const { schedule } = await agentSettingTx(tx);
    const { last: anchor } = await anchorTx(tx, { hour: schedule.discoveryHour });
    const due = await tx<
      {
        id: string;
        name: string;
        query: string;
        segment: string | null;
        city: string | null;
        target: number | null;
        rearmed_at: string | null;
        created_by: string;
      }[]
    >`
      select id, name, query, segment, city, target, rearmed_at, created_by from discovery_briefs
      where enabled and (last_run_at is null or last_run_at < ${anchor})
      limit 10
      for update of discovery_briefs skip locked`;
    if (!due.length || !(await automationAllowedTx(tx, 'discovery')).ok) return 0;
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const autoPauseRuns = g.briefAutoPauseRuns ?? DEFAULT_GUARDRAILS.briefAutoPauseRuns;
    // the budget is re-checked before each refire (approval checked it once), serialized with
    // the strategist's proposals
    if (due.some((b) => b.created_by === 'strategist' && !b.rearmed_at))
      await tx`select pg_advisory_xact_lock(hashtext('brief-proposals'))`;
    let n = 0;
    for (const b of due) {
      // rearmed_at = a staff re-arm, a human decision exempt from the budget gate
      if (b.created_by === 'strategist' && !b.rearmed_at) {
        const bdg = await discoveryBudgetTx(tx, b.id);
        if (!(bdg.capCents > 0 && bdg.spent + (bdg.open + 1) * bdg.est <= bdg.capCents)) {
          await tx`
            update discovery_briefs set enabled = false,
              note = 'auto-pausada — orçamento semanal de descoberta esgotado'
            where id = ${b.id}`;
          touched.push(b.id);
          boardLog.info(
            { briefId: b.id, spent: bdg.spent, capCents: bdg.capCents },
            'discovery brief auto-paused — strategist budget exhausted',
          );
          continue;
        }
      }
      // dead brief: N finished runs since the last re-arm with no new lead pause it ('failed'
      // isn't zero-yield evidence)
      if (autoPauseRuns > 0) {
        const [stat] = await tx<{ runs: number; with_leads: number }[]>`
          with recent as (
            select leads_created from crm_turns
            where kind = 'discovery' and status = 'done' and brief_id = ${b.id}
              and (${b.rearmed_at}::timestamptz is null or started_at > ${b.rearmed_at}::timestamptz)
            order by finished_at desc limit ${autoPauseRuns}
          )
          select count(*)::int as runs, count(*) filter (where leads_created > 0)::int as with_leads
          from recent`;
        if (stat && stat.runs >= autoPauseRuns && stat.with_leads === 0) {
          await tx`
            update discovery_briefs set enabled = false,
              note = ${`auto-pausada — ${autoPauseRuns} runs seguidas sem lead`}
            where id = ${b.id}`;
          touched.push(b.id);
          boardLog.info(
            { briefId: b.id, runs: stat.runs },
            'discovery brief auto-paused — dead streak',
          );
          continue;
        }
      }
      const d = await requestBoardTx(tx, {
        agent: CRM_DISCOVERY_ID,
        subject: { kind: HUNT_SUBJECT, id: b.id },
        kind: 'timer.daily',
        source: 'schedule',
        dedupeKey: `crm:brief:${b.id}:${anchor.toISOString()}:${b.rearmed_at ?? ''}`,
        payload: {
          query: b.query,
          ...(b.segment ? { segment: b.segment } : {}),
          ...(b.city ? { city: b.city } : {}),
          ...(b.target ? { target: b.target } : {}),
          briefId: b.id,
          briefName: b.name,
        },
      });
      if (d.mailboxId) touched.push(d.mailboxId);
      await tx`update discovery_briefs set last_run_at = now() where id = ${b.id}`;
      n++;
    }
    return n;
  });
  for (const id of touched) emitControlEvent('run.update', id);
  return fired;
}

/** The weekly review at agent.schedule weekday/hour (workspace time). It is owed on its day only:
 *  a slot missed by a whole day (Core down, automation off) waits for the next week. */
export async function sweepStrategist(sql: Sql): Promise<boolean> {
  let queued: string | null = null;
  const fired = await controlTx(sql, async (tx) => {
    if (!(await automationAllowedTx(tx, 'strategist')).ok) return false;
    const { schedule } = await agentSettingTx(tx);
    const { last: anchor } = await anchorTx(tx, {
      hour: schedule.weeklyHour,
      weekday: schedule.weeklyDay,
    });
    if (Date.now() - anchor.getTime() > 86_400_000) return false;
    const d = await requestBoardTx(tx, {
      agent: CRM_STRATEGIST_ID,
      subject: { kind: REVIEW_SUBJECT, id: REVIEW_ID },
      kind: 'timer.weekly',
      source: 'schedule',
      dedupeKey: `crm:weekly:${anchor.toISOString()}`,
    });
    queued = d.mailboxId;
    return d.mailboxId !== null;
  });
  if (queued) emitControlEvent('run.update', queued);
  return fired;
}
