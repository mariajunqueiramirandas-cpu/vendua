// Why a run exists (ADR 0016) — stamped as columns on agent_runs / agent_inbox, never
// inferred from params. Every producer names one; policy, priority and the inbound
// retire rules read it.

export const TRIGGER_SOURCES = [
  'inbound', // the lead wrote
  'callback', // a promised date — the lead asked for it, or staff set it
  'staff', // someone on the team asked, now
  'regenerate', // staff approved an expired draft — recompose it
  'first_contact', // a new lead: staff-created, or discovery auto-contact
  'followup', // the agent's own plan: cadence after a send, a date it picked
  'brief', // a discovery brief's daily run
  'weekly', // the weekly strategist review
] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

/** claim order — a customer waiting beats a promise, beats staff, beats the agent's own plans */
export const SOURCE_PRIORITY: Record<TriggerSource, number> = {
  inbound: 0,
  callback: 1,
  staff: 2,
  regenerate: 2,
  first_contact: 3,
  followup: 4,
  brief: 6,
  weekly: 7,
};

export interface Provenance {
  source: TriggerSource;
  /** a promise to the lead (or staff): automation switches never park it, an inbound never retires it */
  promised: boolean;
}

export function provenance(source: TriggerSource, promised?: boolean): Provenance {
  return { source, promised: promised ?? source === 'callback' };
}

/** automation = the preset / job switches may park it; staff asks and promises always run */
export function isAutomated(p: Pick<Provenance, 'source' | 'promised'>): boolean {
  return p.source !== 'staff' && !p.promised;
}

/** the agent's own unanswered outreach — a fresh inbound makes it obsolete */
export const RETIRED_BY_INBOUND: readonly TriggerSource[] = ['first_contact', 'followup'];

export const isTriggerSource = (v: unknown): v is TriggerSource =>
  (TRIGGER_SOURCES as readonly unknown[]).includes(v);
