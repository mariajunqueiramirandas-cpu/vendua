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

/** All kinds stored in `crm_turns.kind` (includes autonomous `campaign` director turns). */
export type CrmTurnKind = JobKind | 'campaign';

export const CRM_AGENT_ID = 'crm';
export const CRM_DISCOVERY_ID = 'crm-discovery';
export const CRM_STRATEGIST_ID = 'crm-strategist';
export const CRM_CAMPAIGN_ID = 'crm-campaign';
export const LEAD_SUBJECT = 'lead';
/** a discovery actor: one per brief (its id), or one per staff/campaign hunt (a fresh uuid) */
export const HUNT_SUBJECT = 'hunt';
export const REVIEW_SUBJECT = 'review';
/** the strategist's one actor */
export const REVIEW_ID = 'weekly';
/** one actor per goal-driven sales campaign (`crm_campaigns.id`) */
export const CAMPAIGN_SUBJECT = 'campaign';

/** What wakes the lead agent (the `crm` actor of one lead). */
export type LeadMailKind =
  | 'message.inbound'
  | 'timer.followup'
  | 'timer.callback'
  | 'lead.first_contact'
  | 'staff.request'
  | 'staff.regenerate';

/** What wakes a Campaign Director (`crm-campaign` actor of one campaign). */
export type CampaignMailKind =
  | 'campaign.started'
  | 'campaign.resumed'
  | 'campaign.hunt_done'
  | 'campaign.progress'
  | 'timer.campaign_tick'
  | 'staff.request';

export function isCampaignMailKind(kind: string): boolean {
  return (
    kind === 'campaign.started' ||
    kind === 'campaign.resumed' ||
    kind === 'campaign.hunt_done' ||
    kind === 'campaign.progress' ||
    kind === 'timer.campaign_tick'
  );
}

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
  'campaign.started': 'campaign_started',
  'campaign.resumed': 'campaign_resumed',
  'campaign.hunt_done': 'campaign_hunt_done',
  'campaign.progress': 'campaign_progress',
  'timer.campaign_tick': 'campaign_tick',
};
