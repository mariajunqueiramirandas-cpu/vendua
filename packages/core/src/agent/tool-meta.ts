/**
 * agent/tool-meta — the one place a tool's behavioural contract lives. The
 * dispatcher, the runner's loop guard / finish gate and journal replay all
 * derive their sets from here, so adding a tool is one entry, not five
 * scattered Set literals that drift.
 *
 * effect:
 *  - read  — no durable writes (a result stays reusable until a write lands)
 *  - write — state write; an identical repeat may legitimately restore state
 *  - mint  — creates a new durable artifact per call; a landed duplicate is
 *            never legitimate and is suppressed run-wide
 *  - send  — mint that can put a message on the wire
 */

export type PlaybookKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
export const PLAYBOOK_KINDS: readonly PlaybookKind[] = [
  'triage',
  'reply',
  'outreach',
  'discovery',
  'strategist',
];

export type ToolEffect = 'read' | 'write' | 'mint' | 'send';

export interface ToolMeta {
  effect: ToolEffect;
  /** playbooks whose model may see and call the tool */
  playbooks: readonly PlaybookKind[];
  /** arg carrying the lead id a lead-bound run may only mutate */
  leadBound?: string;
  /** a landed call counts as the run's visible, lead-facing outcome */
  action?: boolean;
  /** local read of mutable CRM state — re-executes on repeat so external
   *  edits between turns stay visible (still counts toward the LOOP nudge) */
  mutableRead?: boolean;
  /** calls a paid/remote provider */
  remote?: boolean;
}

const LEAD_KINDS = ['triage', 'reply', 'outreach'] as const;
const ALL_BUT_STRATEGIST = ['triage', 'reply', 'outreach', 'discovery'] as const;

export const TOOL_META: Record<string, ToolMeta> = {
  search_leads: { effect: 'read', playbooks: ALL_BUT_STRATEGIST, mutableRead: true },
  get_lead: { effect: 'read', playbooks: ALL_BUT_STRATEGIST, mutableRead: true },
  create_lead: { effect: 'mint', playbooks: ['triage', 'discovery'] },
  update_lead: { effect: 'write', playbooks: ALL_BUT_STRATEGIST, leadBound: 'id', action: true },
  set_state: { effect: 'write', playbooks: LEAD_KINDS, leadBound: 'leadId', action: true },
  add_note: { effect: 'mint', playbooks: ALL_BUT_STRATEGIST, leadBound: 'leadId' },
  create_task: { effect: 'mint', playbooks: LEAD_KINDS, leadBound: 'leadId', action: true },
  draft_message: { effect: 'mint', playbooks: LEAD_KINDS, leadBound: 'leadId', action: true },
  send_message: {
    effect: 'send',
    playbooks: ['reply', 'outreach'],
    leadBound: 'leadId',
    action: true,
  },
  remember: {
    effect: 'write',
    playbooks: ['triage', 'reply', 'outreach', 'discovery', 'strategist'],
  },
  propose_brief: { effect: 'mint', playbooks: ['strategist'] },
  request_human: {
    effect: 'mint',
    playbooks: ['reply', 'outreach'],
    leadBound: 'leadId',
    action: true,
  },
  unsubscribe: { effect: 'mint', playbooks: ['reply'], leadBound: 'leadId', action: true },
  web_search: { effect: 'read', playbooks: ALL_BUT_STRATEGIST, remote: true },
  read_pages: { effect: 'read', playbooks: ALL_BUT_STRATEGIST, remote: true },
  plan: { effect: 'write', playbooks: ALL_BUT_STRATEGIST },
  book: { effect: 'write', playbooks: ['discovery'] },
  maps_lookup: { effect: 'read', playbooks: ['triage', 'outreach', 'discovery'], remote: true },
  instagram_profile: {
    effect: 'read',
    playbooks: ['triage', 'outreach', 'discovery'],
    remote: true,
  },
  serp: { effect: 'read', playbooks: ALL_BUT_STRATEGIST, remote: true },
  schedule: { effect: 'write', playbooks: LEAD_KINDS, leadBound: 'leadId' },
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
  return (TOOL_META[name]?.playbooks as readonly string[] | undefined)?.includes(kind) ?? false;
}

export function leadBoundArg(name: string): string | null {
  return TOOL_META[name]?.leadBound ?? null;
}
