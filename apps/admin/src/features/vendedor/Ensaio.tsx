import { Lightning } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, withRetryScope, type EnsaioView } from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { EmptyState, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { ArtChat, ArtSparkle } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ChecklistRow, Discordance, ScoreRing } from '../../ui/vendedor/index.ts';
import { TeachSheet, type TeachValues } from './Teach.sheet.tsx';

type Disagreement = EnsaioView['disagreements'][number];

// below this, a score says more about the week's luck than about Duá
const FEW = 5;
const PAGE = 5;

export default function Ensaio() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, error, refetch } = useQuery({
    queryKey: qk.vendedor.ensaio,
    queryFn: api.vendedor.ensaio,
  });
  const home = useQuery({ queryKey: qk.vendedor.home, queryFn: api.vendedor.home });
  const agent = home.data?.agent;
  // live = Duá answers shoppers; Ensaio is coverage 'rehearsal'
  const live = !!agent?.enabled && agent.coverage !== 'rehearsal';
  const [all, setAll] = useState(false);
  const [teaching, setTeaching] = useState<Disagreement | null>(null);
  const [open, setOpen] = useState(false);

  const drop = (draftId: string) =>
    optimistic<EnsaioView>(qc, qk.vendedor.ensaio, (o) => ({
      ...o,
      disagreements: o.disagreements.filter((d) => d.draftId !== draftId),
    }));

  const undo = useMutation({
    mutationFn: (draftId: string) => api.vendedor.verdict(draftId, { verdict: 'different' }),
    onSuccess: (v) => qc.setQueryData(qk.vendedor.ensaio, v),
    onError: (e) => toast.error(messageOf(e)),
  });
  const right = useMutation({
    mutationFn: (d: Disagreement) => api.vendedor.verdict(d.draftId, { verdict: 'same' }),
    onMutate: (d) => drop(d.draftId),
    onSuccess: (v, d) => {
      qc.setQueryData(qk.vendedor.ensaio, v);
      toast('Contamos como igual. Ponto para o Duá.', {
        undo: () => undo.mutate(d.draftId),
      });
    },
    onError: (e, _d, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });

  const teach = useMutation({
    mutationFn: async ({ d, v }: { d: Disagreement; v: TeachValues }, ctx) => {
      // "dismissed" takes it off the list without counting it as agreement; a 'different'
      // verdict would leave the card here after the lesson (ensaioView)
      if (v.kind === 'answer')
        return api.vendedor.verdict(d.draftId, {
          verdict: 'dismissed',
          teach: true,
          question: v.question,
          answer: v.answer,
        });
      await api.vendedor.teach({ kind: 'rule', text: v.answer });
      // after an await: re-enter the retry scope so a retry reuses this request's key
      return withRetryScope(ctx, () => api.vendedor.verdict(d.draftId, { verdict: 'dismissed' }));
    },
    onSuccess: (view, { v }) => {
      qc.setQueryData(qk.vendedor.ensaio, view);
      void qc.invalidateQueries({ queryKey: qk.vendedor.knowledge });
      setOpen(false);
      toast(
        v.kind === 'answer'
          ? 'O Duá aprendeu. Na próxima vez, ele responde como você.'
          : 'O Duá aprendeu a regra.',
        { action: { label: 'ver em Ensinar', run: () => nav('/vendedor/ensinar') } },
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const header = (
    <PageHeader
      title="Ensaio"
      back="/vendedor"
      subtitle="O Duá escreve, você atende. Nada foi enviado."
      actions={
        !live && home.data ? (
          <ButtonLink to="/vendedor/configurar" variant="spark" icon={<Lightning weight="fill" />}>
            ligar o Duá
          </ButtonLink>
        ) : undefined
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
        <SectionsSkeleton />
      </PageBody>
    );

  const differ = data.compared - data.agreed;
  const unseen = data.drafts - data.compared;
  const list = all ? data.disagreements : data.disagreements.slice(0, PAGE);
  const rest = data.disagreements.length - list.length;

  return (
    <PageBody>
      {header}
      <div className="flex flex-col gap-8">
        {data.drafts === 0 ? (
          <Card>
            <EmptyState
              art={<ArtChat />}
              title="Ainda poucas conversas"
              body={
                agent && agent.coverage !== 'rehearsal'
                  ? 'O ensaio guarda o que o Duá escreveria enquanto você atende. Ele roda quando o Duá está em ensaio, em Configurar.'
                  : 'Para cada mensagem que chega, o Duá escreve o que mandaria e não manda. Volte amanhã para ver quantas você mandaria iguais.'
              }
            />
          </Card>
        ) : (
          <Card className="p-4 md:p-5">
            <div className="flex items-center gap-4">
              <ScoreRing
                value={data.agreed}
                total={data.compared}
                label={`${data.agreed} de ${data.compared} respostas iguais ou quase`}
              />
              <div className="min-w-0">
                <p className="t-body-lg font-semibold leading-6">
                  Você mandaria {data.agreed} {data.agreed === 1 ? 'igual' : 'iguais'} ou quase
                </p>
                <p className="t-body mt-1 text-muted">
                  O Duá escreveu {data.drafts} {data.drafts === 1 ? 'resposta' : 'respostas'} sem
                  mandar, enquanto você atendia como sempre.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <ChecklistRow state="done" title="Iguais ou quase" value={data.agreed} />
              <ChecklistRow state={differ ? 'miss' : 'done'} title="Diferentes" value={differ} />
              {unseen > 0 ? (
                <ChecklistRow state="todo" title="Sem resposta sua para comparar" value={unseen} />
              ) : null}
            </div>
            {data.compared < FEW ? (
              <p className="t-caption mt-3 text-muted">
                Ainda poucas conversas para comparar · volte amanhã.
              </p>
            ) : null}
          </Card>
        )}

        {data.drafts > 0 ? (
          data.disagreements.length ? (
            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  Onde vocês discordaram
                  <span className="tnum t-caption inline-grid h-6 min-w-6 place-items-center rounded-full bg-sunken px-2 font-semibold text-muted">
                    {data.disagreements.length}
                  </span>
                </span>
              }
              hint="Ensine como você fez, ou diga que o Duá estava certo."
            >
              <Card as="div" className="divide-y divide-line">
                {list.map((d) => (
                  <Discordance
                    key={d.draftId}
                    className="p-4"
                    who="Cliente"
                    when={when(d.at)}
                    shopper={d.shopper}
                    draft={d.draft}
                    merchant={d.merchant}
                    busy={
                      right.isPending && right.variables?.draftId === d.draftId ? 'dismiss' : null
                    }
                    onTeach={() => {
                      setTeaching(d);
                      setOpen(true);
                    }}
                    onDismiss={() => right.mutate(d)}
                  />
                ))}
              </Card>
              {rest > 0 ? (
                <Button variant="quiet" block className="mt-3" onClick={() => setAll(true)}>
                  ver {rest === 1 ? 'a outra' : `as outras ${rest}`}
                </Button>
              ) : null}
            </Section>
          ) : data.compared > 0 ? (
            <Card>
              <EmptyState
                art={<ArtSparkle />}
                title="Vocês concordaram em tudo"
                body="Em cada conversa que deu para comparar, o Duá escreveu o que você mandou, ou quase."
              />
            </Card>
          ) : null
        ) : null}

        {!live && home.data ? (
          <div className="flex flex-col items-center gap-2 md:hidden">
            <ButtonLink
              to="/vendedor/configurar"
              variant="spark"
              block
              icon={<Lightning weight="fill" />}
            >
              ligar o Duá
            </ButtonLink>
            <p className="t-caption text-center text-muted">O ensaio continua até você ligar.</p>
          </div>
        ) : !live ? null : (
          <p className="t-caption text-center text-muted">
            O Duá já atende. O ensaio mostra as respostas das últimas duas semanas.
          </p>
        )}
      </div>

      {teaching ? (
        <TeachSheet
          open={open}
          onOpenChange={setOpen}
          kinds
          title="Ensinar como você fez"
          description="Ajuste as palavras. O Duá usa daqui pra frente."
          initial={{
            kind: 'answer',
            question: teaching.shopper ?? '',
            answer: teaching.merchant ?? '',
          }}
          submitLabel="ensinar"
          busy={teach.isPending}
          onSubmit={(v) => teach.mutate({ d: teaching, v })}
        />
      ) : null}
    </PageBody>
  );
}
