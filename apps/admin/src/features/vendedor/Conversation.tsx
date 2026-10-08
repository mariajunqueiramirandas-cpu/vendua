import {
  ArrowLeft,
  CaretRight,
  DotsThree,
  Flask,
  Receipt,
  SpeakerSimpleSlash,
} from '@phosphor-icons/react';
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { prevIs } from '../../app/Router.tsx';
import {
  ApiError,
  api,
  type ThreadDetail,
  type ThreadList,
  type ThreadMessage,
  type ThreadRow,
  type VendedorHome,
} from '../../lib/api.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import {
  ClassChip,
  FloorChip,
  Floor,
  ReasonChip,
  SACOLA_STEPS,
  SacolaBar,
  triaged,
} from '../../ui/vendedor/index.ts';
import { money, until } from '../../lib/format.ts';
import {
  CustomerFacts,
  Initials,
  SacolaLines,
  ThreadMessages,
  WhyBody,
  customerLine,
  orderLine,
  useFollow,
  whyTitle,
  type Outgoing,
} from './Conversation.parts.tsx';
import { TriageFloor, WhyShopper, type ClassifyAs } from './Conversation.triage.tsx';
import { QuickRepliesSheet } from './QuickReplies.tsx';

const DESKTOP = '(min-width: 1200px)';

export function useMedia(q: string) {
  const [m, set] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => set(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const LISTS = ['vendedor', 'threads'] as const;

/** the row as the conversation list last had it, from any of its cached filters */
function listRow(qc: QueryClient, id: string): ThreadRow | undefined {
  for (const [, data] of qc.getQueriesData<InfiniteData<ThreadList>>({ queryKey: LISTS }))
    for (const page of data?.pages ?? []) {
      const r = page.threads.find((t) => t.id === id);
      if (r) return r;
    }
  return undefined;
}

function markRead(qc: QueryClient, id: string) {
  qc.setQueriesData<InfiniteData<ThreadList>>({ queryKey: LISTS }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            threads: p.threads.map((t) => (t.id === id && t.unread ? { ...t, unread: false } : t)),
          })),
        }
      : old,
  );
}

/**
 * Opening a conversation reads it (Core's `seen_at`): its row stops being bold. A shopper message
 * that arrives while it's open is read too. One call per new message, none for a read thread.
 */
function useMarkRead(id: string, d: ThreadDetail | undefined) {
  const qc = useQueryClient();
  const lastIn = d
    ? ([...d.messages].reverse().find((m) => m.author === 'shopper')?.id ?? null)
    : null;
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!d || d.thread.test || !lastIn || done.current === lastIn) return;
    const first = done.current === null;
    done.current = lastIn;
    if (first && listRow(qc, id)?.unread === false) return;
    markRead(qc, id);
    api.vendedor.seen(id).catch(() => undefined);
  }, [qc, id, d, lastIn]);
}

/** `/vendedor/conversas/:id`: on phones its own screen; from 1200 px it opens in the inbox. */
export default function Conversation() {
  const { id = '' } = useParams();
  const desktop = useMedia(DESKTOP);
  if (desktop) return <Navigate replace to={`/vendedor/conversas?c=${encodeURIComponent(id)}`} />;
  return <ConversationPane key={id} id={id} />;
}

/**
 * One conversation (sales-agent-ux §3.3): who it is, the pinned sacola, the thread in three
 * voices with Core's receipts and "por quê", and the floor (who answers, assumir / devolver, the
 * composer). `embedded` is the desktop inbox's middle pane, which scrolls on its own; `rail`
 * adds the customer and "por quê" beside it (§3.10); `keys` arms A assumir · D devolver.
 */
export function ConversationPane({
  id,
  embedded,
  rail,
  keys,
  row,
}: {
  id: string;
  embedded?: boolean | undefined;
  rail?: boolean | undefined;
  keys?: boolean | undefined;
  /** what the list already had: the app bar draws from it while the thread loads */
  row?: ThreadRow | undefined;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.vendedor.thread(id),
    queryFn: () => api.vendedor.thread(id),
    enabled: !!id,
  });
  const d = q.data;
  const scroller = useRef<HTMLDivElement>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [why, setWhy] = useState<ThreadMessage | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [sheet, setSheet] = useState<'sacola' | 'customer' | 'quick' | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; n: number }>();
  useFollow(embedded ? scroller : null, (d?.messages.length ?? 0) + outgoing.length, !!d);
  useMarkRead(id, d);

  const put = (next: ThreadDetail) => {
    qc.setQueryData(qk.vendedor.thread(id), next);
    void qc.invalidateQueries({ queryKey: ['vendedor', 'threads'] });
    void qc.invalidateQueries({ queryKey: qk.vendedor.home });
    void qc.invalidateQueries({ queryKey: qk.session });
  };
  const fail = (e: unknown) => toast.error(messageOf(e));
  const take = useMutation({
    mutationFn: () => api.vendedor.take(id),
    onSuccess: put,
    onError: fail,
  });
  const release = useMutation({
    mutationFn: () => api.vendedor.release(id),
    onSuccess: (r) => {
      put(r);
      toast('O Duá voltou a atender esta conversa.');
    },
    onError: fail,
  });
  const unmute = useMutation({
    mutationFn: () => api.vendedor.unmute(id),
    onSuccess: put,
    onError: fail,
  });
  const mute = useMutation({
    mutationFn: () => api.vendedor.mute(id),
    onSuccess: (r) => {
      put(r);
      setSheet(null);
      toast('Marcado: não é cliente. O Duá não responde mais este número.', {
        undo: () => unmute.mutate(),
      });
    },
    onError: fail,
  });
  const classify = useMutation({
    mutationFn: (as: ClassifyAs) => api.vendedor.classify(id, as),
    onSuccess: (r, as) => {
      if (r && 'thread' in r) put(r);
      else {
        void qc.invalidateQueries({ queryKey: qk.vendedor.thread(id) });
        void qc.invalidateQueries({ queryKey: ['vendedor', 'threads'] });
      }
      toast(
        as === 'shopper'
          ? 'Marcado como cliente. O Duá atende este contato.'
          : 'Marcado como pessoal. O Duá não responde este contato.',
      );
    },
    onError: fail,
  });
  const reply = useMutation({
    mutationFn: (v: { text: string; key: string }) => api.vendedor.reply(id, v.text, v.key),
  });
  // the bubble's key is the request's: a retried bubble that reached Core is replayed, not resent
  const send = (text: string, key: string = crypto.randomUUID()) => {
    setOutgoing((o) => [...o.filter((x) => x.key !== key), { key, text, failed: false }]);
    reply.mutateAsync({ text, key }).then(
      (r) => {
        put(r);
        setOutgoing((o) => o.filter((x) => x.key !== key));
      },
      () => setOutgoing((o) => o.map((x) => (x.key === key ? { ...x, failed: true } : x))),
    );
  };
  const verdict = useMutation({
    mutationFn: (v: { draftId: string; verdict: 'same' | 'different' }) =>
      api.vendedor.verdict(v.draftId, { verdict: v.verdict }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vendedor.thread(id) });
      void qc.invalidateQueries({ queryKey: qk.vendedor.ensaio });
    },
    onError: fail,
  });

  const t = d?.thread;
  const floor = t?.floor;
  const canTake = !!t && !t.test && floor === 'agent';
  const canRelease = !!t && !t.test && t.owner === 'human' && floor === 'store';
  const takeRef = useRef<() => void>(() => undefined);
  takeRef.current = () => {
    if (canTake && !take.isPending) take.mutate();
  };
  const releaseRef = useRef<() => void>(() => undefined);
  releaseRef.current = () => {
    if (canRelease && !release.isPending) release.mutate();
  };
  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        el.closest('input, textarea, select, [contenteditable]')
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'a') takeRef.current();
      else if (k === 'd') releaseRef.current();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [keys]);

  const openWhy = (m: ThreadMessage) => {
    setWhy(m);
    if (!rail) setWhyOpen(true);
  };

  const head = t ?? row;
  const appBar = (
    <AppBar
      name={head?.name ?? ''}
      sub={d ? customerLine(d) : (row?.phone ?? '')}
      chip={
        t ? (
          t.waitingSince ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <FloorChip floor={t.floor} waiting />
              {t.reason ? <ReasonChip reason={t.reason} /> : null}
            </span>
          ) : t.test ? null : triaged(t.class) ? (
            <ClassChip cls={t.class} />
          ) : (
            <FloorChip floor={t.floor} />
          )
        ) : null
      }
      back={!embedded}
      onMore={d ? () => setSheet('customer') : undefined}
      embedded={embedded}
    />
  );

  let content: ReactNode;
  if (q.error) {
    content =
      q.error instanceof ApiError && q.error.status === 404 ? (
        <EmptyState
          art={<Mascote pose="sem-resultados" />}
          title="Essa conversa não está mais aqui"
          body="Ela pode ter sido apagada, ou o link é de outra loja."
        />
      ) : (
        <div className="p-4">
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        </div>
      );
  } else if (!d) {
    content = <ThreadSkeleton />;
  } else {
    content = (
      <div className="flex flex-col gap-1.5">
        {d.thread.test ? (
          <Notice
            tone="info"
            icon={<Flask weight="bold" />}
            title="Conversa de teste"
            className="mb-2"
          >
            Um cliente de teste falando com o Duá. Nada daqui foi para a cozinha.
          </Notice>
        ) : null}
        {d.thread.test ? null : (
          <WhyShopper
            t={d.thread}
            onPersonal={() => classify.mutate('personal')}
            busy={classify.isPending && classify.variables === 'personal'}
          />
        )}
        {d.messages.length ? (
          <ThreadMessages
            detail={d}
            onWhy={openWhy}
            outgoing={outgoing}
            onRetry={(o) => send(o.text, o.key)}
            verdict={(m, v) => verdict.mutate({ draftId: m.id, verdict: v })}
          />
        ) : (
          <p className="t-body py-10 text-center text-muted">Nenhuma mensagem ainda.</p>
        )}
      </div>
    );
  }

  const floorEl =
    d && !d.thread.test ? (
      <FloorFor
        d={d}
        onTake={() => take.mutate()}
        onRelease={() => release.mutate()}
        busy={take.isPending || release.isPending}
        onSend={(text) => send(text)}
        sending={reply.isPending}
        onUnmute={() => unmute.mutate()}
        unmuting={unmute.isPending}
        onClassify={(as) => classify.mutate(as)}
        classifying={classify.isPending ? (classify.variables ?? null) : null}
        keys={keys}
        onQuick={() => setSheet('quick')}
        prefill={prefill}
      />
    ) : null;

  // a placed order: Core keeps its total but not its lines, so the bar names the order instead
  const sacola =
    d?.order && !d.sacola?.count ? (
      <OrderBar order={d.order} />
    ) : d?.sacola ? (
      <SacolaBar
        count={d.sacola.count}
        totalCents={d.sacola.totalCents}
        step={d.sacola.step}
        onOpen={() => setSheet('sacola')}
      />
    ) : null;

  const sheets = d ? (
    <>
      <Sheet
        open={sheet === 'sacola'}
        onOpenChange={(o) => setSheet(o ? 'sacola' : null)}
        title="Sacola"
        description={
          d.sacola?.count
            ? `${d.sacola.count} ${d.sacola.count === 1 ? 'item' : 'itens'} · calculado pela loja`
            : 'calculado pela loja'
        }
      >
        {d.sacola ? <SacolaLines sacola={d.sacola} order={d.order} /> : null}
      </Sheet>
      <Sheet
        open={sheet === 'customer'}
        onOpenChange={(o) => setSheet(o ? 'customer' : null)}
        title={d.thread.name}
        description={customerLine(d)}
        footer={
          d.thread.test ? null : d.thread.owner === 'muted' ? (
            <Button
              variant="secondary"
              block
              loading={unmute.isPending}
              onClick={() => unmute.mutate()}
            >
              é cliente, sim · voltar a atender
            </Button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Button
                variant="secondary"
                block
                icon={<SpeakerSimpleSlash weight="bold" />}
                loading={mute.isPending}
                onClick={() => mute.mutate()}
              >
                não é cliente
              </Button>
              <p className="t-caption text-center text-muted">
                Para fornecedor, entregador ou família: o Duá para de responder este número.
              </p>
            </div>
          )
        }
      >
        <CustomerFacts detail={d} />
      </Sheet>
      <QuickRepliesSheet
        open={sheet === 'quick'}
        onOpenChange={(o) => setSheet(o ? 'quick' : null)}
        onPick={(text) => setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }))}
      />
      {!rail ? (
        <Sheet open={whyOpen} onOpenChange={setWhyOpen} title={whyTitle(why)}>
          {why ? <WhyBody threadId={id} message={why} /> : null}
        </Sheet>
      ) : null}
    </>
  ) : null;

  if (embedded)
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label={head ? `conversa com ${head.name}` : 'conversa'}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {appBar}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {sacola ? <div className="sticky top-0 z-10 bg-bg px-5 pb-2 pt-3">{sacola}</div> : null}
            <div className="px-5 pb-5 pt-3">{content}</div>
          </div>
          {floorEl}
        </section>
        {rail && d ? <Rail d={d} why={why} threadId={id} /> : null}
        {sheets}
      </div>
    );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-4.25rem)] w-full max-w-[880px] flex-col pb-(--tabbar-h) md:min-h-dvh">
      {appBar}
      {sacola ? (
        <div className="sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 bg-bg px-4 pb-2 pt-2 md:top-0 md:px-8 kb:top-0">
          {sacola}
        </div>
      ) : null}
      <div className="flex-1 px-4 pb-4 pt-2 md:px-8">{content}</div>
      {floorEl ? (
        <div className="sticky bottom-(--tabbar-h) z-20 md:bottom-0 md:px-8 md:pb-4">
          <div className="md:overflow-hidden md:rounded-lg md:depth-2">{floorEl}</div>
        </div>
      ) : null}
      {sheets}
    </div>
  );
}

function AppBar({
  name,
  sub,
  chip,
  back,
  onMore,
  embedded,
}: {
  name: string;
  sub: string;
  chip: ReactNode;
  back: boolean;
  onMore?: (() => void) | undefined;
  embedded?: boolean | undefined;
}) {
  const nav = useNavigate();
  return (
    <header
      className={cn(
        'flex items-center gap-3',
        embedded ? 'border-b border-line px-5 py-3' : 'px-4 pb-2 pt-3 md:px-8 md:pt-8',
      )}
    >
      {back ? (
        <IconButton
          label="voltar"
          className="-ml-3 shrink-0 max-md:hidden"
          onClick={() =>
            prevIs('/vendedor/conversas')
              ? nav(-1)
              : nav('/vendedor/conversas', { state: { vt: 'pop' } })
          }
        >
          <ArrowLeft />
        </IconButton>
      ) : null}
      {name ? <Initials name={name} /> : <Bone className="size-11 rounded-full" />}
      <div className="min-w-0 flex-1">
        {name ? (
          <h1 className={cn('truncate', embedded ? 't-title-2' : 't-title-2 md:t-title-1')}>
            {name}
          </h1>
        ) : (
          <Bone className="h-6 w-40" />
        )}
        {sub ? <p className="t-caption truncate text-muted">{sub}</p> : null}
        {chip ? <div className="mt-1.5 flex min-w-0 lg:hidden">{chip}</div> : null}
      </div>
      {chip ? <div className="hidden shrink-0 lg:flex">{chip}</div> : null}
      {onMore ? (
        <IconButton
          label="mais opções"
          aria-haspopup="dialog"
          onClick={onMore}
          className="-mr-2 shrink-0"
        >
          <DotsThree weight="bold" />
        </IconButton>
      ) : null}
    </header>
  );
}

/** Who answers now, from Core's floor (sales-agent-ux §1.3), with the words each one needs. */
function FloorFor({
  d,
  onTake,
  onRelease,
  busy,
  onSend,
  sending,
  onUnmute,
  unmuting,
  onClassify,
  classifying,
  keys,
  onQuick,
  prefill,
}: {
  d: ThreadDetail;
  onTake: () => void;
  onRelease: () => void;
  busy: boolean;
  onSend: (text: string) => void;
  sending: boolean;
  onUnmute: () => void;
  unmuting: boolean;
  onClassify: (as: ClassifyAs) => void;
  classifying: ClassifyAs | null;
  keys?: boolean | undefined;
  onQuick: () => void;
  prefill: { text: string; n: number } | undefined;
}) {
  const qc = useQueryClient();
  const t = d.thread;
  // a contact Duá stays out of gets no suggested replies: each ask is a model call
  const owner = t.floor !== 'agent' && t.floor !== 'muted' && !triaged(t.class);
  const suggestions = useSuggestions(d, owner);
  if (t.floor === 'muted')
    return (
      <section
        aria-label="quem está atendendo"
        className="glass flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3.5 py-3"
      >
        <SpeakerSimpleSlash weight="bold" className="size-5 shrink-0 text-muted" aria-hidden />
        <p className="t-body min-w-0 flex-1 text-muted">Você marcou que não é cliente.</p>
        <Button variant="ghost" size="md" loading={unmuting} onClick={onUnmute} className="-mr-2">
          desfazer
        </Button>
      </section>
    );
  if (triaged(t.class) && t.channel === 'whatsapp')
    return <TriageFloor t={t} onClassify={onClassify} busy={classifying} />;
  if (t.floor === 'agent') return <Floor variant="agent" onTake={onTake} busy={busy} keys={keys} />;
  const slow = qc.getQueryData<VendedorHome>(qk.vendedor.home)?.agent.slowAfterMin;
  const hint =
    t.floor === 'paused'
      ? d.pausedUntil
        ? `O Duá está pausado e volta sozinho ${until(d.pausedUntil)}.`
        : 'O Duá está pausado.'
      : t.floor === 'rehearsal'
        ? 'O Duá está em ensaio: escreve o que diria, sem mandar.'
        : t.floor === 'wait'
          ? slow
            ? `Se ninguém responder em ${slow} min, o Duá entra.`
            : 'Se ninguém responder logo, o Duá entra.'
          : t.floor === 'off'
            ? t.class === 'other'
              ? 'Número em “outros”: o Duá não responde.'
              : 'O Duá está desligado. Quem responde é você.'
            : t.owner !== 'human'
              ? 'Com a loja aberta, quem responde é você. O Duá atende quando a loja fecha.'
              : null;
  return (
    <Floor
      variant="owner"
      title={
        <>
          Você está atendendo
          {hint ? <span className="t-caption block font-normal text-muted">{hint}</span> : null}
        </>
      }
      onRelease={t.owner === 'human' && t.floor === 'store' ? onRelease : undefined}
      busy={busy}
      suggestions={suggestions}
      onSend={onSend}
      sending={sending}
      silenceMin={t.owner === 'human' && t.floor === 'store' ? d.humanSilenceMin : undefined}
      keys={keys}
      onQuick={onQuick}
      prefill={prefill}
    />
  );
}

/**
 * Duá's suggested replies for the store. Asked once per shopper message, not on every live
 * refresh: each ask is a model call, and the `vendedor` topic refreshes the whole tree.
 */
function useSuggestions(d: ThreadDetail, on: boolean) {
  const qc = useQueryClient();
  const lastIn = [...d.messages].reverse().find((m) => m.author === 'shopper')?.id ?? '';
  const [replies, setReplies] = useState<string[]>([]);
  const id = d.thread.id;
  useEffect(() => {
    setReplies([]);
    if (!on || !lastIn) return;
    let live = true;
    qc.fetchQuery({
      queryKey: [...qk.vendedor.suggestions(id), lastIn],
      queryFn: () => api.vendedor.suggestions(id),
      staleTime: Infinity,
    }).then(
      (r) => live && setReplies(r.replies),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [qc, id, lastIn, on]);
  return replies;
}

/** Desktop's third pane: the customer, and "por quê" for the message picked in the thread */
function Rail({
  d,
  why,
  threadId,
}: {
  d: ThreadDetail;
  why: ThreadMessage | null;
  threadId: string;
}) {
  return (
    <aside
      aria-label="cliente e por quê"
      className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-bg p-4"
    >
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-3">
          <Initials name={d.thread.name} className="size-10" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{d.thread.name}</p>
            <p className="t-caption truncate text-muted">{customerLine(d)}</p>
          </div>
        </div>
        <CustomerFacts detail={d} />
      </Card>
      <Card className="p-4">
        <h2 className="t-label mb-3">{why ? whyTitle(why) : 'Por quê'}</h2>
        {why ? (
          <WhyBody key={why.id} threadId={threadId} message={why} />
        ) : (
          <p className="t-body text-muted">
            Toque em “por quê” numa resposta do Duá para ver o que ele consultou e de onde veio cada
            valor.
          </p>
        )}
      </Card>
    </aside>
  );
}

/** The pinned bar once the sacola became an order: the stage complete, and a way to the order */
function OrderBar({ order }: { order: NonNullable<ThreadDetail['order']> }) {
  return (
    <Link
      to={`/pedidos/${order.id}`}
      className="press block rounded-md bg-surface px-3.5 py-3 depth-1 hover:bg-hover"
    >
      <span className="flex items-center gap-2.5">
        <Receipt weight="bold" className="size-5 shrink-0" aria-hidden />
        <span className="t-label min-w-0 flex-1 truncate">{orderLine(order, true)}</span>
        <span className="tnum font-display text-[1rem] font-semibold">
          {money(order.totalCents)}
        </span>
        <CaretRight weight="bold" className="size-4 shrink-0 text-muted" aria-hidden />
      </span>
      <ol className="mt-2.5 grid grid-cols-5 gap-1" aria-label="etapa do pedido: feito">
        {SACOLA_STEPS.map((s) => (
          <li
            key={s.id}
            className="flex min-w-0 flex-col gap-1.5 text-[0.6875rem] leading-[0.875rem] text-muted"
          >
            <i aria-hidden className="block h-1 rounded-full bg-primary" />
            <span className="truncate">{s.label}</span>
          </li>
        ))}
      </ol>
    </Link>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2" aria-busy aria-label="carregando a conversa">
      <Bone className="h-12 w-3/5 self-start rounded-[18px]" />
      <Bone className="h-16 w-2/3 self-end rounded-[18px]" delay={80} />
      <Bone className="h-10 w-2/5 self-start rounded-[18px]" delay={160} />
      <Bone className="h-24 w-3/4 self-end rounded-[14px]" delay={240} />
    </div>
  );
}
