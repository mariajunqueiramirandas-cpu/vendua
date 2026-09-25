import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { AGENT_GOALS, AGENT_MODES } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';

const MODE_NOTE: Record<string, string> = {
  off: 'a equipe toca o lead — o agente não tria nem fala com ele',
  draft: 'o agente tria e prepara mensagens — você aprova cada envio no inbox',
  auto: 'o agente tria e conversa sozinho, dentro das guardrails',
};

const EMPTY_FORM = {
  name: '',
  businessName: '',
  whatsapp: '',
  email: '',
  instagram: '',
  city: '',
  segment: '',
  source: '',
  deal: '',
};
type Form = typeof EMPTY_FORM;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Advisory({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning-foreground">
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function NewLeadSheet({
  open,
  onClose,
  segments,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  segments: string[];
  sources: string[];
}) {
  const [f, setF] = useState<Form>(EMPTY_FORM);
  const [mode, setMode] = useState<'off' | 'draft' | 'auto'>('draft');
  const [goal, setGoal] = useState<'negotiation' | 'meeting'>('negotiation');
  const [err, setErr] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');
  const nav = useNavigate();
  const client = useQueryClient();

  // every open starts from a blank form, like the old drawer's remount
  useEffect(() => {
    if (!open) return;
    setF(EMPTY_FORM);
    setMode('draft');
    setGoal('negotiation');
    setErr('');
    setCreatedMsg('');
  }, [open]);

  // Soft duplicate guard — probe any channel or the name via the list's q-search.
  const probe = [f.whatsapp, f.email, f.instagram].map((v) => v.trim()).find((v) => v.length >= 4);
  const term = useDebounced(probe ?? (f.name.trim().length >= 4 ? f.name.trim() : ''), 350);
  const dupes = useQuery({
    queryKey: qk.leads({ q: term, limit: '5', probe: '1' }),
    queryFn: () => api.leads({ q: term, limit: '5' }),
    enabled: open && !!term,
  });
  const dupeList = term ? (dupes.data?.leads ?? []) : [];

  const create = useMutation({
    mutationFn: api.createLead,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.leads() });
      void client.invalidateQueries({ queryKey: qk.stats() });
    },
  });

  const noChannel = !f.whatsapp.trim() && !f.email.trim() && !f.instagram.trim();

  const submit = async (openAfter: boolean) => {
    if (!f.name.trim()) return;
    setErr('');
    try {
      const wa = f.whatsapp.replace(/[^\d+]/g, '');
      const res = await create.mutateAsync({
        name: f.name,
        businessName: f.businessName || null,
        whatsapp: wa || null,
        email: f.email || null,
        instagram: f.instagram.replace(/^@/, '') || null,
        city: f.city || null,
        segment: f.segment || null,
        source: f.source || null,
        dealValueCents: f.deal ? Math.round(Number(f.deal.replace(',', '.')) * 100) : null,
        agentMode: mode,
        ...(mode === 'off' ? { automation: false } : { agentGoal: goal }),
      });
      if (openAfter) {
        onClose();
        nav(`/pipeline/${res.lead.id}`);
      } else {
        // "criar + outro" — the list reloads; the sheet stays open on a blank form.
        setF(EMPTY_FORM);
        setCreatedMsg('lead criado — cadastre o próximo');
      }
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const field = (k: keyof Form, label: string, extra: Record<string, string> = {}) => (
    <Field label={label} htmlFor={`nl-${k}`}>
      <Input
        id={`nl-${k}`}
        value={f[k]}
        autoFocus={k === 'name'}
        onChange={(e) => {
          setF({ ...f, [k]: e.target.value });
          setCreatedMsg('');
        }}
        {...extra}
      />
    </Field>
  );

  const busy = create.isPending;
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="novo lead"
      description={
        createdMsg ? (
          <Badge variant="agent">
            <Check /> {createdMsg}
          </Badge>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" className="max-md:hidden" onClick={onClose}>
            cancelar
          </Button>
          <Button
            variant="outline"
            disabled={busy || !f.name.trim()}
            onClick={() => void submit(false)}
          >
            criar + outro
          </Button>
          <Button type="submit" form="new-lead-form" disabled={busy || !f.name.trim()}>
            criar e abrir
          </Button>
        </>
      }
    >
      <form
        id="new-lead-form"
        className="flex flex-col gap-5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <Section title="identidade">
          {field('name', 'nome *', { autoComplete: 'off' })}
          {field('businessName', 'negócio')}
        </Section>

        <Section title="contato">
          {field('whatsapp', 'whatsapp', { placeholder: '+55 85 9…', inputMode: 'tel' })}
          {field('email', 'email', { type: 'email', inputMode: 'email' })}
          {field('instagram', 'instagram', { placeholder: '@perfil' })}
          {noChannel && <Advisory>sem canal — o agente não consegue falar com este lead</Advisory>}
          {dupeList.length > 0 && (
            <Advisory>
              possível duplicata:{' '}
              {dupeList.slice(0, 3).map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ' · '}
                  <Link to={`/pipeline/${d.id}`} className="font-medium underline">
                    {d.name}
                  </Link>
                </span>
              ))}
            </Advisory>
          )}
        </Section>

        <Section title="contexto">
          <div className="grid grid-cols-2 gap-2.5">
            {field('city', 'cidade')}
            {field('segment', 'segmento', { list: 'nl-segs' })}
          </div>
          {field('source', 'origem', {
            placeholder: 'instagram, indicação, lista…',
            list: 'nl-srcs',
          })}
          {field('deal', 'valor estimado (R$)', { inputMode: 'decimal' })}
          <datalist id="nl-segs">
            {segments.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <datalist id="nl-srcs">
            {sources.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Section>

        <Section title="agente">
          <Field label="modo">
            <Segmented
              value={mode}
              onChange={setMode}
              options={AGENT_MODES}
              className="self-start"
            />
          </Field>
          {mode !== 'off' && (
            <Field label="objetivo">
              <Segmented
                value={goal}
                onChange={setGoal}
                options={AGENT_GOALS}
                className="self-start"
              />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">{MODE_NOTE[mode]}</p>
        </Section>
        {err && <p className="text-xs text-destructive-foreground">{err}</p>}
      </form>
    </ResponsiveSheet>
  );
}
