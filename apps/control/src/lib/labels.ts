import type { AutonomyLevel, Meeting } from './api.ts';

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

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  off: 'desligado',
  copilot: 'copiloto',
  supervised: 'supervisionado',
  autopilot: 'piloto automático',
};

export const RUN_KIND_LABEL: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
  strategist: 'estrategista',
  campaign: 'campanha',
};

/** why a run exists (ADR 0016) — shown next to its kind */
export const TRIGGER_LABEL: Record<string, string> = {
  inbound: 'o lead escreveu',
  callback: 'retorno prometido',
  staff: 'pedido da equipe',
  regenerate: 'rascunho expirado',
  first_contact: 'lead novo',
  followup: 'follow-up do agente',
  brief: 'brief',
  weekly: 'revisão semanal',
  campaign_started: 'campanha iniciada',
  campaign_resumed: 'campanha retomada',
  campaign_hunt_done: 'busca concluída',
  campaign_progress: 'avanço na meta',
  campaign_tick: 'checagem da campanha',
};

export const MEETING_STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};
