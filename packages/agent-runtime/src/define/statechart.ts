import type { ConversationState } from '../engine/state.ts';
import type { Json } from '../types.ts';

/**
 * A trigger is `tool:<name>` (the tool succeeded), `mailbox:<kind>` (a batch carried that
 * kind) or `event:<type>` (the log recorded that event type).
 */
export type Trigger = `tool:${string}` | `mailbox:${string}` | `event:${string}`;

export type Transition =
  string | { to: string; when?: (state: Readonly<ConversationState>, payload: Json) => boolean };

export interface ChartState {
  /** Tools the model may call here, besides built-ins and loaded skills' tools. `'*'` = all. */
  tools: readonly string[] | '*';
  /** Slots that must be set before leaving forward; unset ones form the `FALTA` checklist. */
  required?: readonly string[];
  on?: Partial<Record<Trigger, Transition | readonly Transition[]>>;
  /** One line for the model: what this state is for. */
  hint?: string;
}

export interface Statechart {
  initial: string;
  states: Record<string, ChartState>;
  /** Transitions that apply in every state (a complaint → handoff). */
  on?: Partial<Record<Trigger, Transition | readonly Transition[]>>;
}

export function defineStatechart(chart: Statechart): Statechart {
  if (!(chart.initial in chart.states))
    throw new Error(`statechart: unknown initial ${chart.initial}`);
  const targets = (t: Transition | readonly Transition[] | undefined): string[] =>
    t === undefined
      ? []
      : (Array.isArray(t) ? t : [t]).map((x) => (typeof x === 'string' ? x : x.to));
  const check = (on: ChartState['on']) => {
    for (const t of Object.values(on ?? {}))
      for (const to of targets(t as Transition | readonly Transition[] | undefined))
        if (!(to in chart.states)) throw new Error(`statechart: unknown target ${to}`);
  };
  check(chart.on);
  for (const st of Object.values(chart.states)) check(st.on);
  return chart;
}

/** A one-state chart that allows every tool, for agents with no workflow. */
export const openChart: Statechart = { initial: 'open', states: { open: { tools: '*' } } };

/** The next state for a trigger, or null when nothing fires. State-local rules win. */
export function transitionFor(
  chart: Statechart,
  state: Readonly<ConversationState>,
  trigger: Trigger,
  payload: Json,
): string | null {
  const local = chart.states[state.chart.state]?.on?.[trigger];
  for (const rules of [local, chart.on?.[trigger]]) {
    if (rules === undefined) continue;
    for (const r of (Array.isArray(rules) ? rules : [rules]) as Transition[]) {
      if (typeof r === 'string') return r === state.chart.state ? null : r;
      if (!r.when || r.when(state, payload)) return r.to === state.chart.state ? null : r.to;
    }
  }
  return null;
}

export function missingSlots(chart: Statechart, state: Readonly<ConversationState>): string[] {
  const req = chart.states[state.chart.state]?.required ?? [];
  return req.filter((name) => !(name in state.chart.slots));
}

export function toolsAllowedIn(chart: Statechart, stateName: string): readonly string[] | '*' {
  return chart.states[stateName]?.tools ?? [];
}
