import type { ReactNode } from 'react';
import type { AgentConfig } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { FieldError, RawJson } from './bits.tsx';
import { num, str, tzValid } from './settings.ts';

export interface GuardrailsDraft {
  maxOutboundPerLeadPerDay: number;
  maxUnansweredTouches: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  discoveryAutoContact: boolean;
  discoveryContactMinScore: number;
  inboundReplyDelayMin: number;
  firstContactDelayMin: number;
  followupCadenceDays: number;
  staleDraftDays: number;
  briefAutoPauseRuns: number;
  instagramColdDmsPerDay: number;
  instagramFollowsPerDay: number;
  leadLifetimeCostCapUsd: number;
}

export function guardrailsOf(value: Record<string, unknown>): GuardrailsDraft {
  return {
    maxOutboundPerLeadPerDay: num(value.maxOutboundPerLeadPerDay, 3),
    maxUnansweredTouches: num(value.maxUnansweredTouches, 2),
    quietHoursEnabled: value.quietHoursEnabled !== false,
    quietStart: str(value.quietStart, '21:00'),
    quietEnd: str(value.quietEnd, '08:00'),
    timezone: str(value.timezone, 'America/Sao_Paulo'),
    discoveryAutoContact: value.discoveryAutoContact !== false,
    discoveryContactMinScore: num(value.discoveryContactMinScore, 8),
    inboundReplyDelayMin: num(value.inboundReplyDelayMin, 0),
    firstContactDelayMin: num(value.firstContactDelayMin, 0),
    followupCadenceDays: num(value.followupCadenceDays, 3),
    staleDraftDays: num(value.staleDraftDays, 3),
    briefAutoPauseRuns: num(value.briefAutoPauseRuns, 5),
    instagramColdDmsPerDay: num(value.instagramColdDmsPerDay, 15),
    instagramFollowsPerDay: num(value.instagramFollowsPerDay, 30),
    leadLifetimeCostCapUsd: num(value.leadLifetimeCostCapUsd, 5),
  };
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function HourSelect({
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (h: number) => void;
  id?: string | undefined;
  'aria-label'?: string | undefined;
}) {
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      className="w-auto tnum"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </Select>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-10">
      <Switch checked={checked} onCheckedChange={onChange} />
      {children}
    </label>
  );
}

type NumKey =
  | 'maxOutboundPerLeadPerDay'
  | 'maxUnansweredTouches'
  | 'discoveryContactMinScore'
  | 'inboundReplyDelayMin'
  | 'firstContactDelayMin'
  | 'followupCadenceDays'
  | 'staleDraftDays'
  | 'briefAutoPauseRuns'
  | 'instagramColdDmsPerDay'
  | 'instagramFollowsPerDay';

export function LimitsPanel({
  rawGuardrails,
  edit,
  onEdit,
  agent,
  onAgent,
  onSaveRaw,
}: {
  rawGuardrails: Record<string, unknown>;
  edit: GuardrailsDraft;
  onEdit: (next: GuardrailsDraft) => void;
  agent: AgentConfig;
  onAgent: (patch: Partial<AgentConfig>) => void;
  onSaveRaw: (v: Record<string, unknown>) => void;
}) {
  const quietWrap = edit.quietStart > edit.quietEnd;
  const tzOk = tzValid(edit.timezone);
  const costCapBad =
    !Number.isFinite(edit.leadLifetimeCostCapUsd) ||
    edit.leadLifetimeCostCapUsd < 0 ||
    edit.leadLifetimeCostCapUsd > 1000;
  const weeklyUsdBad =
    !Number.isFinite(agent.weeklyDiscoveryUsd) ||
    agent.weeklyDiscoveryUsd < 0 ||
    agent.weeklyDiscoveryUsd > 50;

  const numIn = (k: NumKey, min: number, max: number, floor: number) => (
    <Input
      id={`gr-${k}`}
      type="number"
      inputMode="numeric"
      className="lg:max-w-44"
      min={min}
      max={max}
      value={edit[k]}
      onChange={(e) => {
        const n = Number(e.target.value);
        onEdit({ ...edit, [k]: Number.isFinite(n) ? n : floor });
      }}
    />
  );

  const off = agent.level === 'off';

  return (
    <div className="flex flex-col gap-3">
      <Panel title="horário e ritmo" aside="quando o agente responde, insiste e expira rascunhos">
        <div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
          <Field
            label={
              <>
                horário de silêncio{' '}
                {edit.quietHoursEnabled && quietWrap && (
                  <em className="not-italic">(vira o dia)</em>
                )}
              </>
            }
            hint={
              edit.quietHoursEnabled
                ? 'o agente segura envios dentro dessa janela'
                : 'desligado — o agente envia a qualquer hora'
            }
          >
            <Toggle
              checked={edit.quietHoursEnabled}
              onChange={(v) => onEdit({ ...edit, quietHoursEnabled: v })}
            >
              {edit.quietHoursEnabled ? 'ligado' : 'desligado'}
            </Toggle>
            <div className={cn('flex items-center gap-2', !edit.quietHoursEnabled && 'hidden')}>
              <Input
                type="time"
                aria-label="início do silêncio"
                value={edit.quietStart}
                onChange={(e) => onEdit({ ...edit, quietStart: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="time"
                aria-label="fim do silêncio"
                value={edit.quietEnd}
                onChange={(e) => onEdit({ ...edit, quietEnd: e.target.value })}
              />
            </div>
          </Field>
          <Field label="fuso horário" htmlFor="gr-tz" hint="usado pelo silêncio, briefs e revisão">
            <Input
              id="gr-tz"
              list="tz-list"
              value={edit.timezone}
              onChange={(e) => onEdit({ ...edit, timezone: e.target.value })}
            />
            {!tzOk && <FieldError>fuso IANA inválido</FieldError>}
          </Field>
          <Field
            label="atraso na resposta (min)"
            htmlFor="gr-inboundReplyDelayMin"
            hint="0 = responde na hora; >0 espera esse tempo depois da mensagem do lead"
          >
            {numIn('inboundReplyDelayMin', 0, 1440, 0)}
          </Field>
          <Field
            label="atraso no 1º contato (min)"
            htmlFor="gr-firstContactDelayMin"
            hint="0 = dispara na hora; a autonomia decide se envia ou cria rascunho"
          >
            {numIn('firstContactDelayMin', 0, 10080, 0)}
          </Field>
          <Field
            label="cadência de retorno (dias)"
            htmlFor="gr-followupCadenceDays"
            hint="envio sem resposta agenda o próximo follow-up; 0 = desligado (nunca sobrescreve promessa marcada)"
          >
            {numIn('followupCadenceDays', 0, 90, 0)}
          </Field>
          <Field
            label="validade de rascunho (dias)"
            htmlFor="gr-staleDraftDays"
            hint="aprovar rascunho mais velho que isso regenera contra o estado atual do lead; 0 = desligado"
          >
            {numIn('staleDraftDays', 0, 90, 0)}
          </Field>
        </div>
      </Panel>

      <Panel
        title="freios de contato e custo"
        aside="impostos pelo código em toda execução — independem do prompt"
      >
        <div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
          <Field
            label="msgs sem resposta em 24h"
            htmlFor="gr-maxOutboundPerLeadPerDay"
            hint="limite por lead sem resposta em 24h — quando o lead responde, zera; 0 = sem limite"
          >
            {numIn('maxOutboundPerLeadPerDay', 0, 100, 0)}
          </Field>
          <Field
            label="msgs seguidas sem resposta (total)"
            htmlFor="gr-maxUnansweredTouches"
            hint="limite total na sequência sem resposta, mesmo em dias diferentes"
          >
            {numIn('maxUnansweredTouches', 1, 20, 1)}
          </Field>
          <Field
            label="teto de custo por lead (US$)"
            htmlFor="gr-leadLifetimeCostCapUsd"
            hint="custo acumulado de IA por lead — acima disso o agente pausa e cria uma tarefa para a equipe; 0 = sem teto"
          >
            <Input
              id="gr-leadLifetimeCostCapUsd"
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step={0.5}
              className="lg:max-w-44"
              value={edit.leadLifetimeCostCapUsd}
              onChange={(e) => {
                const n = Number(e.target.value);
                onEdit({ ...edit, leadLifetimeCostCapUsd: Number.isFinite(n) ? n : 0 });
              }}
            />
            {costCapBad && <FieldError>número entre 0 e 1000</FieldError>}
          </Field>
          <Field
            label="DMs frias no Instagram / dia"
            htmlFor="gr-instagramColdDmsPerDay"
            hint="teto da conta em 24h corridas para conversas abertas com quem nunca escreveu; 0 = bloqueia DM fria"
          >
            {numIn('instagramColdDmsPerDay', 0, 200, 0)}
          </Field>
          <Field
            label="seguir no Instagram / dia"
            htmlFor="gr-instagramFollowsPerDay"
            hint="teto da conta em 24h corridas para follows automáticos; 0 = não segue ninguém"
          >
            {numIn('instagramFollowsPerDay', 0, 200, 0)}
          </Field>
        </div>
        <RawJson value={rawGuardrails} onSave={onSaveRaw} />
      </Panel>

      <div id="sec-descoberta" className="scroll-mt-4">
        <Panel
          title="descoberta e revisão semanal"
          aside="quando os briefs rodam, autocontato e orçamento do estrategista"
        >
          <div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
            <Field
              label="briefs diários rodam"
              htmlFor="agent-discovery-hour"
              hint={
                off || !agent.jobs.discovery
                  ? 'trabalho de descoberta desligado em Autonomia — horário salvo para quando ligar'
                  : 'uma vez por dia no fuso configurado acima (brief novo roda na hora)'
              }
            >
              <div className="flex items-center gap-2 text-sm">
                todo dia às
                <HourSelect
                  id="agent-discovery-hour"
                  value={agent.schedule.discoveryHour}
                  onChange={(h) => onAgent({ schedule: { ...agent.schedule, discoveryHour: h } })}
                />
              </div>
            </Field>
            <Field
              label="auto-pausa de brief (execuções)"
              htmlFor="gr-briefAutoPauseRuns"
              hint="execuções seguidas do mesmo brief sem lead novo pausam ele sozinho; 0 = nunca pausa"
            >
              {numIn('briefAutoPauseRuns', 0, 100, 0)}
            </Field>
            <Field
              label="autocontato na descoberta"
              hint="lead descoberto com fit ≥ nota mínima ganha disparo automático (respeita a autonomia)"
            >
              <Toggle
                checked={edit.discoveryAutoContact}
                onChange={(v) => onEdit({ ...edit, discoveryAutoContact: v })}
              >
                {edit.discoveryAutoContact ? 'nota alta inicia contato' : 'só cria o card'}
              </Toggle>
            </Field>
            <Field
              label="nota mínima p/ autocontato (fit)"
              htmlFor="gr-discoveryContactMinScore"
              hint="fitScore mínimo (1 a 10) para iniciar contato sozinho"
            >
              {numIn('discoveryContactMinScore', 1, 10, 1)}
            </Field>
            <Field
              label="revisão semanal roda"
              htmlFor="agent-weekly-day"
              hint={
                off || !agent.jobs.strategist
                  ? 'trabalho de revisão semanal desligado em Autonomia'
                  : 'o estrategista lê o funil e propõe novos briefs'
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                toda
                <Select
                  id="agent-weekly-day"
                  className="w-auto"
                  value={agent.schedule.weeklyDay}
                  onChange={(e) =>
                    onAgent({
                      schedule: { ...agent.schedule, weeklyDay: Number(e.target.value) },
                    })
                  }
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
                às
                <HourSelect
                  aria-label="hora da revisão semanal"
                  value={agent.schedule.weeklyHour}
                  onChange={(h) => onAgent({ schedule: { ...agent.schedule, weeklyHour: h } })}
                />
              </div>
            </Field>
            <Field
              label="auto-aprovação de briefs (US$/semana)"
              htmlFor="agent-weekly-usd"
              hint="brief proposto pelo estrategista já nasce ligado enquanto o gasto de descoberta (7d) ficar abaixo disso; 0 = toda proposta espera aprovação"
            >
              <Input
                id="agent-weekly-usd"
                type="number"
                inputMode="decimal"
                min={0}
                max={50}
                step={0.5}
                className="lg:max-w-44"
                value={agent.weeklyDiscoveryUsd}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onAgent({ weeklyDiscoveryUsd: Number.isFinite(n) ? n : 0 });
                }}
              />
              {weeklyUsdBad && <FieldError>número entre 0 e 50</FieldError>}
            </Field>
          </div>
        </Panel>
      </div>
    </div>
  );
}
