import { ChatCircleDots, Check, Info, Plus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Knowledge, type KnowledgeItem } from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { ArtChat } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { FieldSkeleton, RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { GuaranteeChip } from '../../ui/vendedor/index.ts';
import { TeachSheet, type TeachValues } from './Teach.sheet.tsx';

type SheetState =
  | { mode: 'new'; initial: TeachValues }
  | { mode: 'edit' | 'learned'; item: KnowledgeItem; initial: TeachValues };

const valuesOf = (k: KnowledgeItem): TeachValues => ({
  kind: k.kind === 'rule' ? 'rule' : 'answer',
  question: k.question ?? '',
  answer: k.answer ?? '',
});

const timesAsked = (n: number) => (n === 1 ? 'perguntaram 1 vez' : `perguntaram ${n} vezes`);
const timesUsed = (n: number) =>
  n === 0 ? 'ainda não usada' : n === 1 ? 'usada 1 vez' : `usada ${n} vezes`;

export default function Teach() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: qk.vendedor.knowledge,
    queryFn: api.vendedor.knowledge,
  });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [open, setOpen] = useState(false);
  const show = (st: SheetState) => {
    setSheet(st);
    setOpen(true);
  };
  const put = (k: Knowledge) => qc.setQueryData(qk.vendedor.knowledge, k);
  // "ensinar a responder diferente" from a conversation: the shopper's question, ready to answer
  const [params, setParams] = useSearchParams();
  const asked = params.get('pergunta');
  useEffect(() => {
    if (!asked) return;
    show({ mode: 'new', initial: { kind: 'answer', question: asked.slice(0, 500), answer: '' } });
    setParams(
      (p) => {
        p.delete('pergunta');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  const answer = useMutation({
    mutationFn: (v: { id: string; answer: string; replyWaiting: boolean }) =>
      api.vendedor.updateKnowledge(v.id, { answer: v.answer, replyWaiting: v.replyWaiting }),
    onSuccess: (k, v) => {
      put(k);
      toast(
        v.replyWaiting
          ? 'O Duá aprendeu, e mandamos a resposta para quem perguntou.'
          : 'O Duá aprendeu. Na próxima vez, ele responde assim.',
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'live' | 'dismissed' }) =>
      api.vendedor.updateKnowledge(v.id, { status: v.status }),
    onSuccess: (k, v) => {
      put(k);
      toast(v.status === 'live' ? 'O Duá aprendeu.' : 'Ignorado.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const save = useMutation({
    mutationFn: async ({ st, v }: { st: SheetState; v: TeachValues }) => {
      if (st.mode === 'new')
        return api.vendedor.teach(
          v.kind === 'answer'
            ? { kind: 'answer', question: v.question, answer: v.answer }
            : { kind: 'rule', text: v.answer },
        );
      return api.vendedor.updateKnowledge(st.item.id, {
        ...(v.kind === 'answer' ? { question: v.question } : {}),
        answer: v.answer,
        ...(st.mode === 'learned' ? { status: 'live' as const } : {}),
      });
    },
    onSuccess: (k, { st }) => {
      put(k);
      setOpen(false);
      toast(st.mode === 'edit' ? 'Salvo.' : 'O Duá aprendeu.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const reteach = useMutation({
    mutationFn: (v: TeachValues) =>
      api.vendedor.teach(
        v.kind === 'answer'
          ? { kind: 'answer', question: v.question, answer: v.answer }
          : { kind: 'rule', text: v.answer },
      ),
    onSuccess: put,
    onError: (e) => toast.error(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: (item: KnowledgeItem) => api.vendedor.deleteKnowledge(item.id),
    onSuccess: (k, item) => {
      put(k);
      setOpen(false);
      const back = valuesOf(item);
      toast(item.kind === 'rule' ? 'Regra apagada.' : 'Resposta apagada.', {
        undo: () => reteach.mutate(back),
      });
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const header = (
    <PageHeader
      title="Ensinar"
      back="/vendedor"
      subtitle="O que o Duá sabe sobre a sua loja: respostas e regras."
      actions={
        <ButtonLink
          to="/vendedor/testar"
          variant="secondary"
          icon={<ChatCircleDots weight="bold" />}
        >
          testar como cliente
        </ButtonLink>
      }
    />
  );
  if (error && !data)
    return (
      <PageBody>
        {header}
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        {header}
        <div className="space-y-4">
          <FieldSkeleton />
          <RowsSkeleton rows={5} avatar={false} />
        </div>
      </PageBody>
    );

  const empty =
    !data.questions.length && !data.learned.length && !data.answers.length && !data.rules.length;
  const newAnswer = () =>
    show({ mode: 'new', initial: { kind: 'answer', question: '', answer: '' } });
  const newRule = () => show({ mode: 'new', initial: { kind: 'rule', question: '', answer: '' } });

  return (
    <PageBody>
      {header}
      {empty ? (
        <Card className="mb-8">
          <EmptyState
            art={<ArtChat />}
            title="O Duá já sabe o seu cardápio, horários e taxas."
            body="Ensine aqui o que só você sabe: estacionamento, encomendas para festa…"
            action={
              <Button icon={<Plus weight="bold" />} onClick={newAnswer}>
                nova resposta
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="flex flex-col gap-8">
        {data.questions.length ? (
          <Section
            title={
              <span className="inline-flex items-center gap-2">
                Perguntas sem resposta
                <Count n={data.questions.length} />
              </span>
            }
            hint="O Duá não soube responder. Ensine uma vez e ele responde sozinho daqui pra frente."
          >
            <Card as="div" className="divide-y divide-line">
              {data.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  item={q}
                  busy={answer.isPending && answer.variables?.id === q.id}
                  dismissing={setStatus.isPending && setStatus.variables?.id === q.id}
                  onAnswer={(text, replyWaiting) =>
                    answer.mutate({ id: q.id, answer: text, replyWaiting })
                  }
                  onDismiss={() => setStatus.mutate({ id: q.id, status: 'dismissed' })}
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {data.learned.map((k) => (
          <LearnedCard
            key={k.id}
            item={k}
            busy={setStatus.isPending && setStatus.variables?.id === k.id}
            onAccept={() => setStatus.mutate({ id: k.id, status: 'live' })}
            onEdit={() => show({ mode: 'learned', item: k, initial: valuesOf(k) })}
            onDismiss={() => setStatus.mutate({ id: k.id, status: 'dismissed' })}
          />
        ))}

        {!empty || data.answers.length ? (
          <Section
            title="Respostas"
            action={
              <Button variant="quiet" icon={<Plus weight="bold" />} onClick={newAnswer}>
                nova<span className="sr-only"> resposta</span>
              </Button>
            }
          >
            {data.answers.length ? (
              <Card as="div" className="divide-y divide-line overflow-hidden">
                {data.answers.map((k) => (
                  <ItemButton
                    key={k.id}
                    label={`editar a resposta: ${k.question ?? ''}`}
                    onClick={() => show({ mode: 'edit', item: k, initial: valuesOf(k) })}
                  >
                    <p className="font-semibold">{k.question}</p>
                    <p className="t-body mt-0.5">{k.answer}</p>
                    <p className="t-caption mt-1 text-muted">{timesUsed(k.usedCount)}</p>
                  </ItemButton>
                ))}
              </Card>
            ) : (
              <Card className="t-body p-4 text-muted">
                Nenhuma resposta ainda. Ensine o que os clientes perguntam e só você sabe.
              </Card>
            )}
          </Section>
        ) : null}

        {!empty ? (
          <Section
            title="Regras"
            hint={
              <>
                <strong className="font-semibold text-ink">Sempre cumprida</strong>: o sistema
                confere em todo pedido.{' '}
                <strong className="font-semibold text-ink">Orientação</strong>: o Duá segue como uma
                instrução para a equipe.
              </>
            }
            action={
              <Button variant="quiet" icon={<Plus weight="bold" />} onClick={newRule}>
                nova<span className="sr-only"> regra</span>
              </Button>
            }
          >
            {data.rules.length ? (
              <Card as="div" className="divide-y divide-line overflow-hidden">
                {data.rules.map((k) => (
                  <ItemButton
                    key={k.id}
                    label={`editar a regra: ${k.answer ?? ''}`}
                    onClick={() => show({ mode: 'edit', item: k, initial: valuesOf(k) })}
                  >
                    <p className="font-semibold">{k.answer}</p>
                    <GuaranteeChip guaranteed={k.guaranteed} className="mt-2" />
                    {k.guaranteed && k.guarantee ? (
                      <p className="t-caption mt-1.5 text-muted">{k.guarantee}</p>
                    ) : null}
                  </ItemButton>
                ))}
              </Card>
            ) : (
              <Card className="t-body p-4 text-muted">
                Nenhuma regra ainda. Por exemplo: "não aceite dinheiro acima de R$ 200".
              </Card>
            )}
          </Section>
        ) : null}

        <p className="t-body flex items-start gap-3 rounded-md bg-info-soft px-4 py-3.5">
          <Info weight="fill" className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <span>
            Horário, taxas, preços e estoque o Duá lê da loja na hora. Não precisa ensinar.
          </span>
        </p>

        <ButtonLink
          to="/vendedor/testar"
          variant="secondary"
          block
          icon={<ChatCircleDots weight="bold" />}
          className="md:hidden"
        >
          testar como cliente
        </ButtonLink>
      </div>

      {sheet ? (
        <TeachSheet
          open={open}
          onOpenChange={setOpen}
          initial={sheet.initial}
          title={
            sheet.mode === 'new'
              ? sheet.initial.kind === 'rule'
                ? 'Nova regra'
                : 'Nova resposta'
              : sheet.mode === 'learned'
                ? 'Ensinar assim'
                : sheet.initial.kind === 'rule'
                  ? 'Regra'
                  : 'Resposta'
          }
          description={
            sheet.mode === 'learned'
              ? 'Ajuste as palavras. Só vale depois do seu ok.'
              : sheet.initial.kind === 'rule'
                ? 'Escreva como você falaria para a equipe. O Duá segue a partir de agora.'
                : undefined
          }
          submitLabel={sheet.mode === 'edit' ? 'salvar' : 'ensinar'}
          busy={save.isPending}
          onSubmit={(v) => save.mutate({ st: sheet, v })}
          onDelete={sheet.mode === 'edit' ? () => remove.mutate(sheet.item) : undefined}
          deleting={remove.isPending}
        />
      ) : null}
    </PageBody>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="tnum t-caption inline-grid h-6 min-w-6 place-items-center rounded-full bg-warning-soft px-2 font-semibold text-warning">
      {n}
    </span>
  );
}

function ItemButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="press-row block w-full px-4 py-3.5 text-left transition-colors hover:bg-hover"
    >
      {children}
    </button>
  );
}

function QuestionCard({
  item,
  busy,
  dismissing,
  onAnswer,
  onDismiss,
}: {
  item: KnowledgeItem;
  busy: boolean;
  dismissing: boolean;
  onAnswer: (text: string, replyWaiting: boolean) => void;
  onDismiss: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [reply, setReply] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onAnswer(text.trim(), reply);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 p-4">
      <div>
        <p className="t-body-lg font-semibold leading-6" id={`${id}-q`}>
          {item.question}
        </p>
        <p className="t-caption text-muted">
          {timesAsked(item.askedCount)} · {when(item.at)}
        </p>
      </div>
      <TextInput
        aria-labelledby={`${id}-q`}
        aria-describedby={`${id}-h`}
        maxLength={2000}
        value={text}
        placeholder="Sua resposta"
        onChange={(e) => setText(e.target.value)}
      />
      <span id={`${id}-h`} className="sr-only">
        Sua resposta, que o Duá vai usar daqui pra frente
      </span>
      {text.trim() ? (
        <label className="t-body flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={reply}
            onChange={(e) => setReply(e.target.checked)}
            className="size-5 shrink-0 accent-primary"
          />
          Mandar também para quem perguntou e ainda espera
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="secondary"
          icon={<Check weight="bold" />}
          loading={busy}
          disabled={!text.trim()}
        >
          ensinar
        </Button>
        <Button variant="ghost" onClick={onDismiss} loading={dismissing} className="text-muted">
          ignorar
        </Button>
      </div>
    </form>
  );
}

const SOURCE: Record<string, string> = {
  learned: 'Da sua resposta a um cliente',
  ensaio: 'Do ensaio',
  interview: 'Da nossa conversa',
};

/** "Aprendi com você": the owner's reply to a handed-off shopper, back as a proposal (§3.5). */
function LearnedCard({
  item,
  busy,
  onAccept,
  onEdit,
  onDismiss,
}: {
  item: KnowledgeItem;
  busy: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const rule = item.kind === 'rule';
  return (
    <section
      aria-label="Aprendi com você"
      className="flex flex-col gap-2.5 rounded-lg bg-spark-soft p-4 ring-1 ring-inset ring-spark depth-1"
    >
      <p className="t-moment text-[1.625rem] leading-8">Aprendi com você</p>
      <p className="t-caption text-muted">
        {SOURCE[item.source] ?? 'Do que você respondeu'}, {when(item.at)}
        {rule ? '' : ':'}
      </p>
      {!rule && item.question ? <p className="font-semibold">{item.question}</p> : null}
      <blockquote
        className={cn(
          't-body-lg rounded-md bg-surface px-4 py-3 leading-6 depth-1',
          'border-l-4 border-primary noite:border-spark',
        )}
      >
        {item.answer}
      </blockquote>
      {rule ? <GuaranteeChip guaranteed={item.guaranteed} /> : null}
      <p className="t-label">
        {rule
          ? 'Quer que o Duá siga essa regra daqui pra frente?'
          : 'Quer que o Duá responda assim daqui pra frente?'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Check weight="bold" />} onClick={onAccept} loading={busy}>
          ensinar
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          editar
        </Button>
        <Button variant="ghost" onClick={onDismiss} className="text-muted">
          ignorar
        </Button>
      </div>
      <p className="t-caption text-muted">Só vale depois do seu ok.</p>
    </section>
  );
}
