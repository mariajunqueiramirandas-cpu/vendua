import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Incident } from '@/lib/api.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { errorMessage } from '@/lib/query.ts';
import { ConfirmButton } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { SEVERITIES } from './bits.tsx';
import { useResolveIncident, useSaveIncident, type IncidentDraft } from './queries.ts';

const TITLE_MAX = 120;
const BODY_MAX = 1000;
const EMPTY: IncidentDraft = { title: '', body: '', severity: 'degraded' };

const Counter = ({ n, max }: { n: number; max: number }) => (
  <span className="tnum">
    {n}/{max}
  </span>
);

/** New incident (`incident` null) or edit an existing one; resolve lives in the footer. */
export function IncidentSheet({
  open,
  incident,
  onClose,
}: {
  open: boolean;
  incident: Incident | null;
  onClose: () => void;
}) {
  const [d, setD] = useState<IncidentDraft>(EMPTY);
  const [err, setErr] = useState('');
  const save = useSaveIncident();
  const resolve = useResolveIncident();

  useEffect(() => {
    if (!open) return;
    setErr('');
    setD(
      incident
        ? { title: incident.title, body: incident.body ?? '', severity: incident.severity }
        : EMPTY,
    );
  }, [open, incident?.id]);

  const title = d.title.trim();
  const valid = title.length >= 3 && title.length <= TITLE_MAX && d.body.length <= BODY_MAX;
  const submit = () => {
    if (!valid || save.isPending) return;
    setErr('');
    save.mutate(
      { id: incident?.id ?? null, draft: { ...d, title, body: d.body.trim() } },
      { onSuccess: onClose, onError: (e) => setErr(errorMessage(e)) },
    );
  };
  const resolved = !!incident?.resolvedAt;

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={incident ? 'editar incidente' : 'novo incidente'}
      description={
        resolved
          ? `resolvido em ${fmtDateTime(incident?.resolvedAt)}`
          : 'aparece na Ajuda de todos os lojistas e em status.vendua.com.br'
      }
      footer={
        <>
          {incident && !resolved && (
            <ConfirmButton
              variant="outline"
              confirm="resolver agora?"
              disabled={resolve.isPending}
              onConfirm={() => resolve.mutate(incident.id, { onSuccess: onClose })}
              className="md:mr-auto"
            >
              <CheckCircle2 /> resolver
            </ConfirmButton>
          )}
          <Button disabled={!valid || save.isPending} onClick={submit}>
            {save.isPending ? 'salvando…' : incident ? 'salvar' : 'publicar'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="gravidade">
          <Segmented
            value={d.severity}
            onChange={(severity) => setD((p) => ({ ...p, severity }))}
            options={SEVERITIES}
            className="self-start"
          />
        </Field>
        <Field
          label="título"
          htmlFor="incident-title"
          hint={
            <span className="flex justify-between gap-2">
              <span>o que o lojista lê primeiro — mínimo 3 caracteres</span>
              <Counter n={d.title.length} max={TITLE_MAX} />
            </span>
          }
        >
          <Input
            id="incident-title"
            autoFocus={!incident}
            value={d.title}
            maxLength={TITLE_MAX}
            onChange={(e) => setD((p) => ({ ...p, title: e.target.value }))}
            placeholder="ex.: pagamentos por Pix com atraso"
          />
        </Field>
        <Field
          label="detalhes"
          htmlFor="incident-body"
          hint={
            <span className="flex justify-between gap-2">
              <span>opcional</span>
              <Counter n={d.body.length} max={BODY_MAX} />
            </span>
          }
        >
          <Textarea
            id="incident-body"
            value={d.body}
            maxLength={BODY_MAX}
            rows={5}
            onChange={(e) => setD((p) => ({ ...p, body: e.target.value }))}
            placeholder="o que está acontecendo e o que o lojista pode fazer enquanto isso"
          />
        </Field>
        {err && (
          <p role="alert" className="text-xs text-destructive-foreground">
            {err}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </ResponsiveSheet>
  );
}
