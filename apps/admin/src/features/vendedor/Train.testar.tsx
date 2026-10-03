import { PaperPlaneRight } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type ClienteOculto } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { messageOf, Skeleton } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ChecklistRow, MiniChat, ScoreRing } from '../../ui/vendedor/index.ts';
import { TestLines, TrainFrame } from './Train.parts.tsx';

// ── Peça para mim ───────────────────────────────────────────────────────────

const STARTERS = ['oi, vocês entregam?', 'qual é o mais pedido?', 'quero fazer um pedido'];

export function OrderStep({
  onNext,
  onSkip,
  back,
  eyebrow,
}: {
  onNext: () => void;
  onSkip: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const qc = useQueryClient();
  const poll = usePollWhenOffline(3_000, 8_000);
  const chat = useQuery({
    queryKey: qk.vendedor.testChat,
    queryFn: api.vendedor.testChat,
    // his reply is an agent turn; the stream says when it lands, polling covers a quiet stream
    refetchInterval: (q) => (q.state.data?.messages.at(-1)?.author === 'shopper' ? poll : false),
  });
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: (t: string) => api.vendedor.sendTest(t),
    onSuccess: (d) => {
      qc.setQueryData(qk.vendedor.testChat, d);
      setText('');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.vendedor.resetTest(),
    onSuccess: (d) => qc.setQueryData(qk.vendedor.testChat, d),
    onError: (e) => toast.error(messageOf(e)),
  });
  const msgs = chat.data?.messages ?? [];
  const typing = msgs.at(-1)?.author === 'shopper' || send.isPending;
  const end = useRef<HTMLDivElement>(null);
  // follow the conversation as it grows, never on arrival (the page opens at its title)
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!chat.data) return;
    if (seen.current !== null && msgs.length > seen.current)
      end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    seen.current = msgs.length;
  }, [chat.data, msgs.length]);
  const go = (t: string) => {
    const v = t.trim();
    if (v && !send.isPending) send.mutate(v.slice(0, 1000));
  };
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title="Peça para mim"
      next={onNext}
      back={back}
      aside={
        msgs.length ? (
          <Button
            variant="quiet"
            size="lg"
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            pedir de novo
          </Button>
        ) : (
          <Button variant="quiet" size="lg" onClick={onSkip}>
            pular
          </Button>
        )
      }
    >
      <MiniChat
        owner
        typing={typing}
        label="teste · só você vê"
        className="min-h-72"
        composer={
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(text);
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="tr-test" className="sr-only">
                Escreva como cliente
              </label>
              <TextInput
                id="tr-test"
                maxLength={1000}
                autoComplete="off"
                enterKeyHint="send"
                value={text}
                placeholder="Escreva como cliente…"
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              aria-label="mandar"
              className="size-12 shrink-0 px-0"
              disabled={!text.trim()}
              loading={send.isPending}
            >
              <PaperPlaneRight weight="fill" className="size-5" aria-hidden />
            </Button>
          </form>
        }
      >
        {!chat.data ? (
          <Skeleton className="h-24 w-3/4 self-start rounded-lg" />
        ) : msgs.length ? (
          <TestLines messages={msgs} />
        ) : (
          <div className="space-y-3 py-2">
            <p className="t-body text-muted">
              Escreva como um cliente escreveria. O pedido passa pela loja como qualquer outro, mas
              para antes de existir: nada vai para a cozinha e nada é cobrado.
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Começar com">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => go(s)}
                  className="press t-label min-h-12 rounded-full bg-surface px-4 ring-1 ring-line-strong hover:bg-hover"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </MiniChat>
    </TrainFrame>
  );
}

// ── Cliente oculto ──────────────────────────────────────────────────────────

export const running = (c: ClienteOculto | undefined) =>
  !!c?.latest && (c.latest.status === 'queued' || c.latest.status === 'running');

/** Cliente oculto's run, read here and at the finale; polled while it runs. */
export function useClienteOculto(enabled = true) {
  const poll = usePollWhenOffline(4_000, 8_000);
  return useQuery({
    queryKey: qk.vendedor.clienteOculto,
    queryFn: api.vendedor.clienteOculto,
    enabled,
    // partial results land as each test customer finishes, without a live event
    refetchInterval: (q) => (running(q.state.data) ? poll : false),
  });
}

const SHOWN = 7;

export function OcultoStep({
  onNext,
  back,
  eyebrow,
}: {
  onNext: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const qc = useQueryClient();
  const co = useClienteOculto();
  const run = useMutation({
    mutationFn: () => api.vendedor.runClienteOculto(),
    onSuccess: (d) => qc.setQueryData(qk.vendedor.clienteOculto, d),
    onError: (e) => toast.error(messageOf(e)),
  });
  // the onboarding starts the first run itself; after that, running again is the owner's call
  const started = useRef(false);
  useEffect(() => {
    if (!co.data || co.data.latest || started.current) return;
    started.current = true;
    run.mutate();
  }, [co.data, run]);

  const latest = co.data?.latest ?? null;
  const live = running(co.data);
  const results = latest?.results ?? [];
  const total = latest?.total ?? 20;
  const passed = latest?.passed ?? results.filter((r) => r.passed).length;
  // while it runs the newest come first; once done, what went wrong leads
  const shown = live
    ? results.slice(-SHOWN).reverse()
    : [...results.filter((r) => !r.passed), ...results.filter((r) => r.passed)].slice(0, SHOWN);
  const more = results.length - shown.length;
  return (
    <TrainFrame eyebrow={eyebrow} title="Cliente oculto" next={onNext} back={back}>
      <Card className="flex items-center gap-4 p-4">
        {latest ? (
          <ScoreRing
            value={live ? results.length : passed}
            total={total}
            running={live}
            size={104}
            label={
              live
                ? `${results.length} de ${total} clientes de teste atendidos, ainda rodando`
                : `${passed} de ${total} pedidos saíram certos`
            }
          />
        ) : (
          <Skeleton className="size-[104px] shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          {live ? (
            <span className="t-caption inline-flex h-7 items-center gap-1.5 rounded-full bg-spark-soft px-2.5 font-semibold">
              <span aria-hidden className="animate-pulse-dot size-2 rounded-full bg-ink" />
              rodando
            </span>
          ) : null}
          <p className="t-label tnum">
            {!latest
              ? 'Preparando os clientes de teste…'
              : live
                ? `testando ${Math.min(results.length + 1, total)} de ${total}…`
                : latest.status === 'failed'
                  ? 'O teste não terminou'
                  : `${passed} de ${total} pedidos saíram certos`}
          </p>
          <p className="t-caption text-muted">
            Cada um tem um pedido escondido. Comparamos item por item com o que o Duá fechar.
          </p>
        </div>
      </Card>

      {latest?.status === 'failed' ? (
        <Notice
          tone="warning"
          role="status"
          title="O cliente oculto parou no meio"
          action={
            <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              rodar de novo
            </Button>
          }
        >
          Pode seguir: rode de novo agora ou depois, em Cliente oculto.
        </Notice>
      ) : null}

      {results.length ? (
        <section aria-labelledby="tr-co" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="tr-co" className="t-title-2">
              {live ? 'Até agora' : 'Como foi'}
            </h2>
            <span className="t-caption tnum text-muted">{plural(passed, 'certo', 'certos')}</span>
          </div>
          <Card className="px-4 py-1.5">
            <div aria-live="polite">
              {live ? (
                <ChecklistRow state="now" title="Próximo cliente de teste" value="agora" />
              ) : null}
              {shown.map((r, i) => (
                <ChecklistRow
                  key={`${r.name}-${i}`}
                  state={r.passed ? 'done' : 'miss'}
                  title={r.name}
                  detail={r.passed ? r.check : r.why}
                  value={r.passed ? 'certo' : 'errou'}
                />
              ))}
            </div>
            {more > 0 || (live && total > results.length) ? (
              <p className="t-caption border-t border-line py-2.5 text-muted">
                {[
                  more > 0 ? `E mais ${more}` : null,
                  live ? `faltam ${total - results.length}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                .
              </p>
            ) : null}
          </Card>
        </section>
      ) : null}

      {!live && latest && latest.status !== 'failed' ? (
        <Button variant="quiet" loading={run.isPending} onClick={() => run.mutate()}>
          rodar de novo
        </Button>
      ) : null}
    </TrainFrame>
  );
}
