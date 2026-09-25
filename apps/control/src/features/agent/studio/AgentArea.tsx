import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AGENT_JOBS, api, type AgentConfig, type AgentJob, type AutonomyLevel } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Input, Select, Textarea } from '@/components/ui/input.tsx';
import { AreaIntro, EndpointState, FieldError, SaveBar, useDraft } from './bits.tsx';
import { obj, str, type SettingsMap, type SettingWrite } from './settings.ts';

export const LEVELS: {
  key: AutonomyLevel;
  label: string;
  tag: string;
  sends: string;
  queue: string;
}[] = [
  {
    key: 'off',
    label: 'desligado',
    tag: 'só no manual',
    sends: 'nada sai sozinho; se um run manual escrever, vira rascunho',
    queue: 'a fila de aprovação não anda',
  },
  {
    key: 'copilot',
    label: 'copiloto',
    tag: 'tudo vira rascunho',
    sends: 'toda mensagem espera aprovação antes de sair',
    queue: 'aprovações acumulam na fila',
  },
  {
    key: 'supervised',
    label: 'supervisionado',
    tag: 'o padrão',
    sends: 'respostas e follow-ups saem direto; primeiro contato espera aprovação',
    queue: 'só o primeiro contato para na fila',
  },
  {
    key: 'autopilot',
    label: 'piloto automático',
    tag: 'mão solta',
    sends: 'tudo sai direto — silêncio, teto/dia e ignorados continuam valendo',
    queue: 'fila vazia — nada espera você',
  },
];

const JOBS: Record<AgentJob, { label: string; hint: string }> = {
  reply: { label: 'responder mensagens', hint: 'conduz a conversa com quem escreve' },
  outreach: {
    label: 'prospecção e follow-ups',
    hint: 'primeiro contato de lead novo e retornos da cadência',
  },
  discovery: { label: 'descoberta', hint: 'roda os briefs de busca e cria leads novos' },
  strategist: { label: 'revisão semanal', hint: 'propõe briefs novos a partir do funil' },
};

const ALL_ON: Record<AgentJob, boolean> = {
  reply: true,
  outreach: true,
  discovery: true,
  strategist: true,
};
// what each stop of the slider turns on — copilot keeps the agent to conversations it can draft
const PRESET_JOBS: Record<Exclude<AutonomyLevel, 'off'>, Record<AgentJob, boolean>> = {
  copilot: { reply: true, outreach: true, discovery: false, strategist: false },
  supervised: ALL_ON,
  autopilot: ALL_ON,
};

const sameJobs = (a: Record<AgentJob, boolean>, b: Record<AgentJob, boolean>) =>
  AGENT_JOBS.every((k) => a[k] === b[k]);

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function HourSelect({
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (h: number) => void;
  id?: string;
  'aria-label'?: string;
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

export const useAgentConfig = () =>
  useQuery({ queryKey: qk.agentConfig(), queryFn: api.agentConfig });

const voiceOf = (pitch: Record<string, unknown>) => ({
  product: str(pitch.product, ''),
  offer: str(pitch.offer, ''),
  audience: str(pitch.audience, ''),
  tone: str(pitch.tone, ''),
  offerRange: str(pitch.offerRange, ''),
  goal: str(pitch.goal, ''),
});

export function AgentArea({
  map,
  save,
  pending,
}: {
  map: SettingsMap;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  pending: boolean;
}) {
  const q = useAgentConfig();
  if (!q.data) {
    return (
      <EndpointState
        title="agente"
        error={q.error}
        missing="GET /agent/config ainda não chegou neste servidor."
        onRetry={() => void q.refetch()}
      />
    );
  }
  return <AgentForm config={q.data} pitch={obj(map.pitch)} save={save} pending={pending} />;
}

function AgentForm({
  config,
  pitch,
  save,
  pending,
}: {
  config: AgentConfig;
  pitch: Record<string, unknown>;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  pending: boolean;
}) {
  const agent = useDraft(config);
  const voice = useDraft(voiceOf(pitch));
  const a = agent.edit;
  const setA = (patch: Partial<AgentConfig>) => agent.setEdit({ ...a, ...patch });
  const setV =
    (k: keyof typeof voice.edit) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      voice.setEdit({ ...voice.edit, [k]: e.target.value });

  const pos = LEVELS.findIndex((l) => l.key === a.level);
  const sel = LEVELS[pos]!;
  const off = a.level === 'off';
  const custom = !off && !sameJobs(a.jobs, PRESET_JOBS[a.level as Exclude<AutonomyLevel, 'off'>]);
  const onJobs = AGENT_JOBS.filter((k) => a.jobs[k]);
  const usdBad =
    !Number.isFinite(a.weeklyDiscoveryUsd) || a.weeklyDiscoveryUsd < 0 || a.weeklyDiscoveryUsd > 50;
  const tooLong = a.instructions.length > 8000;

  // the slider is a preset: it also resets the jobs to that stop's defaults ('off' leaves them for the way back)
  const pickLevel = (level: AutonomyLevel) =>
    setA(level === 'off' ? { level } : { level, jobs: PRESET_JOBS[level] });

  const saveAll = async () => {
    if (agent.dirty && !(await save('agent', { ...a }))) return;
    // PUT replaces the whole setting — merge over the stored value so raw keys survive
    if (voice.dirty) await save('pitch', (c: unknown) => ({ ...obj(c), ...voice.edit }));
  };

  return (
    <>
      <AreaIntro>
        um agente só — até onde ele vai sozinho, como ele fala e o que ele nunca faz
      </AreaIntro>
      <div className="flex flex-col gap-3">
        <Panel
          title="autonomia"
          actions={
            <div className="flex items-center gap-1">
              {custom && <Badge variant="warn">personalizado</Badge>}
              <Badge variant={config.level === 'off' ? 'default' : 'agent'}>
                no ar: {LEVELS.find((l) => l.key === config.level)?.label}
              </Badge>
            </div>
          }
        >
          <Throttle value={a.level} pos={pos} onChange={pickLevel} />
          <dl className="mt-3 grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
            {(
              [
                [
                  'roda sozinho',
                  off
                    ? 'nada — só disparos da equipe e retornos que o lead pediu'
                    : onJobs.length
                      ? onJobs.map((k) => JOBS[k].label).join(' · ')
                      : 'nenhum trabalho ligado',
                ],
                ['envios', sel.sends],
                ['fila', sel.queue],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 bg-card px-3 py-2">
                <dt className="text-[11px] font-medium text-muted-foreground">{k}</dt>
                <dd className="text-sm">{v}</dd>
              </div>
            ))}
          </dl>
          <fieldset
            disabled={off}
            className={cn('mt-4 grid gap-x-4 gap-y-2 md:grid-cols-2', off && 'opacity-60')}
          >
            <legend className="mb-1 text-xs text-muted-foreground">
              trabalhos automáticos — desligar pausa só o automático; a equipe ainda dispara na mão
              e retorno prometido ao lead sai do mesmo jeito
            </legend>
            {AGENT_JOBS.map((k) => (
              <label key={k} className="flex min-h-10 items-start gap-2.5 py-1 text-sm">
                <Switch
                  className="mt-0.5"
                  checked={a.jobs[k]}
                  onCheckedChange={(v) => setA({ jobs: { ...a.jobs, [k]: v } })}
                />
                <span className="flex min-w-0 flex-col">
                  <span>{JOBS[k].label}</span>
                  <span className="text-xs text-muted-foreground">{JOBS[k].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {!off && (a.jobs.discovery || a.jobs.strategist) && (
            <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
              {a.jobs.discovery && (
                <Field
                  label="briefs de descoberta rodam"
                  htmlFor="agent-discovery-hour"
                  hint="uma vez por dia, no fuso da aba limites — brief novo roda na hora"
                >
                  <div className="flex items-center gap-2 text-sm">
                    todo dia às
                    <HourSelect
                      id="agent-discovery-hour"
                      value={a.schedule.discoveryHour}
                      onChange={(h) => setA({ schedule: { ...a.schedule, discoveryHour: h } })}
                    />
                  </div>
                </Field>
              )}
              {a.jobs.strategist && (
                <Field
                  label="revisão semanal roda"
                  htmlFor="agent-weekly-day"
                  hint="o estrategista lê o funil e propõe briefs novos"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    toda
                    <Select
                      id="agent-weekly-day"
                      className="w-auto"
                      value={a.schedule.weeklyDay}
                      onChange={(e) =>
                        setA({ schedule: { ...a.schedule, weeklyDay: Number(e.target.value) } })
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
                      value={a.schedule.weeklyHour}
                      onChange={(h) => setA({ schedule: { ...a.schedule, weeklyHour: h } })}
                    />
                  </div>
                </Field>
              )}
              {a.jobs.strategist && (
                <Field
                  label="auto-aprovação dos briefs do estrategista (US$/semana)"
                  htmlFor="agent-weekly-usd"
                  hint="o brief proposto já nasce ligado enquanto o gasto de descoberta dos últimos 7 dias ficar abaixo disso — 0 = toda proposta espera você"
                  className="md:col-span-2"
                >
                  <Input
                    id="agent-weekly-usd"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={50}
                    step={0.5}
                    className="md:max-w-40"
                    value={a.weeklyDiscoveryUsd}
                    onChange={(e) => setA({ weeklyDiscoveryUsd: Number(e.target.value) })}
                  />
                  {usdBad && <FieldError>número entre 0 e 50</FieldError>}
                </Field>
              )}
            </div>
          )}
        </Panel>

        <Panel title="voz">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="produto" htmlFor="pitch-product">
              <Textarea
                id="pitch-product"
                rows={3}
                maxLength={4000}
                value={voice.edit.product}
                onChange={setV('product')}
              />
            </Field>
            <Field
              label="oferta — fatos que ele pode citar (preço, link, loja exemplo)"
              htmlFor="pitch-offer"
              hint="vazio = ele não cita preço nem link nenhum"
            >
              <Textarea
                id="pitch-offer"
                rows={3}
                maxLength={4000}
                value={voice.edit.offer}
                onChange={setV('offer')}
                placeholder="ex.: plano R$149/mês, sem comissão; 7 dias grátis; cadastro: https://..."
              />
            </Field>
            <Field label="público" htmlFor="pitch-audience">
              <Input
                id="pitch-audience"
                maxLength={4000}
                value={voice.edit.audience}
                onChange={setV('audience')}
              />
            </Field>
            <Field label="tom" htmlFor="pitch-tone">
              <Input
                id="pitch-tone"
                maxLength={4000}
                value={voice.edit.tone}
                onChange={setV('tone')}
              />
            </Field>
            <Field
              label="margem de negociação"
              htmlFor="pitch-range"
              hint="o que ele pode conceder sozinho e quando chamar a equipe"
            >
              <Textarea
                id="pitch-range"
                rows={2}
                maxLength={4000}
                value={voice.edit.offerRange}
                onChange={setV('offerRange')}
              />
            </Field>
            <Field label="objetivo da conversa" htmlFor="pitch-goal">
              <Input
                id="pitch-goal"
                maxLength={4000}
                value={voice.edit.goal}
                onChange={setV('goal')}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="instruções" aside={`${a.instructions.length}/8000 · valem em todo run`}>
          <Textarea
            aria-label="instruções do agente"
            rows={8}
            value={a.instructions}
            onChange={(e) => setA({ instructions: e.target.value })}
            placeholder={'- nunca prometa data de entrega\n- sempre mencione o frete grátis'}
          />
          {tooLong && <FieldError>no máximo 8000 caracteres</FieldError>}
          <p className="mt-1.5 text-xs text-muted-foreground">
            regras e orientações da equipe — entram no prompt de toda conversa, busca e revisão. O
            roteiro de cada trabalho é fixo; é aqui que você ajusta o comportamento.
          </p>
        </Panel>

        <SaveBar
          label="salvar agente"
          dirty={agent.dirty || voice.dirty}
          disabled={usdBad || tooLong}
          pending={pending}
          onReset={() => {
            agent.reset();
            voice.reset();
          }}
          onSave={() => void saveAll()}
        />
      </div>
    </>
  );
}

/** Four stops on a rail — the lit (agent) span runs from "desligado" up to the chosen stop. */
function Throttle({
  value,
  pos,
  onChange,
}: {
  value: AutonomyLevel;
  pos: number;
  onChange: (l: AutonomyLevel) => void;
}) {
  return (
    <div role="radiogroup" aria-label="nível de autonomia" className="relative grid grid-cols-4">
      {/* track runs between the first and last stop centers (12.5% in from each side) */}
      <span
        aria-hidden
        className="absolute top-[13px] right-[12.5%] left-[12.5%] h-1.5 rounded-full bg-muted"
      />
      <span
        aria-hidden
        className="absolute top-[13px] left-[12.5%] h-1.5 rounded-full bg-agent transition-[width] duration-200"
        style={{ width: `${pos * 25}%` }}
      />
      {LEVELS.map((l, i) => {
        const on = value === l.key;
        const lit = i <= pos && pos > 0;
        return (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(l.key)}
            className="group relative flex min-w-0 flex-col items-center gap-1 rounded-md px-1 pt-1 pb-2 text-center transition-colors hover:bg-hover"
          >
            <span
              aria-hidden
              className={cn(
                'relative z-10 size-6 rounded-full border-2 bg-card transition-all',
                lit ? 'border-agent bg-agent' : 'border-border-strong',
                on && 'ring-4 ring-agent/35',
                on && pos === 0 && 'border-foreground bg-foreground ring-foreground/15',
              )}
            />
            <span
              className={cn(
                'text-xs leading-tight font-medium md:text-sm',
                on ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {l.label}
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">{l.tag}</span>
          </button>
        );
      })}
    </div>
  );
}
