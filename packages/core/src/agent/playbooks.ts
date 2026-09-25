import type { Sql } from '../platform/db.ts';
import { getSettingTx } from '../modules/integrations.ts';
import { PLAYBOOK_KINDS, TOOL_META, type PlaybookKind } from './tool-meta.ts';

/**
 * agent/playbooks — every run kind as data: what it is for, its budgets, how
 * its tools execute and which finish gates apply. Staff tune a playbook
 * through the `agent_playbooks` setting (ADR 0014); code defaults below are
 * the floor every override is merged onto.
 */

export interface PlaybookOverride {
  enabled?: boolean;
  stepBudget?: number;
  model?: string | null;
  instructions?: string;
  monidCapUsd?: number;
}

export type AgentPlaybooksSetting = Partial<Record<PlaybookKind, PlaybookOverride>>;

export interface PlaybookDef {
  kind: PlaybookKind;
  label: string;
  description: string;
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
  /** automatic enqueue paths the playbook owns, for the Studio */
  triggers: string[];
}

export const PLAYBOOKS: Record<PlaybookKind, PlaybookDef> = {
  triage: {
    kind: 'triage',
    label: 'Triagem',
    description: 'Qualifica um lead novo: pesquisa, pontua fit/intenção e organiza o card.',
    stepBudget: 12,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: false,
    debrief: false,
    triggers: ['staff'],
  },
  reply: {
    kind: 'reply',
    label: 'Resposta',
    description: 'Responde mensagens recebidas no canal do lead e conduz a conversa.',
    stepBudget: 14,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: true,
    debrief: false,
    triggers: ['inbound', 'staff'],
  },
  outreach: {
    kind: 'outreach',
    label: 'Prospecção / follow-up',
    description: 'Primeiro contato e follow-ups: pesquisa, dossiê e mensagem.',
    stepBudget: 12,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: true,
    debrief: false,
    triggers: ['next-action', 'wakeup', 'discovery', 'first-contact', 'staff'],
  },
  discovery: {
    kind: 'discovery',
    label: 'Descoberta',
    description: 'Encontra negócios do perfil ideal e cria leads com canais verificados.',
    stepBudget: 30,
    monidCapUsd: 0.25,
    parallelTools: true,
    requiresAction: false,
    debrief: true,
    triggers: ['brief', 'staff'],
  },
  strategist: {
    kind: 'strategist',
    label: 'Estrategista',
    description: 'Revisão semanal do funil: propõe novas buscas de descoberta.',
    stepBudget: 10,
    monidCapUsd: 0.05,
    parallelTools: false,
    requiresAction: false,
    debrief: false,
    triggers: ['weekly', 'staff'],
  },
};

export function playbookTools(kind: PlaybookKind): string[] {
  return Object.entries(TOOL_META)
    .filter(([, m]) => m.playbooks.includes(kind))
    .map(([n]) => n);
}

export interface EffectivePlaybook extends PlaybookDef {
  enabled: boolean;
  model: string | null;
  instructions: string;
  override: PlaybookOverride;
}

export function mergePlaybook(kind: PlaybookKind, o: PlaybookOverride = {}): EffectivePlaybook {
  const d = PLAYBOOKS[kind];
  const budget = Number.isInteger(o.stepBudget) ? Math.min(60, Math.max(1, o.stepBudget!)) : null;
  const monid =
    typeof o.monidCapUsd === 'number' && Number.isFinite(o.monidCapUsd)
      ? Math.min(5, Math.max(0, o.monidCapUsd))
      : null;
  return {
    ...d,
    stepBudget: budget ?? d.stepBudget,
    monidCapUsd: monid ?? d.monidCapUsd,
    enabled: o.enabled !== false,
    model: typeof o.model === 'string' && o.model.trim() ? o.model.trim() : null,
    instructions: typeof o.instructions === 'string' ? o.instructions.trim().slice(0, 4000) : '',
    override: o,
  };
}

export async function playbookSettingTx(tx: Sql): Promise<AgentPlaybooksSetting> {
  const v = await getSettingTx<AgentPlaybooksSetting>(tx, 'agent_playbooks', {});
  return v && typeof v === 'object' ? v : {};
}

export async function loadPlaybookTx(tx: Sql, kind: PlaybookKind): Promise<EffectivePlaybook> {
  return mergePlaybook(kind, (await playbookSettingTx(tx))[kind]);
}

export async function listPlaybooksTx(tx: Sql) {
  const s = await playbookSettingTx(tx);
  return PLAYBOOK_KINDS.map((kind) => {
    const d = PLAYBOOKS[kind];
    return {
      kind,
      label: d.label,
      description: d.description,
      triggers: d.triggers,
      debrief: d.debrief,
      defaults: { stepBudget: d.stepBudget, monidCapUsd: d.monidCapUsd },
      tools: playbookTools(kind),
      override: s[kind] ?? {},
    };
  });
}
