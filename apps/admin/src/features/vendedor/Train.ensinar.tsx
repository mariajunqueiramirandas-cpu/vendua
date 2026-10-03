import { ArrowRight, Check, PaperPlaneRight, Warning, WarningCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type KnowledgeItem,
  type MenuGap,
  type PayMethod,
  type StoreAgentSettings,
  type VendedorOnboarding,
  type VendedorSettingsPatch,
} from '../../lib/api.ts';
import { money, plural } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, MoneyField, TextArea, TextInput, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';
import { MiniChat, ProposalCard } from '../../ui/vendedor/index.ts';
import { Preset } from './Train.conhecer.tsx';
import { gapKey, interviewState, questionOf } from './Train.model.ts';
import { TestLines, TrainFrame } from './Train.parts.tsx';

const CHIP =
  't-caption inline-flex min-h-8 items-center gap-1.5 rounded-full bg-success-soft px-3 font-semibold text-success';

const PAY_WORD: Record<PayMethod, string> = {
  pix: 'Pix',
  card_online: 'cartão',
  card_on_delivery: 'cartão',
  cash: 'dinheiro',
  meal_voucher: 'vale-refeição',
};

const listWords = (w: string[]) =>
  w.length < 2 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} e ${w.at(-1)}`;

// ── Li sua loja ────────────────────────────────────────────────────────────

export function ReadStep({
  ob,
  left,
  onLeave,
  onNext,
  back,
  eyebrow,
}: {
  ob: VendedorOnboarding;
  /** the gaps not yet left as they are */
  left: MenuGap[];
  onLeave: (g: MenuGap) => void;
  onNext: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  const methods = [...new Set((pay.data?.methods ?? []).map((m) => PAY_WORD[m]))];
  return (
    <TrainFrame eyebrow={eyebrow} title="O que o Duá já sabe" next={onNext} back={back}>
      <Card className="space-y-3 p-4">
        <ul className="flex flex-wrap gap-2" aria-label="o que ele leu da loja">
          <li className={CHIP}>
            <Check weight="bold" className="size-4" aria-hidden />
            cardápio · {plural(ob.read.products, 'item', 'itens')}
          </li>
          {ob.readiness.hours ? (
            <li className={CHIP}>
              <Check weight="bold" className="size-4" aria-hidden />
              horário
            </li>
          ) : null}
          {ob.read.zones ? (
            <li className={CHIP}>
              <Check weight="bold" className="size-4" aria-hidden />
              {plural(ob.read.zones, 'área de entrega', 'áreas de entrega')}
            </li>
          ) : ob.readiness.fulfilment ? (
            <li className={CHIP}>
              <Check weight="bold" className="size-4" aria-hidden />
              retirada
            </li>
          ) : null}
          {methods.length ? (
            <li className={CHIP}>
              <Check weight="bold" className="size-4" aria-hidden />
              {listWords(methods)}
            </li>
          ) : null}
        </ul>
        <p className="t-caption text-muted">
          Isso o Duá lê da loja na hora. Se você mudar, ele já sabe.
        </p>
      </Card>

      {left.length ? (
        <section aria-labelledby="tr-gaps" className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 id="tr-gaps" className="t-title-2">
              Não ficou claro
            </h2>
            <span className="t-caption tnum grid h-6 min-w-6 place-items-center rounded-full bg-warning-soft px-1.5 font-semibold text-warning">
              {left.length}
            </span>
          </div>
          <Card as="section" className="divide-y divide-line">
            {left.map((g) => (
              <div key={gapKey(g)} className="flex gap-3 p-4">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning"
                >
                  <Warning weight="bold" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">{g.title}</p>
                  <p className="t-body text-muted">{g.detail}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={g.productId ? `/cardapio/produto/${g.productId}` : '/cardapio'}
                      className="t-label press inline-flex h-10 items-center gap-1.5 rounded-md bg-surface px-3.5 text-[0.875rem] ring-1 ring-line-strong hover:bg-hover depth-1"
                    >
                      arrumar <ArrowRight weight="bold" className="size-4" aria-hidden />
                    </Link>
                    <Button variant="quiet" size="sm" onClick={() => onLeave(g)}>
                      deixa assim
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </section>
      ) : (
        <Notice tone="success" title="Nada confuso no cardápio">
          Tudo o que um cliente costuma perguntar está respondido.
        </Notice>
      )}
    </TrainFrame>
  );
}

// ── A entrevista ────────────────────────────────────────────────────────────

const STALL_MS = 60_000;

export function InterviewStep({
  ob,
  onNext,
  onSkip,
  back,
  eyebrow,
}: {
  ob: VendedorOnboarding;
  onNext: () => void;
  onSkip: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const qc = useQueryClient();
  const iv = interviewState(ob);
  const [text, setText] = useState('');
  const ask = useMutation({
    mutationFn: (t: string) => api.vendedor.interview(t),
    onSuccess: (d) => {
      qc.setQueryData(qk.vendedor.onboarding, d);
      setText('');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const waiting = iv.waiting || ask.isPending;
  // his reply is an agent turn: a long silence gets said, not hidden behind dots
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iv.waitingSince) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [iv.waitingSince]);
  const stalled = !!iv.waitingSince && now - Date.parse(iv.waitingSince) > STALL_MS;
  const q = questionOf(iv.current);
  const send = (t: string) => {
    const v = t.trim();
    if (v && !waiting) ask.mutate(v.slice(0, 1000));
  };

  const proposals = [...ob.proposals].sort((x, y) => y.at.localeCompare(x.at));
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title="A entrevista"
      hint={
        iv.done
          ? undefined
          : 'O que só você sabe. Toque numa resposta pronta ou escreva do seu jeito.'
      }
      next={iv.started || iv.done ? onNext : undefined}
      back={back}
      aside={
        iv.done ? undefined : (
          <Button variant="quiet" size="lg" onClick={onSkip}>
            pular
          </Button>
        )
      }
    >
      {!iv.started && !iv.done ? (
        <Card className="space-y-4 p-5">
          <p className="t-body-lg">
            São de 5 a 8 perguntas: encomendas, o que nunca prometer, quando chamar você. Cada
            resposta vira uma sugestão, e só vale depois do seu ok.
          </p>
          <Button
            size="lg"
            block
            loading={ask.isPending}
            onClick={() => ask.mutate('Pode começar a entrevista.')}
          >
            começar a entrevista
          </Button>
        </Card>
      ) : null}

      {iv.started && !iv.done ? (
        <div className="space-y-3">
          {q.yesNo && !waiting ? (
            <div role="group" aria-label="Respostas prontas" className="grid grid-cols-2 gap-2">
              <Preset on={false} onClick={() => send('Sim.')}>
                sim
              </Preset>
              <Preset on={false} onClick={() => send('Não.')}>
                não
              </Preset>
            </div>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="tr-answer" className="sr-only">
                Sua resposta
              </label>
              <TextInput
                id="tr-answer"
                maxLength={1000}
                autoComplete="off"
                enterKeyHint="send"
                value={text}
                disabled={waiting}
                placeholder={q.yesNo ? 'ou escreva do seu jeito' : 'escreva do seu jeito'}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              aria-label="mandar resposta"
              className="size-12 shrink-0 px-0"
              disabled={!text.trim() || waiting}
              loading={ask.isPending}
            >
              <PaperPlaneRight weight="fill" className="size-5" aria-hidden />
            </Button>
          </form>
          {stalled ? (
            <Notice tone="warning" role="status" title="O Duá está demorando para responder">
              A resposta chega aqui assim que ele terminar. Se preferir, siga e volte à entrevista
              depois.
            </Notice>
          ) : null}
        </div>
      ) : null}

      {iv.done ? (
        <Notice tone="success" title="Entrevista feita">
          {proposals.length
            ? `Falta o seu ok em ${plural(proposals.length, 'sugestão', 'sugestões')}.`
            : 'Tudo o que ele aprendeu já está valendo.'}
        </Notice>
      ) : null}

      {proposals.length ? (
        <section aria-label="o que ele aprendeu" className="space-y-3">
          {proposals.map((p, i) => (
            <Proposal key={p.id} item={p} latest={i === 0} />
          ))}
        </section>
      ) : null}

      {iv.msgs.length > 1 ? (
        <Disclosure
          title="A entrevista até aqui"
          summary={plural(iv.asked, 'pergunta', 'perguntas')}
        >
          <MiniChat owner typing={waiting}>
            <TestLines messages={iv.msgs} owner="você" />
          </MiniChat>
        </Disclosure>
      ) : null}
    </TrainFrame>
  );
}

/** One Resposta or Regra Duá proposes: kept only on "está certo", or after "editar". */
function Proposal({ item, latest }: { item: KnowledgeItem; latest: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const rule = item.kind === 'rule';
  const [question, setQuestion] = useState(item.question ?? '');
  const [answer, setAnswer] = useState(item.answer ?? '');
  const save = useMutation({
    mutationFn: (p: { question?: string; answer?: string; status: 'live' | 'dismissed' }) =>
      api.vendedor.updateKnowledge(item.id, p),
    onSuccess: (k, p) => {
      qc.setQueryData(qk.vendedor.knowledge, k);
      void qc.invalidateQueries({ queryKey: qk.vendedor.onboarding });
      toast(p.status === 'live' ? 'O Duá aprendeu' : 'Descartado');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (!editing)
    return (
      <ProposalCard
        kind={rule ? 'rule' : 'answer'}
        source={latest ? 'Da sua resposta' : 'Da entrevista'}
        question={rule ? (item.answer ?? '') : (item.question ?? '')}
        answer={rule ? null : item.answer}
        guaranteed={item.guaranteed}
        busy={save.isPending}
        onAccept={() => save.mutate({ status: 'live' })}
        onEdit={() => setEditing(true)}
      />
    );
  const ok = rule ? answer.trim().length >= 5 : question.trim().length >= 3 && !!answer.trim();
  return (
    <Card as="article" className="space-y-4 p-4 ring-2 ring-spark">
      {rule ? (
        <Field label="A regra, nas suas palavras" htmlFor={`tr-r-${item.id}`}>
          <TextArea
            id={`tr-r-${item.id}`}
            rows={3}
            maxLength={500}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </Field>
      ) : (
        <>
          <Field label="Quando perguntarem" htmlFor={`tr-q-${item.id}`}>
            <TextInput
              id={`tr-q-${item.id}`}
              maxLength={300}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <Field label="O Duá responde" htmlFor={`tr-a-${item.id}`}>
            <TextArea
              id={`tr-a-${item.id}`}
              rows={3}
              maxLength={1000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Check weight="bold" />}
          disabled={!ok}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              rule
                ? { answer: answer.trim(), status: 'live' }
                : { question: question.trim(), answer: answer.trim(), status: 'live' },
            )
          }
        >
          está certo
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          cancelar
        </Button>
        <Button
          variant="ghost"
          className="text-muted!"
          onClick={() => save.mutate({ status: 'dismissed' })}
        >
          descartar
        </Button>
      </div>
    </Card>
  );
}

// ── Quando passar para você ────────────────────────────────────────────────

/** A setting written as the owner flips it (admin law 5), kept in the onboarding's copy too. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: VendedorSettingsPatch) => api.vendedor.updateSettings(p),
    onSuccess: (s) => {
      qc.setQueryData(qk.vendedor.settings, s);
      qc.setQueryData<VendedorOnboarding>(qk.vendedor.onboarding, (o) =>
        o ? { ...o, settings: s.settings, enabled: s.enabled } : o,
      );
      void qc.invalidateQueries({ queryKey: qk.vendedor.home });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}

const DEFAULT_ABOVE = 30_000;

export function HandoffStep({
  settings,
  onNext,
  back,
  eyebrow,
}: {
  settings: StoreAgentSettings;
  onNext: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const save = useSaveSettings();
  const [h, setH] = useState(settings.handoff);
  const set = (p: Partial<StoreAgentSettings['handoff']>) => {
    const prev = h;
    setH({ ...h, ...p });
    save.mutate({ handoff: p }, { onError: () => setH(prev) });
  };
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title="Quando passar para você"
      hint="Nesses casos o Duá avisa o cliente e chama você."
      next={onNext}
      back={back}
    >
      <Card className="divide-y divide-line px-4">
        <Toggle
          checked={h.complaint}
          onChange={(v) => set({ complaint: v })}
          label="Reclamação ou atraso"
        />
        <Toggle
          checked={h.allergy}
          onChange={(v) => set({ allergy: v })}
          label="Alergia ou restrição"
          description="Ele nunca afirma o que o cardápio não diz."
        />
        <div>
          <Toggle
            checked={h.aboveCents !== null}
            onChange={(v) => set({ aboveCents: v ? DEFAULT_ABOVE : null })}
            label={
              h.aboveCents !== null
                ? `Pedido acima de ${money(h.aboveCents)}`
                : 'Pedido acima de um valor'
            }
          />
          {h.aboveCents !== null ? (
            <div className="pb-4">
              <Field label="A partir de" htmlFor="tr-above">
                <MoneyField
                  id="tr-above"
                  cents={h.aboveCents}
                  min={100}
                  onCommit={(c) => c !== null && set({ aboveCents: c })}
                />
              </Field>
            </div>
          ) : null}
        </div>
        <Toggle
          checked={h.newCashCustomer}
          onChange={(v) => set({ newCashCustomer: v })}
          label="Cliente novo pagando em dinheiro"
        />
      </Card>
      <p className="t-caption flex items-start gap-2 text-muted">
        <WarningCircle weight="bold" className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Quando você assume, o Duá volta sozinho depois de {settings.humanSilenceMin} min sem
          resposta sua. Dá para trocar em Configurar.
        </span>
      </p>
    </TrainFrame>
  );
}
