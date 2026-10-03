import { Trash } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.ts';
import { Button } from '../../ui/Button.tsx';
import { Field, Segmented, TextArea, TextInput } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { GuaranteeChip } from '../../ui/vendedor/index.ts';

export type TeachKind = 'answer' | 'rule';
export interface TeachValues {
  kind: TeachKind;
  question: string;
  answer: string;
}

// Core's bounds (routes-vendedor.ts): question 3–500, answer 1–2000, a rule's words 3–500
const Q_MAX = 500;
const A_MAX = 2000;
const R_MAX = 500;

function useDebounced<T>(v: T, ms: number) {
  const [d, set] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => set(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Core's own words name the persona "a Ana"; say the name this store chose. */
export const withName = (text: string, name: string) => text.replace(/\ba Ana\b/g, `a ${name}`);

/**
 * What a rule will be before it's saved: "sempre cumprida" when Core recognizes and enforces
 * it, "orientação" otherwise (sales-agent-ux §3.5). Asked of Core as the words settle.
 */
export function RulePreview({ text, name }: { text: string; name: string }) {
  const words = useDebounced(text.trim(), 400);
  const ready = words.length >= 3;
  const { data, isFetching } = useQuery({
    queryKey: ['vendedor', 'rule-preview', words],
    queryFn: () => api.vendedor.previewRule(words),
    enabled: ready,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  if (!ready) return null;
  return (
    <div
      className="flex flex-col gap-2 rounded-md p-3.5 ring-1 ring-inset ring-line-strong"
      aria-live="polite"
      aria-busy={isFetching || undefined}
    >
      <div className="flex items-center gap-2">
        <span className="t-caption font-semibold text-muted">Como fica</span>
        {isFetching ? <Spinner className="size-3.5" /> : null}
      </div>
      {data ? (
        <>
          <GuaranteeChip guaranteed={data.guaranteed} name={name} className="self-start" />
          <p className="t-body">
            {data.guaranteed && data.guarantee
              ? withName(data.guarantee, name)
              : `A ${name} segue como uma instrução para a equipe. Para ser sempre cumprida, fale de valor ou quantidade, como "não aceite dinheiro acima de R$ 200".`}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * New, edited or learned knowledge: an answer (question + reply) or a rule (its words, with
 * the guarantee preview). `kinds` lets Ensaio's "ensinar como eu fiz" pick either.
 */
export function TeachSheet({
  open,
  onOpenChange,
  title,
  description,
  initial,
  kinds,
  name,
  submitLabel,
  busy,
  onSubmit,
  onDelete,
  deleting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string | undefined;
  initial: TeachValues;
  /** offer both kinds (Ensaio); otherwise the initial kind is fixed */
  kinds?: boolean | undefined;
  name: string;
  submitLabel: string;
  busy?: boolean | undefined;
  onSubmit: (v: TeachValues) => void;
  onDelete?: (() => void) | undefined;
  deleting?: boolean | undefined;
}) {
  const formId = useId();
  const [v, setV] = useState(initial);
  const [tried, setTried] = useState(false);
  // a fresh form each time the sheet opens on something new
  const seed = `${initial.kind}|${initial.question}|${initial.answer}`;
  useEffect(() => {
    if (open) {
      setV(initial);
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  const q = v.question.trim();
  const a = v.answer.trim();
  const errQ =
    v.kind === 'answer' && q.length < 3 ? 'Escreva a pergunta como o cliente faz.' : null;
  const errA =
    v.kind === 'answer'
      ? a.length < 1
        ? 'Escreva a resposta.'
        : null
      : a.length < 3
        ? 'Escreva a regra com as suas palavras.'
        : null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (errQ || errA) return;
    onSubmit({ kind: v.kind, question: q, answer: a });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" form={formId} loading={!!busy} className="flex-1">
            {submitLabel}
          </Button>
          {onDelete ? (
            <Button
              variant="ghost"
              icon={<Trash weight="bold" />}
              onClick={onDelete}
              loading={!!deleting}
              className="text-danger"
            >
              apagar
            </Button>
          ) : null}
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5 pt-2" noValidate>
        {kinds ? (
          <Segmented
            label="Ensinar como"
            value={v.kind}
            onChange={(kind) => setV((o) => ({ ...o, kind }))}
            options={[
              { value: 'answer', label: 'resposta' },
              { value: 'rule', label: 'regra' },
            ]}
          />
        ) : null}
        {v.kind === 'answer' ? (
          <>
            <Field
              label="Quando perguntarem"
              htmlFor={`${formId}-q`}
              error={tried ? errQ : null}
              helper="Do jeito que o cliente escreve."
            >
              <TextInput
                id={`${formId}-q`}
                value={v.question}
                maxLength={Q_MAX}
                placeholder="Tem estacionamento?"
                aria-invalid={tried && !!errQ}
                onChange={(e) => setV((o) => ({ ...o, question: e.target.value }))}
              />
            </Field>
            <Field label={`A ${name} responde`} htmlFor={`${formId}-a`} error={tried ? errA : null}>
              <TextArea
                id={`${formId}-a`}
                value={v.answer}
                maxLength={A_MAX}
                rows={3}
                placeholder="Temos 3 vagas na frente da loja."
                aria-invalid={tried && !!errA}
                onChange={(e) => setV((o) => ({ ...o, answer: e.target.value }))}
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="A regra, com as suas palavras"
              htmlFor={`${formId}-r`}
              error={tried ? errA : null}
            >
              <TextArea
                id={`${formId}-r`}
                value={v.answer}
                maxLength={R_MAX}
                rows={3}
                placeholder="Pedidos com mais de 10 pudins: passe para mim."
                aria-invalid={tried && !!errA}
                onChange={(e) => setV((o) => ({ ...o, answer: e.target.value }))}
              />
            </Field>
            <RulePreview text={v.answer} name={name} />
          </>
        )}
      </form>
    </Sheet>
  );
}
