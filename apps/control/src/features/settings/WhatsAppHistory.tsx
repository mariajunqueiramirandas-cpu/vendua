import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ErrorHint, SaveBar } from './bits.tsx';
import { num, str } from './queries.ts';

type Mode = 'leads' | 'existing' | 'off';
type LeadMode = 'inbound' | 'draft' | 'off';

const MODES: Mode[] = ['leads', 'existing', 'off'];
const LEAD_MODES: LeadMode[] = ['inbound', 'draft', 'off'];
// mirrors WA_HISTORY_MAX_AGE_DAYS in core
const MAX_AGE = 3650;

/**
 * `whatsapp_history` — what the pairing-time history sync may do. Applies to the
 * next pairing (and chunks the phone still sends); what's already imported stays.
 */
export function WhatsAppHistory({
  value,
  onSave,
  saving,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const mode = str(value.mode, 'leads') as Mode;
  const leadMode = str(value.leadMode, 'inbound') as LeadMode;
  const cur = {
    mode: MODES.includes(mode) ? mode : 'leads',
    maxAgeDays: num(value.maxAgeDays, 0),
    leadMode: LEAD_MODES.includes(leadMode) ? leadMode : 'inbound',
  };
  const curKey = JSON.stringify(cur);
  const [edit, setEdit] = useState(cur);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdit(cur), [curKey]);
  const dirty = JSON.stringify(edit) !== curKey;
  const badAge =
    !Number.isInteger(edit.maxAgeDays) || edit.maxAgeDays < 0 || edit.maxAgeDays > MAX_AGE;

  return (
    <Panel
      title="histórico do whatsapp"
      aside={
        <span className="hidden md:inline">conversas que já estavam no aparelho ao parear</span>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="importar" htmlFor="wa-hist-mode">
          <Select
            id="wa-hist-mode"
            value={edit.mode}
            onChange={(e) => setEdit({ ...edit, mode: e.target.value as Mode })}
          >
            <option value="leads">tudo — contato novo vira lead</option>
            <option value="existing">só de leads que já existem</option>
            <option value="off">nada</option>
          </Select>
        </Field>
        <Field
          label="até quantos dias atrás"
          htmlFor="wa-hist-age"
          hint={edit.maxAgeDays === 0 ? 'sem limite' : undefined}
        >
          <Input
            id="wa-hist-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_AGE}
            disabled={edit.mode === 'off'}
            value={edit.maxAgeDays}
            aria-invalid={badAge}
            onChange={(e) => setEdit({ ...edit, maxAgeDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="leads do histórico começam em" htmlFor="wa-hist-lead">
          <Select
            id="wa-hist-lead"
            disabled={edit.mode !== 'leads'}
            value={edit.leadMode}
            onChange={(e) => setEdit({ ...edit, leadMode: e.target.value as LeadMode })}
          >
            <option value="inbound">igual aos leads que chegam sozinhos</option>
            <option value="draft">rascunho (tudo espera aprovação)</option>
            <option value="off">agente desligado</option>
          </Select>
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        o histórico entra só como contexto — o agente nunca responde mensagem antiga. vale para o
        próximo pareamento; o que já foi importado fica.
      </p>
      {badAge && <ErrorHint>dias: um inteiro de 0 a {MAX_AGE}</ErrorHint>}
      <SaveBar pinned={dirty} inCard>
        <Button size="sm" disabled={!dirty || badAge || saving} onClick={() => onSave(edit)}>
          salvar
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setEdit(cur)}>
            descartar
          </Button>
        )}
      </SaveBar>
    </Panel>
  );
}
