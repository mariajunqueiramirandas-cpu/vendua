import { TOOL_META, type JobKind } from './tool-meta.ts';

// What each run kind is — fixed in code (ADR 0015): staff configure the one agent, not its jobs.

export interface JobDef {
  kind: JobKind;
  /** model turns per run — each turn may fan out into several tool calls */
  stepBudget: number;
  /** default paid-enrichment ceiling (USD) when the run carries none */
  monidCapUsd: number;
  /** tool calls of one turn run concurrently (remote reads / idempotent inserts) */
  parallelTools: boolean;
  /** the run must end on a visible lead-facing action (one nudge otherwise) */
  requiresAction: boolean;
  /** a finished/budget-out run writes a doctrine debrief line to memory */
  debrief: boolean;
}

export const JOBS: Record<JobKind, JobDef> = {
  triage: {
    kind: 'triage',
    stepBudget: 12,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: false,
    debrief: false,
  },
  reply: {
    kind: 'reply',
    stepBudget: 14,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: true,
    debrief: false,
  },
  outreach: {
    kind: 'outreach',
    stepBudget: 12,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: true,
    debrief: false,
  },
  discovery: {
    kind: 'discovery',
    stepBudget: 30,
    monidCapUsd: 0.25,
    parallelTools: true,
    requiresAction: false,
    debrief: true,
  },
  strategist: {
    kind: 'strategist',
    stepBudget: 10,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: false,
    debrief: false,
  },
};

export function jobTools(kind: JobKind): string[] {
  return Object.entries(TOOL_META)
    .filter(([, m]) => m.jobs.includes(kind))
    .map(([n]) => n);
}
