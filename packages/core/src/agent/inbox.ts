import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { log } from '../platform/log.ts';
import { automationAllowedTx, autonomyTx, playbookEnabledTx } from './policy.ts';
import { PLAYBOOK_KINDS, type PlaybookKind } from './tool-meta.ts';
import { capLockTx, insertRun } from './runner.ts';

const agentLog = log.child({ mod: 'agent' });

/**
 * agent/inbox — the per-lead mailbox. Anything that wants the agent's
 * attention for a lead (an inbound message, a fired wakeup, a staff nudge,
 * a scheduled event) enqueues an item instead of racing to own a run.
 * The lead's single active run drains pending items between steps and
 * renders them to the model; when no run exists the enqueueing side asks
 * insertRun for one — its on-conflict path resolves the race by returning
 * the already-active run's id, and the item drains into that run. Items
 * whose lead never gets a run (cap refusal, lost worker) are picked up by
 * the orphan sweep in drain().
 */

export type InboxKind = 'inbound' | 'wakeup' | 'staff' | 'event';

/** What a queued item carries: `text` is the one-liner rendered to the
 *  model on drain; `requestedKind`/`threadId`/`params` are the contract for
 *  the fallback run the orphan sweep creates when the item outlives every
 *  run (params must carry the auto/origin markers claimRun gates on). */
export interface InboxPayload {
  text?: string;
  requestedKind?: PlaybookKind;
  threadId?: string | null;
  params?: Record<string, unknown>;
  /** ISO instant before which a spawned run must not claim (the enqueueing
   *  path's quiet period — the sweep carries it into run_at). */
  notBefore?: string;
  [k: string]: unknown;
}

export interface InboxItem {
  id: string;
  kind: InboxKind;
  payload: InboxPayload;
  created_at: string;
}

export async function enqueueInboxTx(
  tx: Sql,
  leadId: string,
  kind: InboxKind,
  payload: InboxPayload,
): Promise<string> {
  // `text` is model-rendered — clamp defensively even though every producer
  // already bounds its own copy.
  if (typeof payload.text === 'string' && payload.text.length > 500) {
    payload = { ...payload, text: payload.text.slice(0, 500) };
  }
  // `channel: 'auto'` is "let the agent pick" — not a pin. Stored verbatim
  // it would be a channel no run ever matches (drainInbox only normalizes
  // to whatsapp|email|''), leaving the item undrainable: it would respawn
  // forever and never die with the run it rode in on.
  if (
    payload.params != null &&
    typeof payload.params === 'object' &&
    payload.params.channel === 'auto'
  ) {
    const params = { ...payload.params };
    delete params.channel;
    payload = { ...payload, params };
  }
  return (
    await tx<{ id: string }[]>`
      insert into agent_inbox (lead_id, kind, payload)
      values (${leadId}, ${kind}, ${tx.json(payload as never)})
      returning id
    `
  )[0]!.id;
}

/** The user-message render for a drained batch — kind + timestamp + the
 *  producer's one-liner, so the model sees order and recency. */
export function renderInboxItems(items: InboxItem[]): string {
  const lines = items.map(
    (i) => `• ${i.kind} ${i.created_at}: ${i.payload?.text ?? '(sem texto)'}`,
  );
  return `[caixa de entrada] ${items.length === 1 ? '1 item novo' : `${items.length} itens novos`} — leia e reaja:\n${lines.join('\n')}`;
}

/** Items whose lead has no active run need a run of their own — a delivered
 *  item whose run died before draining, or one enqueued behind a cap
 *  refusal. Runs one bounded pass per drain() tick. Automation-originated
 *  kinds gate on autonomy like their enqueueing sites did; staff items only
 *  check the playbook switch (same as the staff endpoints). Terminal
 *  suppressions (unsubscribe/archive) drop the mail like drain()'s parked
 *  cancels; pauses and mode 'off' park it — the next run drains the backlog
 *  once the lead can work again. */
export async function sweepOrphanInbox(sql: Sql, limit = 10): Promise<number> {
  // The window must reach leads it can actually serve — a skipped lead
  // keeps its rows, so scanning parked (paused/off) or already-served
  // (active run) leads here would re-pick them every tick and starve
  // anything younger. Only exclusions that NEVER self-clear are filtered;
  // unsubscribed/archived leads stay selectable so their mail still drops —
  // even while paused/off: a terminal state must still reach the drop, or
  // the mail outlives its lead.
  const leads = await controlTx(
    sql,
    (tx) => tx<{ lead_id: string }[]>`
      select i.lead_id, min(i.created_at) as first_at
      from agent_inbox i
      join leads l on l.id = i.lead_id
      where i.consumed_at is null
        and (
          (l.agent_paused_at is null and l.agent_mode <> 'off')
          or l.unsubscribed_at is not null
          or l.archived_at is not null
        )
        and not exists (
          select 1 from agent_runs r
          where r.lead_id = i.lead_id and r.status in ('queued', 'running')
        )
      group by i.lead_id order by first_at limit ${limit}
    `,
  );
  let served = 0;
  for (const { lead_id } of leads) {
    const runId = await controlTx(sql, async (tx) => {
      await capLockTx(tx, lead_id);
      // A run claimed/queued since the scan owns the mail — it drains at
      // its next step boundary, so nothing to do here.
      const active = await tx`
        select 1 from agent_runs
        where lead_id = ${lead_id} and status in ('queued', 'running') limit 1
      `;
      if (active.length) return null;
      const items = await tx<{ id: string; kind: InboxKind; payload: InboxPayload }[]>`
        select id, kind, payload from agent_inbox
        where lead_id = ${lead_id} and consumed_at is null
        order by created_at for update skip locked
      `;
      if (!items.length) return null;
      const lead = (
        await tx<
          {
            agent_mode: string;
            agent_paused_at: string | null;
            unsubscribed_at: string | null;
            archived_at: string | null;
          }[]
        >`select agent_mode, agent_paused_at, unsubscribed_at, archived_at from leads where id = ${lead_id}`
      )[0];
      if (!lead) return null;
      if (lead.unsubscribed_at || lead.archived_at) {
        // Terminal suppression — the mail is unservable: consume it with no
        // run (consumed_by_run stays null = dropped, never rendered) so it
        // doesn't retry every tick.
        await tx`
          update agent_inbox set consumed_at = now()
          where lead_id = ${lead_id} and consumed_at is null
        `;
        return null;
      }
      // Paused or mode 'off' lifts — keep the mail pending.
      if (lead.agent_paused_at || lead.agent_mode === 'off') return null;
      // The first ELIGIBLE item drives the spawn: an oldest item stuck
      // behind a disabled playbook or agent-disabled thread must not
      // starve younger servable mail on the same lead — blocked items
      // stay pending for whenever their gate lifts (the spawned run's
      // drain applies the same playbook gate, so parked mail never
      // renders inside it either).
      let spawn: {
        kind: PlaybookKind;
        threadId: string | null;
        params: Record<string, unknown>;
      } | null = null;
      for (const item of items) {
        const p = item.payload;
        const requestedKind = p?.requestedKind;
        if (!requestedKind) continue;
        // Automation intents answer to autonomy; staff and promised work
        // only to the playbook switch — the same markers claimRun reads
        // off run params ('auto' key or origin='inbound' = automation;
        // unmarked = a human asked for it, which kind 'staff' always is).
        const marked = p?.params != null && ('auto' in p.params || p.params.origin === 'inbound');
        const gate =
          item.kind === 'staff' || !marked
            ? await playbookEnabledTx(tx, requestedKind)
            : await automationAllowedTx(tx, requestedKind);
        if (!gate.ok) continue;
        if (p?.threadId) {
          const th = await tx<{ agent_enabled: boolean }[]>`
            select agent_enabled from lead_threads where id = ${p.threadId}
          `;
          if (!th[0]?.agent_enabled) continue;
        }
        spawn = { kind: requestedKind, threadId: p.threadId ?? null, params: p.params ?? {} };
        break;
      }
      if (!spawn) return null;
      // The spawned run inherits the quiet period of the mail it serves:
      // a deferred item's notBefore (the inbound delay stamped at enqueue)
      // becomes run_at — without it a reply a run deferred minutes ago
      // could fire immediately once that run ends. Max across the items
      // this run would drain — the latest message owns the quiet period,
      // mirroring the parked-run slide in ingestInbound.
      const runChannel =
        spawn.params.channel === 'whatsapp' || spawn.params.channel === 'email'
          ? (spawn.params.channel as string)
          : '';
      const runDraftOnly = spawn.params.draftOnly === true;
      const autoOff = (await autonomyTx(tx)).level === 'off';
      let notBefore = 0;
      // Only mail this run would actually drain owns a quiet period: a
      // gated item (its playbook switched off — the same check drainInbox
      // runs) stays pending when the run starts, so its deadline can't
      // stall servable work behind it.
      const enabled = new Map<string, boolean>();
      for (const i of items) {
        const ip = i.payload;
        const chan =
          ip?.params != null && typeof ip.params.channel === 'string'
            ? (ip.params.channel as string)
            : '';
        const wouldDrain =
          (chan || runChannel) === runChannel && (ip?.params?.draftOnly === true) === runDraftOnly;
        if (!wouldDrain) continue;
        // Same per-item gate drainInbox applies inside the spawned run:
        // under workspace 'off' an auto-marked item stays pending, so its
        // notBefore can't postpone the mail that CAN serve.
        if (
          autoOff &&
          ip?.params != null &&
          ('auto' in ip.params || ip.params.origin === 'inbound')
        )
          continue;
        const k = ip?.requestedKind;
        if (k != null && (PLAYBOOK_KINDS as readonly string[]).includes(k)) {
          let ok = enabled.get(k);
          if (ok == null) {
            ok = (await playbookEnabledTx(tx, k as PlaybookKind)).ok;
            enabled.set(k, ok);
          }
          if (!ok) continue;
        }
        const t = typeof ip?.notBefore === 'string' ? Date.parse(ip.notBefore) : NaN;
        if (Number.isFinite(t) && t > notBefore) notBefore = t;
      }
      // insertRun's cap check still applies — a refused lead keeps the
      // mail pending for a raised cap.
      const cap: { retired?: string[] } = {};
      const id = await insertRun(tx, {
        kind: spawn.kind,
        leadId: lead_id,
        threadId: spawn.threadId,
        params: spawn.params,
        ...(notBefore ? { runAt: new Date(notBefore) } : {}),
      });
      return { id, retired: cap.retired ?? [] };
    }).catch((e) => {
      agentLog.warn({ err: e, leadId: lead_id }, 'orphan inbox sweep failed for lead');
      return null;
    });
    if (runId?.id) {
      served++;
      emitControlEvent('run.update', runId.id);
    }
    for (const r of runId?.retired ?? []) emitControlEvent('run.update', r);
  }
  return served;
}
