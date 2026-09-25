import type { Meeting } from './api.ts';

/** Canonical entity labels — pair order = pipeline order for selects/columns. */
export const LEAD_STATES = [
  ['lead', 'lead'],
  ['contacted', 'contatado'],
  ['invited', 'convidado'],
  ['live', 'ativo'],
] as const;
export type LeadState = (typeof LEAD_STATES)[number][0];
export const LEAD_STATE_LABEL: Record<string, string> = Object.fromEntries(LEAD_STATES);

export const AGENT_GOALS = [
  ['negotiation', 'fechar negócio'],
  ['meeting', 'marcar reunião'],
] as const;
export const AGENT_GOAL_LABEL: Record<string, string> = Object.fromEntries(AGENT_GOALS);

export const AGENT_MODES = [
  ['off', 'off'],
  ['draft', 'rascunho'],
  ['auto', 'auto'],
] as const;
export const AGENT_MODE_LABEL: Record<string, string> = Object.fromEntries(AGENT_MODES);

export const RUN_KIND_LABEL: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
  strategist: 'estrategista',
};

export const MEETING_STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};
