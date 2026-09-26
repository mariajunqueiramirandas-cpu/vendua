import type { ReactNode } from 'react';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { AreaIntro, FieldError, ListEditor, RawJson, SaveBar, useDraft } from './bits.tsx';
import { num, obj, str, tzValid, type SettingsMap, type SettingWrite } from './settings.ts';

type Save = (key: string, v: SettingWrite) => Promise<boolean>;

export function LimitsArea({
  map,
  save,
  pending,
}: {
  map: SettingsMap;
  save: Save;
  pending: boolean;
}) {
  return (
    <>
      <AreaIntro>limites que o código impõe em todo run — não dependem do prompt</AreaIntro>
      <Guardrails value={obj(map.guardrails)} save={save} pending={pending} />
    </>
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

function Guardrails({
  value,
  save,
  pending,
}: {
  value: Record<string, unknown>;
  save: Save;
  pending: boolean;
}) {
  const cur = {
    maxOutboundPerLeadPerDay: num(value.maxOutboundPerLeadPerDay, 3),
    quietStart: str(value.quietStart, '21:00'),
    quietEnd: str(value.quietEnd, '08:00'),
    timezone: str(value.timezone, 'America/Sao_Paulo'),
    discoveryAutoContact: value.discoveryAutoContact !== false,
    discoveryContactMinScore: num(value.discoveryContactMinScore, 8),
    inboundReplyDelayMin: num(value.inboundReplyDelayMin, 0),
    firstContactDelayMin: num(value.firstContactDelayMin, 0),
    followupCadenceDays: num(value.followupCadenceDays, 2),
    staleDraftDays: num(value.staleDraftDays, 7),
    briefAutoPauseRuns: num(value.briefAutoPauseRuns, 5),
    instagramColdDmsPerDay: num(value.instagramColdDmsPerDay, 15),
    ignoredPhones: Array.isArray(value.ignoredPhones) ? (value.ignoredPhones as string[]) : [],
  };
  const { edit, setEdit, dirty, reset } = useDraft(cur);
  const quietWrap = edit.quietStart > edit.quietEnd;
  const tzOk = tzValid(edit.timezone);
  const phonesBad = edit.ignoredPhones.some((p) => {
    const d = p.replace(/\D/g, '');
    return d.length < 6 || d.length > 15;
  });
  const invalid = !tzOk || phonesBad;
  const numIn = (
    k:
      | 'maxOutboundPerLeadPerDay'
      | 'discoveryContactMinScore'
      | 'inboundReplyDelayMin'
      | 'firstContactDelayMin'
      | 'followupCadenceDays'
      | 'staleDraftDays'
      | 'briefAutoPauseRuns'
      | 'instagramColdDmsPerDay',
    min: number,
    max: number,
    floor: number,
  ) => (
    <Input
      id={`gr-${k}`}
      type="number"
      inputMode="numeric"
      className="lg:max-w-48"
      min={min}
      max={max}
      value={edit[k]}
      onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) || floor })}
    />
  );

  return (
    <Panel title="limites">
      <div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
        <Field label="msgs/dia por lead" htmlFor="gr-maxOutboundPerLeadPerDay">
          {numIn('maxOutboundPerLeadPerDay', 1, 100, 1)}
        </Field>
        <Field
          label={
            <>horário de silêncio {quietWrap && <em className="not-italic">(vira o dia)</em>}</>
          }
          hint="o agente não envia nada dentro dessa janela"
        >
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label="início do silêncio"
              value={edit.quietStart}
              onChange={(e) => setEdit({ ...edit, quietStart: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="time"
              aria-label="fim do silêncio"
              value={edit.quietEnd}
              onChange={(e) => setEdit({ ...edit, quietEnd: e.target.value })}
            />
          </div>
        </Field>
        <Field label="fuso" htmlFor="gr-tz">
          <Input
            id="gr-tz"
            list="tz-list"
            value={edit.timezone}
            onChange={(e) => setEdit({ ...edit, timezone: e.target.value })}
          />
          {!tzOk && <FieldError>fuso IANA inválido</FieldError>}
        </Field>
        <Field
          label="autocontato no discovery"
          hint="lead descoberto com fitScore ≥ o mínimo ganha um run de outreach na hora"
        >
          <Toggle
            checked={edit.discoveryAutoContact}
            onChange={(v) => setEdit({ ...edit, discoveryAutoContact: v })}
          >
            {edit.discoveryAutoContact ? 'nota alta chama no whatsapp' : 'só cria o card'}
          </Toggle>
        </Field>
        <Field
          label="nota p/ autocontato"
          htmlFor="gr-discoveryContactMinScore"
          hint="fitScore mínimo p/ o agente chamar no whatsapp sozinho"
        >
          {numIn('discoveryContactMinScore', 1, 10, 1)}
        </Field>
        <Field
          label="resposta do agente (min)"
          htmlFor="gr-inboundReplyDelayMin"
          hint="0 = responde na hora; >0 o agente espera esse tempo depois da mensagem chegar"
        >
          {numIn('inboundReplyDelayMin', 0, 1440, 0)}
        </Field>
        <Field
          label="1º contato automático (min)"
          htmlFor="gr-firstContactDelayMin"
          hint="0 = roda na hora, só rascunho (pesquisa + 1º contato pra aprovar); >0 agenda o run esse tempo depois do lead ser criado (modo do lead decide rascunho vs. envio)"
        >
          {numIn('firstContactDelayMin', 0, 10080, 0)}
        </Field>
        <Field
          label="cadência p/ retorno (dias)"
          htmlFor="gr-followupCadenceDays"
          hint="envio do agente sem resposta agenda o próximo contato; 0 = desligado (nunca sobrescreve uma data que o agente já marcou)"
        >
          {numIn('followupCadenceDays', 0, 90, 0)}
        </Field>
        <Field
          label="rascunho expira (dias)"
          htmlFor="gr-staleDraftDays"
          hint="aprovar rascunho do agente mais velho que isso não envia — regenera contra o estado atual do lead; 0 = desligado"
        >
          {numIn('staleDraftDays', 0, 90, 0)}
        </Field>
        <Field
          label="auto-pausa de brief (runs)"
          htmlFor="gr-briefAutoPauseRuns"
          hint="runs seguidas do mesmo brief sem lead novo pausam ele sozinho; 0 = nunca pausa"
        >
          {numIn('briefAutoPauseRuns', 0, 100, 0)}
        </Field>
        <Field
          label="DMs frias no instagram / dia"
          htmlFor="gr-instagramColdDmsPerDay"
          hint="teto da conta inteira pra DM do agente a quem nunca escreveu (24h corridas) — respostas não contam; 0 = sem DM fria"
        >
          {numIn('instagramColdDmsPerDay', 0, 200, 0)}
        </Field>
        <Field
          label="números ignorados (equipe / founders)"
          hint="mensagem desses números não vira lead e nada sai para eles — whatsapp ou phone do lead"
          className="lg:col-span-2"
        >
          <ListEditor
            items={edit.ignoredPhones}
            placeholder="+55 11 99999-0000"
            max={100}
            maxLen={40}
            onChange={(ignoredPhones) => setEdit({ ...edit, ignoredPhones })}
          />
          {phonesBad && <FieldError>cada número precisa ter de 6 a 15 dígitos</FieldError>}
        </Field>
      </div>
      <SaveBar
        label="salvar limites"
        dirty={dirty}
        disabled={invalid}
        pending={pending}
        onReset={reset}
        // PUT replaces the whole setting — merge over the stored value or raw-JSON keys would be dropped
        onSave={() => void save('guardrails', (c: unknown) => ({ ...obj(c), ...edit }))}
      />
      <RawJson value={value} onSave={(v) => void save('guardrails', v)} />
    </Panel>
  );
}
