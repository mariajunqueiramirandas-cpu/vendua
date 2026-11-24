import { AGENT_JOBS, type AgentConfig, type AgentJob, type AutonomyLevel } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { AUTONOMY_LABEL } from '@/lib/labels.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Select } from '@/components/ui/input.tsx';

export const LEVELS: {
  key: AutonomyLevel;
  label: string;
  tag: string;
  sends: string;
  queue: string;
}[] = [
  {
    key: 'off',
    label: AUTONOMY_LABEL.off,
    tag: 'só no manual',
    sends: 'nada sai sozinho; se um disparo manual escrever, vira rascunho',
    queue: 'nada entra sozinho na fila de aprovação',
  },
  {
    key: 'copilot',
    label: AUTONOMY_LABEL.copilot,
    tag: 'tudo vira rascunho',
    sends: 'toda mensagem espera aprovação da equipe antes de sair',
    queue: 'aprovações acumulam no inbox',
  },
  {
    key: 'supervised',
    label: AUTONOMY_LABEL.supervised,
    tag: 'recomendado',
    sends: 'respostas e follow-ups saem direto; abordagem fria espera aprovação',
    queue: 'só o 1º contato frio passa por aprovação',
  },
  {
    key: 'autopilot',
    label: AUTONOMY_LABEL.autopilot,
    tag: 'envia tudo direto',
    sends: 'tudo sai sem aprovação — horário de silêncio e limites continuam valendo',
    queue: 'fila vazia — nada espera você',
  },
];

const JOBS: Record<AgentJob, { label: string; hint: string }> = {
  reply: { label: 'responder mensagens', hint: 'conduz a conversa com quem escreve' },
  outreach: {
    label: 'prospecção e follow-ups',
    hint: 'primeiro contato de lead novo e retornos da cadência',
  },
  discovery: { label: 'descoberta', hint: 'roda os briefs diários e cria leads novos' },
  strategist: { label: 'revisão semanal', hint: 'analisa o funil e propõe novos briefs' },
};

const ALL_ON: Record<AgentJob, boolean> = {
  reply: true,
  outreach: true,
  discovery: true,
  strategist: true,
};
const PRESET_JOBS: Record<Exclude<AutonomyLevel, 'off'>, Record<AgentJob, boolean>> = {
  copilot: { reply: true, outreach: true, discovery: false, strategist: false },
  supervised: ALL_ON,
  autopilot: ALL_ON,
};
const sameJobs = (a: Record<AgentJob, boolean>, b: Record<AgentJob, boolean>) =>
  AGENT_JOBS.every((k) => a[k] === b[k]);

export function AutonomyPanel({
  liveLevel,
  value,
  onChange,
}: {
  liveLevel: AutonomyLevel;
  value: AgentConfig;
  onChange: (patch: Partial<AgentConfig>) => void;
}) {
  const pos = LEVELS.findIndex((l) => l.key === value.level);
  const sel = LEVELS[pos]!;
  const off = value.level === 'off';
  const custom =
    !off && !sameJobs(value.jobs, PRESET_JOBS[value.level as Exclude<AutonomyLevel, 'off'>]);
  const onJobs = AGENT_JOBS.filter((k) => value.jobs[k]);

  // Picking a stop resets automatic jobs to that stop's defaults ('off' preserves them for turning back on).
  const pickLevel = (level: AutonomyLevel) =>
    onChange(level === 'off' ? { level } : { level, jobs: PRESET_JOBS[level] });

  return (
    <Panel
      title="autonomia e trabalhos"
      aside="até onde o agente vai sozinho"
      actions={
        <div className="flex items-center gap-1">
          {custom && <Badge variant="warn">personalizado</Badge>}
          <Badge
            variant={
              liveLevel === 'off' ? 'default' : liveLevel === 'supervised' ? 'agent' : 'warn'
            }
          >
            no ar: {AUTONOMY_LABEL[liveLevel]}
          </Badge>
        </div>
      }
    >
      <Throttle value={value.level} pos={pos} onChange={pickLevel} />
      <dl className="mt-3 grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
        {(
          [
            [
              'roda sozinho',
              off
                ? 'nada — só disparos da equipe e retornos prometidos ao lead'
                : onJobs.length
                  ? onJobs.map((k) => JOBS[k].label).join(' · ')
                  : 'nenhum trabalho automático ligado',
            ],
            ['envios', sel.sends],
            ['aprovação', sel.queue],
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
          trabalhos automáticos — desligar pausa só o automático; a equipe ainda dispara na mão e
          promessas de retorno saem do mesmo jeito
        </legend>
        {AGENT_JOBS.map((k) => (
          <label key={k} className="flex min-h-10 items-start gap-2.5 py-1 text-sm">
            <Switch
              className="mt-0.5"
              checked={value.jobs[k]}
              onCheckedChange={(v) => onChange({ jobs: { ...value.jobs, [k]: v } })}
            />
            <span className="flex min-w-0 flex-col">
              <span>{JOBS[k].label}</span>
              <span className="text-xs text-muted-foreground">{JOBS[k].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
        {(
          [
            ['inbound', 'leads que chegam sozinhos', 'escreveram no whatsapp, instagram ou e-mail'],
            [
              'discovery',
              'leads achados pela descoberta',
              'criados pelo agente nos briefs de busca',
            ],
          ] as const
        ).map(([k, label, hint]) => (
          <Field key={k} label={`${label} começam em`} htmlFor={`agent-new-${k}`} hint={hint}>
            <Select
              id={`agent-new-${k}`}
              value={value.newLeadMode[k]}
              onChange={(e) =>
                onChange({
                  newLeadMode: {
                    ...value.newLeadMode,
                    [k]: e.target.value as 'draft' | 'auto',
                  },
                })
              }
            >
              <option value="auto">automático (segue a autonomia)</option>
              <option value="draft">rascunho (tudo espera aprovação)</option>
            </Select>
          </Field>
        ))}
        <p className="text-xs text-muted-foreground md:col-span-2">
          vale para leads novos; os que já existem mantêm o modo individual do card
        </p>
      </div>
    </Panel>
  );
}

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
