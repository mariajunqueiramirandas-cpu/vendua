import type { Json, JsonObject } from '@vendua/agent-runtime';

// A leaf, imported by both sides of two cycles: modules/integrations.ts ↔ crm/policy.ts, and
// agent-host/registry.ts (the agent list) ↔ crm/dispatch.ts (dispatchTx).

/** The jobs the CRM agents do; a turn's kind follows the mailbox row that woke it. */
export type JobKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
export const JOB_KINDS: readonly JobKind[] = [
  'triage',
  'reply',
  'outreach',
  'discovery',
  'strategist',
];

export const CRM_AGENT_ID = 'crm';
export const CRM_DISCOVERY_ID = 'crm-discovery';
export const CRM_STRATEGIST_ID = 'crm-strategist';
export const LEAD_SUBJECT = 'lead';
/** a discovery actor: one per brief (its id), or one per staff hunt (a fresh uuid) */
export const HUNT_SUBJECT = 'hunt';
export const REVIEW_SUBJECT = 'review';
/** the strategist's one actor */
export const REVIEW_ID = 'weekly';

/** What wakes the lead agent (the `crm` actor of one lead). */
export type LeadMailKind =
  | 'message.inbound'
  | 'timer.followup'
  | 'timer.callback'
  | 'lead.first_contact'
  | 'staff.request'
  | 'staff.regenerate';

/** The old job a mailbox row asks for: what the switches, metrics and the UI still speak. */
export function jobOf(kind: string, payload: Json): JobKind {
  if (kind === 'message.inbound') return 'reply';
  if (kind === 'staff.request') {
    const k = (payload as JsonObject | null)?.kind;
    if (k === 'reply' || k === 'triage' || k === 'discovery' || k === 'strategist') return k;
    return 'outreach';
  }
  if (kind === 'timer.daily') return 'discovery';
  if (kind === 'timer.weekly') return 'strategist';
  return 'outreach';
}

/** Why a turn ran, in the activity list's words (the control's TRIGGER_LABEL): a mailbox kind. */
export const TRIGGER_OF: Record<string, string> = {
  'message.inbound': 'inbound',
  'timer.callback': 'callback',
  'timer.followup': 'followup',
  'lead.first_contact': 'first_contact',
  'staff.request': 'staff',
  'staff.regenerate': 'regenerate',
  'timer.daily': 'brief',
  'timer.weekly': 'weekly',
};
