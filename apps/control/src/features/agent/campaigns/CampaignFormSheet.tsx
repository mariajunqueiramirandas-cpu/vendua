import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Rocket } from 'lucide-react';
import type {
  CampaignGoalKind,
  CampaignPreflight,
  CampaignScope,
  StartCampaignPayload,
} from '@/lib/api.ts';
import { AUTONOMY_LABEL } from '@/lib/labels.ts';
import { Button } from '@/components/ui/button.tsx';
import { Segmented, Switch } from '@/components/ui/controls.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useSegments } from '../discovery/queries.ts';
import { useStartCampaign } from './queries.ts';

const PRESETS: {
  label: string;
  title: string;
  objective: string;
  goalKind: CampaignGoalKind;
  goalTarget: number;
  budgetUsd: number;
  maxDays: number;
}[] = [
  {
    label: '1 cadastro',
    title: 'Primeiro cadastro autônomo',
    objective:
      'Continue encontrando bons leads de alimentação, abordando e acompanhando no WhatsApp/Instagram até conseguir 1 cadastro real de loja.',
    goalKind: 'signup',
    goalTarget: 1,
    budgetUsd: 20,
    maxDays: 7,
  },
  {
    label: '3 reuniões',
    title: 'Agendar 3 calls qualificadas',
    objective:
      'Busque negócios ativos no delivery/encomenda, gere interesse e agende 3 reuniões de demonstração.',
    goalKind: 'meeting',
    goalTarget: 3,
    budgetUsd: 25,
    maxDays: 7,
  },
  {
    label: '5 respostas',
    title: 'Validar nicho com 5 respostas',
    objective:
      'Teste abordagens leves e nichos promissores até conseguir 5 respostas humanas genuínas.',
    goalKind: 'reply',
    goalTarget: 5,
    budgetUsd: 10,
    maxDays: 5,
  },
];

const GOAL_OPTS = [
  ['signup', 'cadastro'],
  ['meeting', 'reunião'],
  ['reply', 'resposta'],
] as const;

const SCOPE_OPTS = [
  ['any', 'qualquer lead'],
  ['campaign_only', 'só desta campanha'],
] as const;

export function CampaignFormSheet({
  open,
  onOpenChange,
  preflight,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preflight: CampaignPreflight | undefined;
  onCreated: (campaignId: string) => void;
}) {
  const segs = useSegments();
  const start = useStartCampaign();

  const [title, setTitle] = useState(PRESETS[0]!.title);
  const [objective, setObjective] = useState(PRESETS[0]!.objective);
  const [goalKind, setGoalKind] = useState<CampaignGoalKind>('signup');
  const [goalTarget, setGoalTarget] = useState('1');
  const [goalScope, setGoalScope] = useState<CampaignScope>('any');
  const [focusSegment, setFocusSegment] = useState('');
  const [focusCity, setFocusCity] = useState('');
  const [budgetUsd, setBudgetUsd] = useState('20');
  const [maxDays, setMaxDays] = useState('7');
  const [maxHuntsPerDay, setMaxHuntsPerDay] = useState('3');
  const [targetWip, setTargetWip] = useState('15');
  const [allowExistingLeads, setAllowExistingLeads] = useState(true);
  const [autopilotChoice, setAutopilotChoice] = useState<boolean | null>(null);

  const needsAutopilot = Boolean(preflight && preflight.autonomyLevel !== 'autopilot');
  const enableAutopilot = autopilotChoice ?? preflight?.autonomyLevel === 'off';

  useEffect(() => {
    if (!open) setAutopilotChoice(null);
  }, [open]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setTitle(p.title);
    setObjective(p.objective);
    setGoalKind(p.goalKind);
    setGoalTarget(String(p.goalTarget));
    setBudgetUsd(String(p.budgetUsd));
    setMaxDays(String(p.maxDays));
  };

  const canSubmit = Boolean(title.trim() && objective.trim()) && !start.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    const num = (v: string, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const payload: StartCampaignPayload = {
      title: title.trim(),
      objective: objective.trim(),
      goalKind,
      goalTarget: Math.min(100, Math.max(1, Math.round(num(goalTarget, 1)))),
      goalScope,
      budgetUsd: Math.min(1000, Math.max(1, num(budgetUsd, 20))),
      maxDays: Math.min(60, Math.max(1, Math.round(num(maxDays, 7)))),
      maxHuntsPerDay: Math.min(12, Math.max(1, Math.round(num(maxHuntsPerDay, 3)))),
      targetWip: Math.min(80, Math.max(3, Math.round(num(targetWip, 15)))),
      allowExistingLeads,
      ...(focusSegment.trim() ? { focusSegment: focusSegment.trim() } : {}),
      ...(focusCity.trim() ? { focusCity: focusCity.trim() } : {}),
      ...(needsAutopilot && enableAutopilot ? { enableAutopilot: true } : {}),
    };
    const res = await start.mutateAsync(payload);
    onOpenChange(false);
    onCreated(res.campaign.id);
  };

  const signupBlocked = goalKind === 'signup' && preflight && !preflight.signupOpen;

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="nova campanha autônoma"
      description="o diretor busca leads, aborda no ritmo seguro e para sozinho ao bater a meta"
      width="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            cancelar
          </Button>
          <Button variant="agent" disabled={!canSubmit} onClick={() => void submit()}>
            {start.isPending ? (
              <>
                <Loader2 className="animate-spin" /> iniciando…
              </>
            ) : (
              <>
                <Rocket /> iniciar campanha
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">modelos rápidos:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="rounded-md border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
            >
              {p.label}
            </button>
          ))}
        </div>

        {(signupBlocked || (preflight && !preflight.channels.any)) && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-0.5">
              {signupBlocked && (
                <p>o cadastro online está fechado agora — a campanha vai pausar até você abrir.</p>
              )}
              {preflight && !preflight.channels.any && (
                <p>nenhum canal de envio (WhatsApp, Instagram ou email) está conectado.</p>
              )}
            </div>
          </div>
        )}

        <Field label="título" htmlFor="camp-title">
          <Input
            id="camp-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            placeholder="ex: primeiro cadastro de confeitarias"
          />
        </Field>

        <Field label="objetivo e instruções para o diretor" htmlFor="camp-obj">
          <Textarea
            id="camp-obj"
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            maxLength={2000}
            placeholder="descreva o que o diretor deve perseguir, nichos preferidos ou restrições…"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_92px]">
          <Field label="tipo da meta">
            <Segmented
              value={goalKind}
              onChange={setGoalKind}
              options={GOAL_OPTS}
              className="self-start"
            />
          </Field>
          <Field label="quantidade" htmlFor="camp-target">
            <Input
              id="camp-target"
              type="number"
              min={1}
              max={100}
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
              className="tnum"
            />
          </Field>
        </div>

        <Field
          label="contagem da meta"
          hint="em 'qualquer lead', o primeiro lead do CRM que converter já encerra a campanha"
        >
          <Segmented
            value={goalScope}
            onChange={setGoalScope}
            options={SCOPE_OPTS}
            className="self-start"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="segmento inicial (opcional)" htmlFor="camp-seg">
            <Input
              id="camp-seg"
              list="camp-segs"
              value={focusSegment}
              onChange={(e) => setFocusSegment(e.target.value)}
              placeholder="vazio = diretor escolhe"
              autoComplete="off"
            />
            <datalist id="camp-segs">
              {(segs.data ?? []).map((s) => (
                <option key={s.segment} value={s.segment} />
              ))}
            </datalist>
          </Field>
          <Field label="cidade inicial (opcional)" htmlFor="camp-city">
            <Input
              id="camp-city"
              value={focusCity}
              onChange={(e) => setFocusCity(e.target.value)}
              placeholder="vazio = Brasil todo"
            />
          </Field>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="mb-2.5 text-xs font-medium text-foreground">guardrails e ritmo</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="orçamento (US$)" htmlFor="camp-budget">
              <Input
                id="camp-budget"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                className="tnum"
              />
            </Field>
            <Field label="prazo máximo (dias)" htmlFor="camp-days">
              <Input
                id="camp-days"
                type="number"
                min={1}
                max={60}
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                className="tnum"
              />
            </Field>
            <Field label="buscas / dia" htmlFor="camp-hunts">
              <Input
                id="camp-hunts"
                type="number"
                min={1}
                max={12}
                value={maxHuntsPerDay}
                onChange={(e) => setMaxHuntsPerDay(e.target.value)}
                className="tnum"
              />
            </Field>
            <Field label="WIP alvo (leads ativos)" htmlFor="camp-wip">
              <Input
                id="camp-wip"
                type="number"
                min={3}
                max={80}
                value={targetWip}
                onChange={(e) => setTargetWip(e.target.value)}
                className="tnum"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">ativar leads intocados do CRM</p>
            <p className="text-xs text-muted-foreground">
              aproveita leads existentes antes de gastar orçamento com novas buscas
            </p>
          </div>
          <Switch checked={allowExistingLeads} onCheckedChange={setAllowExistingLeads} />
        </div>

        {needsAutopilot && preflight && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">ligar piloto automático ao iniciar</p>
              <p className="text-xs text-muted-foreground">
                autonomia atual:{' '}
                <span className="font-medium text-foreground">
                  {AUTONOMY_LABEL[preflight.autonomyLevel]}
                </span>
                . esta opção muda a autonomia de todo o CRM.
              </p>
            </div>
            <Switch checked={enableAutopilot} onCheckedChange={setAutopilotChoice} />
          </div>
        )}
      </form>
    </ResponsiveSheet>
  );
}
