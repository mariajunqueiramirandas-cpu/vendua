import { useQuery } from '@tanstack/react-query';
import { api, AUTONOMY_LEVELS, type AgentAutonomySetting, type AutonomyLevel } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { AreaIntro, FieldError, SaveBar, useDraft } from './bits.tsx';
import { num, obj, type SettingsMap, type SettingWrite } from './settings.ts';

export const LEVELS: {
  key: AutonomyLevel;
  label: string;
  tag: string;
  runs: string;
  sends: string;
  queue: string;
}[] = [
  {
    key: 'off',
    label: 'desligado',
    tag: 'só no manual',
    runs: 'nada automático — só callbacks prometidos ao lead e disparos na mão',
    sends: 'nada sai sozinho; se um run manual escrever, vira rascunho',
    queue: 'a fila de aprovação não anda',
  },
  {
    key: 'copilot',
    label: 'copiloto',
    tag: 'tudo vira rascunho',
    runs: 'pesquisa, escreve e agenda retornos sozinho',
    sends: 'toda mensagem espera aprovação antes de sair',
    queue: 'aprovações acumulam na fila',
  },
  {
    key: 'supervised',
    label: 'supervisionado',
    tag: 'o padrão de hoje',
    runs: 'roda sozinho em cima de cada gatilho',
    sends: 'respostas e follow-ups saem direto; primeiro contato espera aprovação',
    queue: 'só o primeiro contato para na fila',
  },
  {
    key: 'autopilot',
    label: 'piloto automático',
    tag: 'mão solta',
    runs: 'roda e envia sozinho, sem tocar na fila',
    sends: 'tudo sai direto — silêncio, teto/dia e ignorados continuam valendo',
    queue: 'fila vazia — nada espera você',
  },
];

export const useAutonomy = () => useQuery({ queryKey: qk.autonomy(), queryFn: api.autonomy });

export function AutonomyArea({
  map,
  save,
  pending,
}: {
  map: SettingsMap;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  pending: boolean;
}) {
  /** GET /agent/autonomy — the effective preset, defaults applied */
  const server = useAutonomy().data ?? null;
  /** raw settings.agent_autonomy — the fallback read while the GET is absent */
  const saved = obj(map.agent_autonomy);
  // saved wins per-field when valid; server fills what's absent — the map is fresher than the GET
  const savedLevel = AUTONOMY_LEVELS.includes(saved.level as AutonomyLevel)
    ? (saved.level as AutonomyLevel)
    : null;
  const base: Required<AgentAutonomySetting> = {
    level: savedLevel ?? server?.level ?? 'supervised',
    strategistAutoApproveUsd: num(
      saved.strategistAutoApproveUsd,
      server?.strategistAutoApproveUsd ?? 0,
    ),
  };
  const { edit, setEdit, dirty, reset } = useDraft(base);
  const sel = LEVELS.find((l) => l.key === edit.level)!;
  const pos = LEVELS.findIndex((l) => l.key === edit.level);
  const capBad =
    !Number.isFinite(edit.strategistAutoApproveUsd) ||
    edit.strategistAutoApproveUsd < 0 ||
    edit.strategistAutoApproveUsd > 50;

  return (
    <>
      <AreaIntro>
        até onde o agente decide sozinho — a mesma régua vale pra todo run automático
      </AreaIntro>
      <Panel
        title="nível de autonomia"
        actions={
          server && (
            <Badge variant={server.level === 'off' ? 'default' : 'agent'}>
              no ar: {LEVELS.find((l) => l.key === server.level)?.label}
            </Badge>
          )
        }
      >
        <Throttle value={edit.level} pos={pos} onChange={(level) => setEdit({ ...edit, level })} />
        <dl className="mt-3 grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
          {(
            [
              ['runs', sel.runs],
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
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Field
            label="auto-aprovação do estrategista (US$/sem)"
            htmlFor="strategist-cap"
            hint="o estrategista liga sozinho o brief que propõe enquanto o gasto de descoberta dos últimos 7 dias ficar abaixo desse teto — 0 = toda proposta chega desligada"
          >
            <Input
              id="strategist-cap"
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={0.5}
              className="md:max-w-40"
              value={edit.strategistAutoApproveUsd}
              onChange={(e) =>
                setEdit({ ...edit, strategistAutoApproveUsd: Number(e.target.value) })
              }
            />
            {capBad && <FieldError>número entre 0 e 50</FieldError>}
          </Field>
        </div>
        <SaveBar
          label="salvar autonomia"
          dirty={dirty}
          disabled={capBad}
          pending={pending}
          onReset={reset}
          onSave={() => void save('agent_autonomy', { ...edit })}
        />
      </Panel>
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
