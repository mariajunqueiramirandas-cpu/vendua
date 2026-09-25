/** agent/tool-meta — the one place a tool's behavioural contract lives; the
 *  dispatcher, loop guard, finish gate and journal replay all derive from here.
 *
 *  effect: read = no durable writes; write = state write (an identical repeat
 *  may legitimately restore); mint = new durable artifact per call — a landed
 *  duplicate is suppressed run-wide; send = mint that can hit the wire. */

export type JobKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
export const JOB_KINDS: readonly JobKind[] = [
  'triage',
  'reply',
  'outreach',
  'discovery',
  'strategist',
];

export type ToolEffect = 'read' | 'write' | 'mint' | 'send';

export interface ToolMeta {
  effect: ToolEffect;
  jobs: readonly JobKind[];
  /** arg carrying the lead id a lead-bound run may only mutate */
  leadBound?: string;
  /** a landed call counts as the run's visible, lead-facing outcome */
  action?: boolean;
  /** local read of mutable CRM state — re-executes on repeat so external
   *  edits between turns stay visible (still counts toward the LOOP nudge) */
  mutableRead?: boolean;
  remote?: boolean;
}

const LEAD_KINDS = ['triage', 'reply', 'outreach'] as const;
const ALL_BUT_STRATEGIST = ['triage', 'reply', 'outreach', 'discovery'] as const;

export const TOOL_META: Record<string, ToolMeta> = {
  search_leads: { effect: 'read', jobs: ALL_BUT_STRATEGIST, mutableRead: true },
  get_lead: { effect: 'read', jobs: ALL_BUT_STRATEGIST, mutableRead: true },
  create_lead: { effect: 'mint', jobs: ['triage', 'discovery'] },
  update_lead: { effect: 'write', jobs: ALL_BUT_STRATEGIST, leadBound: 'id', action: true },
  set_state: { effect: 'write', jobs: LEAD_KINDS, leadBound: 'leadId', action: true },
  set_fact: { effect: 'write', jobs: LEAD_KINDS, leadBound: 'leadId' },
  add_note: { effect: 'mint', jobs: ALL_BUT_STRATEGIST, leadBound: 'leadId' },
  create_task: { effect: 'mint', jobs: LEAD_KINDS, leadBound: 'leadId', action: true },
  draft_message: { effect: 'mint', jobs: LEAD_KINDS, leadBound: 'leadId', action: true },
  send_message: {
    effect: 'send',
    jobs: ['reply', 'outreach'],
    leadBound: 'leadId',
    action: true,
  },
  remember: {
    effect: 'write',
    jobs: ['triage', 'reply', 'outreach', 'discovery', 'strategist'],
  },
  propose_brief: { effect: 'mint', jobs: ['strategist'] },
  request_human: {
    effect: 'mint',
    jobs: ['reply', 'outreach'],
    leadBound: 'leadId',
    action: true,
  },
  unsubscribe: { effect: 'mint', jobs: ['reply'], leadBound: 'leadId', action: true },
  web_search: { effect: 'read', jobs: ALL_BUT_STRATEGIST, remote: true },
  read_pages: { effect: 'read', jobs: ALL_BUT_STRATEGIST, remote: true },
  plan: { effect: 'write', jobs: ALL_BUT_STRATEGIST },
  book: { effect: 'write', jobs: ['discovery'] },
  maps_lookup: { effect: 'read', jobs: ['triage', 'outreach', 'discovery'], remote: true },
  instagram_profile: {
    effect: 'read',
    jobs: ['triage', 'outreach', 'discovery'],
    remote: true,
  },
  serp: { effect: 'read', jobs: ALL_BUT_STRATEGIST, remote: true },
  schedule: { effect: 'write', jobs: LEAD_KINDS, leadBound: 'leadId' },
};

const names = (pred: (m: ToolMeta) => boolean): ReadonlySet<string> =>
  new Set(
    Object.entries(TOOL_META)
      .filter(([, m]) => pred(m))
      .map(([n]) => n),
  );

export const ACTION_TOOLS = names((m) => m.action === true);
export const READ_TOOLS = names((m) => m.effect === 'read');
export const MUTABLE_READS = names((m) => m.mutableRead === true);
export const NON_IDEMPOTENT = names((m) => m.effect === 'mint' || m.effect === 'send');

export function toolAvailable(kind: string, name: string): boolean {
  return (TOOL_META[name]?.jobs as readonly string[] | undefined)?.includes(kind) ?? false;
}

export function leadBoundArg(name: string): string | null {
  return TOOL_META[name]?.leadBound ?? null;
}
