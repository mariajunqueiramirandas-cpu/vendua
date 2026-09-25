import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import {
  api,
  type AgentPlaybookInfo,
  type PlaybookKind,
  type PlaybookOverride,
} from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { qk } from '@/lib/query.ts';
import { ConfirmButton } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { AreaIntro, EndpointState, RawJson, useDraft } from './bits.tsx';
import { obj, type SettingsMap, type SettingWrite } from './settings.ts';

type Save = (key: string, v: SettingWrite) => Promise<boolean>;

const TRIGGER_LABEL: Record<string, string> = {
  staff: 'equipe',
  inbound: 'resposta',
  'next-action': 'sequência',
  wakeup: 'retorno',
  discovery: 'descoberta',
  'first-contact': '1º contato',
  brief: 'brief',
  weekly: 'semanal',
};

export function PlaybooksArea({
  map,
  save,
  active,
}: {
  map: SettingsMap;
  save: Save;
  active: boolean;
}) {
  // dormant until the area opens
  const q = useQuery({
    queryKey: qk.playbooks(),
    queryFn: api.playbooks,
    select: (r) => r.playbooks,
    enabled: active,
  });
  const [editing, setEditing] = useState<PlaybookKind | null>(null);

  const savePlaybook = (kind: PlaybookKind, ov: PlaybookOverride | null) =>
    save('agent_playbooks', (cur: unknown) => {
      const next = { ...((cur ?? {}) as Record<string, PlaybookOverride>) };
      if (ov === null) delete next[kind];
      else next[kind] = ov;
      return next;
    });

  const intro = (
    <AreaIntro>os modos de trabalho — gatilhos, ferramentas e orçamento de cada um</AreaIntro>
  );

  if (!q.data) {
    return (
      <>
        {intro}
        <div className="flex flex-col gap-3">
          <EndpointState
            title="catálogo de playbooks"
            error={q.error}
            missing="GET /agent/playbooks ainda não chegou neste servidor — enquanto isso dá pra escrever os ajustes pelo json bruto abaixo."
            onRetry={() => void q.refetch()}
          />
          {q.error != null && (
            <Panel title="ajustes brutos">
              <RawJson
                value={obj(map.agent_playbooks)}
                onSave={(v) => void save('agent_playbooks', v)}
              />
            </Panel>
          )}
        </div>
      </>
    );
  }

  const current = q.data.find((p) => p.kind === editing) ?? null;
  return (
    <>
      {intro}
      <div className="grid gap-3 lg:grid-cols-2 min-[90rem]:grid-cols-3">
        {q.data.map((pb) => (
          <PlaybookCard key={pb.kind} pb={pb} onEdit={() => setEditing(pb.kind)} />
        ))}
      </div>
      <ResponsiveSheet
        open={current !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `ajustar ${current.label}` : 'ajustar'}
        description={current?.kind}
      >
        {current && (
          <PlaybookForm
            pb={current}
            onSave={(ov) =>
              void savePlaybook(current.kind, ov).then((ok) => ok && setEditing(null))
            }
          />
        )}
      </ResponsiveSheet>
    </>
  );
}

// form = effective values (override over defaults)
const effective = (pb: AgentPlaybookInfo) => ({
  enabled: pb.override.enabled ?? true,
  stepBudget: pb.override.stepBudget ?? pb.defaults.stepBudget,
  model: pb.override.model ?? '',
  instructions: pb.override.instructions ?? '',
  monidCapUsd: pb.override.monidCapUsd ?? pb.defaults.monidCapUsd,
});

function PlaybookCard({ pb, onEdit }: { pb: AgentPlaybookInfo; onEdit: () => void }) {
  const eff = effective(pb);
  const hasOverride = Object.keys(pb.override).length > 0;
  const chip = (on: boolean) => (on ? 'agent-soft' : 'outline');
  return (
    <Panel
      title={pb.label}
      aside={<span className="font-mono">{pb.kind}</span>}
      actions={
        <Badge variant={eff.enabled ? 'agent' : 'default'}>
          {eff.enabled ? 'ativo' : 'desligado'}
        </Badge>
      }
      className={cn(!eff.enabled && 'opacity-80')}
      bodyClassName="flex flex-col gap-2.5"
    >
      <p className="text-sm text-muted-foreground">{pb.description}</p>
      <div className="flex flex-wrap gap-1">
        {pb.triggers.map((t) => (
          <Badge key={t}>{TRIGGER_LABEL[t] ?? t}</Badge>
        ))}
        {pb.debrief && <Badge>memoriza o que aprendeu</Badge>}
      </div>
      <div className="flex flex-wrap gap-1">
        {pb.tools.map((t) => (
          <Badge key={t} variant="outline" className="font-mono font-normal">
            {t}
          </Badge>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1 border-t pt-2.5">
        <Badge variant={chip(pb.override.stepBudget !== undefined)} className="tnum">
          {eff.stepBudget} passos
        </Badge>
        <Badge variant={chip(pb.override.monidCapUsd !== undefined)} className="tnum">
          teto ${eff.monidCapUsd.toFixed(2)}
        </Badge>
        <Badge variant={chip(pb.override.model !== undefined && pb.override.model !== null)}>
          {eff.model || 'modelo do workspace'}
        </Badge>
        {eff.instructions && (
          <Badge variant="agent-soft">+instruções ({eff.instructions.length}ch)</Badge>
        )}
        {hasOverride && <Badge variant="warn">ajustado</Badge>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={onEdit}>
          <SlidersHorizontal /> ajustar
        </Button>
      </div>
    </Panel>
  );
}

function PlaybookForm({
  pb,
  onSave,
}: {
  pb: AgentPlaybookInfo;
  onSave: (ov: PlaybookOverride | null) => void;
}) {
  // a save writes the whole override explicitly; "voltar ao padrão" removes the kind's key
  const { edit, setEdit, dirty, reset } = useDraft(effective(pb));
  const hasOverride = Object.keys(pb.override).length > 0;
  const invalid =
    !Number.isInteger(edit.stepBudget) ||
    edit.stepBudget < 1 ||
    edit.stepBudget > 60 ||
    !Number.isFinite(edit.monidCapUsd) ||
    edit.monidCapUsd < 0 ||
    edit.monidCapUsd > 5 ||
    edit.model.trim().length > 100 ||
    edit.instructions.length > 4000;

  const save = () =>
    onSave({
      enabled: edit.enabled,
      stepBudget: edit.stepBudget,
      model: edit.model.trim() || null,
      instructions: edit.instructions,
      monidCapUsd: edit.monidCapUsd,
    });

  return (
    <div className="flex flex-col gap-3">
      <Field label="ativo">
        <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-10">
          <Switch
            checked={edit.enabled}
            onCheckedChange={(v) => setEdit({ ...edit, enabled: v })}
          />
          {edit.enabled ? 'roda nos gatilhos' : 'não roda'}
        </label>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="orçamento (passos)"
          htmlFor="pb-steps"
          hint={`padrão ${pb.defaults.stepBudget} · 1–60`}
        >
          <Input
            id="pb-steps"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={edit.stepBudget}
            onChange={(e) => setEdit({ ...edit, stepBudget: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="teto monid (US$)"
          htmlFor="pb-cap"
          hint={`padrão $${pb.defaults.monidCapUsd.toFixed(2)} · 0–5`}
        >
          <Input
            id="pb-cap"
            type="number"
            inputMode="decimal"
            min={0}
            max={5}
            step={0.05}
            value={edit.monidCapUsd}
            onChange={(e) => setEdit({ ...edit, monidCapUsd: Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field
        label="modelo"
        htmlFor="pb-model"
        hint="vazio = o modelo que o workspace escolheu nas conexões"
      >
        <Input
          id="pb-model"
          value={edit.model}
          maxLength={100}
          placeholder="padrão do workspace"
          onChange={(e) => setEdit({ ...edit, model: e.target.value })}
        />
      </Field>
      <Field label={`instruções extras (${edit.instructions.length}/4000)`} htmlFor="pb-instr">
        <Textarea
          id="pb-instr"
          rows={5}
          value={edit.instructions}
          maxLength={4000}
          placeholder="vai junto do system prompt desse playbook — ex.: 'sempre mencione o frete grátis'"
          onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
        />
      </Field>
      {invalid && (
        <p className="text-xs text-destructive-foreground">
          confira os limites: passos inteiros de 1 a 60, teto de 0 a 5
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button disabled={!dirty || invalid} onClick={save}>
          salvar ajuste
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={reset}>
            desfazer
          </Button>
        )}
        {hasOverride && (
          <ConfirmButton
            className="ml-auto"
            variant="destructive-outline"
            confirm="volta tudo ao padrão?"
            onConfirm={() => onSave(null)}
          >
            voltar ao padrão
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
