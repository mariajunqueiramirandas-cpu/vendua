import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import { instagramHandle } from '../modules/threads.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { whatsappRegistered } from './channels/whatsapp.ts';
import {
  CRM_AGENT_ID,
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  requestBoardTx,
  requestLeadTx,
  REVIEW_ID,
  REVIEW_SUBJECT,
} from './dispatch.ts';
import {
  emailReadyTx,
  instagramColdBudgetTx,
  instagramReadyTx,
  passesAutoContactScore,
  whatsappReadyTx,
} from './guardrails.ts';
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

const BACKLOG_BATCH = 10;
const PROBE_BATCH = 5;

/**
 * Catch-up sweep for eligible untouched leads: verifies pending BR mobile WhatsApp numbers
 * (outside any long tx so wa-gateway answers cleanly) and queues `lead.first_contact` for leads
 * clearing the current score gate on a live channel. Deduped on `crm:first_contact:<leadId>` so
 * a lead that already had a first-contact turn is never looped.
 */
export async function sweepOutreachBacklog(
  sql: Sql,
): Promise<{ n: number; retryInMs?: number | undefined }> {
  // Read settings and channel readiness once before probing.
  const prep = await controlTx(sql, async (tx) => {
    if (!(await automationAllowedTx(tx, 'outreach')).ok) return null;
    const g: Guardrails = {
      ...DEFAULT_GUARDRAILS,
      ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
    };
    if (!g.discoveryAutoContact) return null;
    const [waReady, igReady, emailReady] = [
      await whatsappReadyTx(tx),
      g.instagramColdDmsPerDay > 0 && (await instagramReadyTx(tx)),
      await emailReadyTx(tx),
    ];
    if (!waReady && !igReady && !emailReady) return null;
    // Candidates with unverified WhatsApp numbers that clear the score gate and haven't been probed recently.
    const toProbe = waReady
      ? await tx<
          { id: string; whatsapp: string; fit_score: number | null; intent_score: number | null }[]
        >`
          select l.id, l.whatsapp, l.fit_score, l.intent_score
          from leads l
          where l.state = 'lead'
            and l.archived_at is null and l.unsubscribed_at is null
            and l.agent_paused_at is null and l.tenant_id is null
            and l.agent_mode <> 'off'
            and l.fit_score is not null
            and l.fit_score >= ${Math.max(1, g.discoveryContactMinScore - 1)}
            and l.whatsapp is not null and l.whatsapp <> '' and not l.whatsapp_verified
            and not exists (
              select 1 from lead_messages m join lead_threads th on th.id = m.thread_id
              where th.lead_id = l.id and m.direction in ('out', 'in')
            )
            and not exists (
              select 1 from agent_mailbox mb
              where mb.tenant_id = ${PLATFORM_TENANT_ID}
                and mb.dedupe_key = 'crm:first_contact:' || l.id::text
            )
            and not exists (
              select 1 from platform_wa_probes p
              where p.phone = regexp_replace(l.whatsapp, '\\D', '', 'g')
                and p.created_at > now() - interval '7 days'
            )
          order by l.fit_score desc, l.intent_score desc nulls last, l.created_at desc
          limit ${PROBE_BATCH}`
      : [];
    return { g, waReady, igReady, emailReady, toProbe };
  });
  if (!prep) return { n: 0 };

  const { g, waReady, igReady, emailReady, toProbe } = prep;
  const verifiedIds: string[] = [];
  for (const row of toProbe) {
    if (!passesAutoContactScore(row.fit_score, row.intent_score, g.discoveryContactMinScore))
      continue;
    const ok = await whatsappRegistered(row.whatsapp, sql).catch(() => null);
    if (ok === true) verifiedIds.push(row.id);
  }
  if (verifiedIds.length) {
    await controlTx(
      sql,
      (tx) => tx`
        update leads set whatsapp_verified = true, updated_at = now()
        where id = any(${verifiedIds}::uuid[]) and not whatsapp_verified`,
    );
    for (const id of verifiedIds) emitControlEvent('lead.change', id);
  }

  const touched: string[] = [];
  const queued = await controlTx(sql, async (tx) => {
    if (!(await automationAllowedTx(tx, 'outreach')).ok) return 0;
    const igBudget = igReady
      ? await instagramColdBudgetTx(tx, g)
      : { remaining: 0, nextSlotAt: null };
    let igSlots = igBudget.remaining;
    const candidates = await tx<
      {
        id: string;
        fit_score: number | null;
        intent_score: number | null;
        whatsapp: string | null;
        whatsapp_verified: boolean;
        instagram: string | null;
        email: string | null;
        email_bounced_at: string | null;
      }[]
    >`
      select l.id, l.fit_score, l.intent_score, l.whatsapp, l.whatsapp_verified,
             l.instagram, l.email, l.email_bounced_at
      from leads l
      where l.state = 'lead'
        and l.archived_at is null and l.unsubscribed_at is null
        and l.agent_paused_at is null and l.tenant_id is null
        and l.agent_mode <> 'off'
        and l.fit_score is not null
        and l.fit_score >= ${Math.max(1, g.discoveryContactMinScore - 1)}
        and not exists (
          select 1 from lead_messages m join lead_threads th on th.id = m.thread_id
          where th.lead_id = l.id and m.direction in ('out', 'in')
        )
        and not exists (
          select 1 from agent_mailbox mb
          where mb.tenant_id = ${PLATFORM_TENANT_ID}
            and mb.dedupe_key = 'crm:first_contact:' || l.id::text
        )
        and not exists (
          select 1 from agent_mailbox mb join agent_actors a on a.id = mb.actor_id
          where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
            and a.subject_kind = 'lead' and a.subject_id = l.id::text
            and mb.consumed_by_turn is null
            and mb.kind in ('lead.first_contact', 'timer.followup')
        )
      order by l.fit_score desc, l.intent_score desc nulls last, l.created_at desc
      limit ${BACKLOG_BATCH * 3}`;

    let n = 0;
    for (const c of candidates) {
      if (n >= BACKLOG_BATCH) break;
      if (!passesAutoContactScore(c.fit_score, c.intent_score, g.discoveryContactMinScore))
        continue;
      let chan: 'whatsapp' | 'instagram' | 'email' | null = null;
      if (waReady && c.whatsapp && c.whatsapp_verified) chan = 'whatsapp';
      else if (igReady && igSlots > 0 && instagramHandle(c.instagram)) chan = 'instagram';
      else if (emailReady && c.email && !c.email_bounced_at) chan = 'email';
      if (!chan) continue;
      const scoreTag =
        c.intent_score !== null
          ? `fitScore ${String(c.fit_score)}, intentScore ${String(c.intent_score)}`
          : `fitScore ${String(c.fit_score)}`;
      const r = await requestLeadTx(tx, {
        leadId: c.id,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${c.id}`,
        payload: {
          channel: chan,
          focus: `primeiro contato — lead qualificado (${scoreTag}). Use só 1 detalhe natural do dossiê na timeline pra abrir conversa leve, sem ficha corrida nem link.`,
        },
      });
      if (r.mailboxId) {
        if (chan === 'instagram') igSlots--;
        touched.push(r.mailboxId);
        n++;
      }
    }
    return n;
  });
  for (const id of touched) emitControlEvent('run.update', id);
  return { n: queued, ...(queued >= BACKLOG_BATCH ? { retryInMs: 60_000 } : {}) };
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
