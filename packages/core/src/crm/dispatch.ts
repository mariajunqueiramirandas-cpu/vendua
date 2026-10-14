import type { Json, JsonObject } from '@vendua/agent-runtime';
import { dispatchTx } from '../agent-host/dispatch.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import { isSendChannel, SEND_CHANNELS } from '../modules/threads.ts';
import type { Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { channelAvailabilityTx, sendWindowOpenAtTx } from './guardrails.ts';
import {
  CRM_AGENT_ID,
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  jobOf,
  LEAD_SUBJECT,
  type LeadMailKind,
} from './jobs.ts';
import { agentSettingTx, automationAllowedTx } from './policy.ts';

// The CRM's side of the one producer (ADR 0030 step 4): work for the CRM agents is a mailbox row
// of an actor under Venduá's platform tenant, written by `dispatchTx` inside the transaction that
// caused it. These helpers only decide when it is due and whether automation may file it; nothing
// else starts a CRM turn.

export {
  CRM_AGENT_ID,
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  jobOf,
  LEAD_SUBJECT,
  REVIEW_ID,
  REVIEW_SUBJECT,
  type LeadMailKind,
} from './jobs.ts';

/** Automation the preset and job switches may hold back; staff asks and promises always run. */
export function isAutomated(kind: string, source: string): boolean {
  if (kind === 'staff.request' || kind === 'staff.regenerate' || kind === 'timer.callback')
    return false;
  return !source.startsWith('staff');
}

/** kinds whose turn exists to put a message on the wire */
const SEND_BOUND: readonly string[] = [
  'message.inbound',
  'timer.followup',
  'timer.callback',
  'lead.first_contact',
];

interface LeadGate {
  agent_mode: string;
  archived_at: Date | null;
  unsubscribed_at: Date | null;
  agent_paused_at: Date | null;
  prior_out: number;
}

/** Why automation may not file this work now, or null. */
export async function parkedReasonTx(
  tx: Sql,
  kind: string,
  source: string,
  lead: Pick<LeadGate, 'agent_mode' | 'archived_at' | 'unsubscribed_at' | 'agent_paused_at'> | null,
  payload: Json = null,
): Promise<string | null> {
  if (lead) {
    if (lead.archived_at) return 'lead arquivado';
    if (lead.unsubscribed_at) return 'lead descadastrado';
  }
  if (!isAutomated(kind, source)) return null;
  if (lead) {
    if (lead.agent_mode === 'off') return 'agente desligado neste lead';
    if (lead.agent_paused_at) return 'agente pausado — aguardando um humano';
  }
  const v = await automationAllowedTx(tx, jobOf(kind, payload));
  return v.ok ? null : v.reason;
}

/** When send-bound work should start: never inside quiet hours when it would send live. Drafting
 *  work (copilot, draft-mode leads, supervised first contact, no deliverable channel) runs now. */
async function smartStartTx(
  tx: Sql,
  leadId: string,
  kind: string,
  payload: JsonObject,
  at: Date | null,
  lead: LeadGate,
): Promise<Date | null> {
  if (!SEND_BOUND.includes(kind) || payload.draftOnly === true) return at;
  const { level } = await agentSettingTx(tx);
  if (level !== 'supervised' && level !== 'autopilot') return at;
  if (lead.agent_mode === 'draft') return at;
  if (level === 'supervised' && lead.prior_out === 0) return at;
  const ch = await channelAvailabilityTx(tx, leadId);
  const pin = payload.channel;
  const deliverable = isSendChannel(pin) ? ch[pin].ok : SEND_CHANNELS.some((c) => ch[c].ok);
  if (!deliverable) return at;
  const g: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
  };
  const from = at ?? new Date();
  const open = await sendWindowOpenAtTx(tx, g, from);
  return open.getTime() > from.getTime() ? open : at;
}

export interface LeadRequest {
  leadId: string;
  kind: LeadMailKind;
  /** who caused it: whatsapp | instagram | email | manual | agent | cadence | staff[:<who>] | site */
  source: string;
  dedupeKey: string;
  payload?: JsonObject;
  /** earliest start; send-bound live work may move to the end of quiet hours */
  at?: Date | null;
  /** file it even while parked (agenda dates): the turn re-checks and stays silent */
  keepParked?: boolean;
}

export interface Requested {
  mailboxId: string | null;
  deliverAt: Date | null;
  /** automation may not file this now (the work was not dispatched unless keepParked) */
  parked: string | null;
}

/** Wakes the lead's agent. Runs in the caller's control (or platform tenant) transaction. */
export async function requestLeadTx(tx: Sql, req: LeadRequest): Promise<Requested> {
  const payload = req.payload ?? {};
  const [lead] = await tx<LeadGate[]>`
    select l.agent_mode, l.archived_at, l.unsubscribed_at, l.agent_paused_at,
      (select count(*) from lead_messages m join lead_threads t on t.id = m.thread_id
        where t.lead_id = l.id and m.direction = 'out'
          and m.status in ('queued', 'sending', 'sent', 'delivered'))::int as prior_out
    from leads l where l.id = ${req.leadId}`;
  if (!lead) return { mailboxId: null, deliverAt: null, parked: 'lead não encontrado' };
  const parked = await parkedReasonTx(tx, req.kind, req.source, lead, payload);
  if (parked && !req.keepParked) return { mailboxId: null, deliverAt: null, parked };
  const deliverAt = await smartStartTx(tx, req.leadId, req.kind, payload, req.at ?? null, lead);
  const out = await dispatchTx(tx, {
    actor: {
      tenantId: PLATFORM_TENANT_ID,
      agentId: CRM_AGENT_ID,
      subject: { kind: LEAD_SUBJECT, id: req.leadId },
    },
    kind: req.kind,
    source: req.source.slice(0, 120),
    dedupeKey: req.dedupeKey.slice(0, 200),
    ...(deliverAt ? { deliverAt } : {}),
    payload,
  });
  return { mailboxId: out.mailboxId, deliverAt, parked };
}

/** Wakes a discovery actor (a brief's daily run, or a staff hunt) or the weekly strategist. */
export async function requestBoardTx(
  tx: Sql,
  req: {
    agent: typeof CRM_DISCOVERY_ID | typeof CRM_STRATEGIST_ID;
    subject: { kind: string; id: string };
    kind: 'timer.daily' | 'timer.weekly' | 'staff.request';
    source: string;
    dedupeKey: string;
    payload?: JsonObject;
    at?: Date | null;
  },
): Promise<{ mailboxId: string | null; actorId: string }> {
  const out = await dispatchTx(tx, {
    actor: { tenantId: PLATFORM_TENANT_ID, agentId: req.agent, subject: req.subject },
    kind: req.kind,
    source: req.source.slice(0, 120),
    dedupeKey: req.dedupeKey.slice(0, 200),
    ...(req.at ? { deliverAt: req.at } : {}),
    payload: req.payload ?? {},
  });
  return { mailboxId: out.mailboxId, actorId: out.actorId };
}
