import {
  ArrowCounterClockwise,
  Microphone,
  PaperPlaneRight,
  WhatsappLogo,
  WifiSlash,
  X,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  api,
  type CopilotAction,
  type CopilotActionKind,
  type CopilotItem,
  type CopilotMessage,
  type CopilotView,
} from '../../lib/api.ts';
import { useLiveState } from '../../lib/live.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { isPlanRequired, useFeature, useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ActionCard } from '../../ui/copilot/ActionCard.tsx';
import { DuaText } from '../../ui/copilot/DuaText.tsx';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { HelpButton } from '../../ui/Page.tsx';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ChatSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Bubble, DayMark } from '../../ui/vendedor/Bubble.tsx';
import { Typing } from '../../ui/vendedor/MiniChat.tsx';
import { PersonaAvatar } from '../../ui/vendedor/PersonaAvatar.tsx';
import { dayLabel, msgTime, useFollow } from '../../ui/vendedor/thread.ts';
import { SELLER_EDGE } from '../../ui/vendedor/tones.ts';

// Duá Copilot (ADR 0034): a manager or owner asks Duá about the store, or asks for a change, and
// he prepares it as a card that only "confirmar" applies. One chat, two homes: the /copiloto
// screen (the phone's way in) and the dock beside every screen from 1200 px (Shell).

/** Duá answers a few seconds later; past this the dots stop and the screen says so */
const WAIT_MS = 90_000;
const SLOW_MS = 60_000;

/** what Core takes as `screen`: an admin path, no query or hash */
const SCREEN = /^\/[a-z0-9/_-]{0,199}$/;
export const screenOf = (path: string | undefined) =>
  path && SCREEN.test(path) ? path : undefined;

const STARTERS = [
  'Como estão as vendas hoje?',
  'O que está acabando no estoque?',
  'Compare esta semana com a passada',
  'Quais produtos vendem mais?',
  'Pausar a loja por 30 minutos',
  'Criar um cupom de 10% para hoje',
];

/** On an order or a product, the first suggestion is about it ("este pedido"). */
function startersFor(screen: string | undefined) {
  const lead =
    screen &&
    /^\/pedidos\/[^/]+$/.test(screen) &&
    !/^\/pedidos\/(historico|agendados)$/.test(screen)
      ? 'Me resume este pedido'
      : screen && /^\/cardapio\/produto\/[^/]+$/.test(screen)
        ? 'Como vende este produto?'
        : null;
  return lead ? [lead, ...STARTERS.slice(0, 5)] : STARTERS;
}

// what an applied card changed, refreshed here too (the live stream does it when it's up)
const TOUCHES: Record<CopilotActionKind, QueryKey[]> = {
  'store.pause': [qk.store, qk.home],
  'store.resume': [qk.store, qk.home],
  'store.operations': [qk.store, qk.home],
  'store.special_day': [qk.store, qk.home],
  'product.update': [['catalog'], qk.home],
  'products.price': [['catalog'], qk.home],
  'coupon.create': [qk.marketing],
  'coupon.update': [qk.marketing],
};

type ActionItem = { type: 'action' } & CopilotAction;
type Decision = 'confirm' | 'decline';

/** a message sent from here that Core hasn't answered for yet, or that failed */
interface Outgoing {
  key: string;
  text: string;
  screen: string | undefined;
  at: number;
  failed: boolean;
}

/** when the last message is the person's and Duá is still on it (Core's `busy`) */
function askedAt(v: CopilotView | undefined) {
  if (!v?.busy) return null;
  const last = v.items.filter((i) => i.type === 'message').at(-1);
  return last && last.author === 'merchant' ? new Date(last.at).getTime() : null;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** The conversation and everything done to it, shared by the screen and the dock. */
function useCopilot() {
  const qc = useQueryClient();
  const open = useFeature('copilot');
  const q = useQuery({
    queryKey: qk.copilot,
    queryFn: api.copilot.view,
    enabled: open,
    // his reply comes over the live stream; this covers a stream that's down
    refetchInterval: (query) => {
      const at = askedAt(query.state.data);
      return at !== null && Date.now() - at < WAIT_MS ? 1500 : false;
    },
  });
  const view = q.data;
  const put = (v: CopilotView) => qc.setQueryData(qk.copilot, v);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);

  const sendM = useMutation({
    mutationFn: (o: { text: string; screen: string | undefined }) =>
      api.copilot.send(o.text, o.screen),
  });
  const send = (text: string, screen: string | undefined, key: string = crypto.randomUUID()) => {
    setOutgoing((o) => [
      ...o.filter((x) => x.key !== key),
      { key, text, screen, at: Date.now(), failed: false },
    ]);
    sendM.mutateAsync({ text, screen }).then(
      (v) => {
        put(v);
        setOutgoing((o) => o.filter((x) => x.key !== key));
      },
      (e: unknown) => {
        setOutgoing((o) => o.map((x) => (x.key === key ? { ...x, failed: true } : x)));
        if (isPlanRequired(e)) void qc.invalidateQueries({ queryKey: qk.session });
        toast.error(messageOf(e));
      },
    );
  };

  const decideM = useMutation({
    mutationFn: (d: { id: string; decision: Decision }) => api.copilot.decide(d.id, d.decision),
    onSuccess: (v, d) => {
      put(v);
      const a = v.items.find((i): i is ActionItem => i.type === 'action' && i.id === d.id);
      if (!a || d.decision !== 'confirm') return;
      if (a.status === 'applied') {
        toast(a.done ? `Feito: ${a.done}` : 'Feito.');
        for (const k of TOUCHES[a.kind] ?? []) void qc.invalidateQueries({ queryKey: k });
      } else if (a.status === 'failed') toast.error(a.error ?? 'A loja não aceitou essa mudança.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const resetM = useMutation({
    mutationFn: () => api.copilot.reset(),
    onSuccess: (v) => {
      put(v);
      setOutgoing([]);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  // a reply that raced the POST's answer (the stream refetched first) already holds the message
  const shown = outgoing.filter(
    (o) =>
      o.failed ||
      !view?.items.some(
        (i) =>
          i.type === 'message' &&
          i.author === 'merchant' &&
          i.text === o.text &&
          new Date(i.at).getTime() > o.at - 10_000,
      ),
  );
  const asked = askedAt(view);
  const sending = shown.some((o) => !o.failed);
  // ticks only while a threshold (the hint, the end of the dots) is still ahead
  const now = useNow(sending || (asked !== null && Date.now() - asked < WAIT_MS + 5_000));
  const age = asked === null ? null : now - asked;
  const typing = sending || (age !== null && age < WAIT_MS);
  const lastMsg = view?.items.filter((i) => i.type === 'message').at(-1);

  return {
    open,
    q,
    view,
    locked: !open || isPlanRequired(q.error),
    outgoing: shown,
    send,
    retry: (o: Outgoing) => send(o.text, o.screen, o.key),
    decide: (id: string, decision: Decision) => {
      if (!decideM.isPending) decideM.mutate({ id, decision });
    },
    deciding: decideM.isPending ? (decideM.variables ?? null) : null,
    reset: resetM,
    typing,
    slow: !sending && age !== null && age >= SLOW_MS && age < WAIT_MS,
    // he never answered that one: say so quietly instead of waiting forever
    silent: !typing && lastMsg?.author === 'merchant' && !shown.length,
    empty: !!view && !view.items.length && !shown.length,
    count: (view?.items.length ?? 0) + shown.length + (typing ? 1 : 0),
  };
}

type Chat = ReturnType<typeof useCopilot>;

// on a wide page a bubble stops at 38rem, so a long reply stays easy to read
const WIDTH = 'max-w-[min(84%,38rem)]!';

/** a message that came or went by WhatsApp says so on its bubble (dua-no-whatsapp §2) */
function channelTag(m: CopilotMessage) {
  if (m.channel !== 'whatsapp') return {};
  return m.voice
    ? { tag: 'áudio pelo WhatsApp', tagIcon: <Microphone weight="bold" aria-hidden /> }
    : { tag: 'pelo WhatsApp', tagIcon: <WhatsappLogo weight="bold" aria-hidden /> };
}

// ── the screen ──────────────────────────────────────────────────────────────

/**
 * `/copiloto`: the chat as a page. On phones a screen one level down, with the composer held
 * above the tab bar (and the keyboard); opened from the header's Duá, the first message carries
 * the screen it came from, so "este pedido" is that order.
 */
export default function Copilot() {
  const loc = useLocation();
  const from = screenOf((loc.state as { from?: string } | null)?.from);
  const c = useCopilot();
  const [sheet, setSheet] = useState(false);
  // only the first message is about the screen it came from
  const fromUsed = useRef(false);
  // the hello stays at the top; a conversation opens at its end
  useFollow(null, c.count, !!c.view && !c.empty);

  if (c.locked)
    return (
      <LockedPage
        title="Copiloto"
        feature="copilot"
        reason={reasonOf(c.q.error)}
        refresh={c.open}
      />
    );

  const send = (text: string) => {
    const screen = fromUsed.current ? undefined : from;
    fromUsed.current = true;
    c.send(text, screen);
  };
  const hasChat = !!c.view?.items.length;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--topbar-h))] w-full max-w-[880px] flex-col pb-(--tabbar-h) md:min-h-dvh">
      <header className="flex flex-wrap items-start gap-x-2 px-4 pt-4 md:px-8 md:pt-8">
        <h1 className="t-title-1 min-w-0 flex-1 pt-1.5">Copiloto</h1>
        {hasChat ? (
          <>
            <IconButton label="nova conversa" onClick={() => setSheet(true)} className="md:hidden">
              <ArrowCounterClockwise weight="bold" />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowCounterClockwise weight="bold" />}
              onClick={() => setSheet(true)}
              aria-haspopup="dialog"
              className="min-h-12 max-md:hidden"
            >
              nova conversa
            </Button>
          </>
        ) : null}
        <HelpButton className="-mr-2 shrink-0 md:mr-0" />
        <p className="t-body -mt-1 w-full text-muted md:mt-0">O Duá cuida da loja com você</p>
      </header>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-4 md:px-8 md:pt-6">
        {c.q.error && !c.view ? (
          <ErrorState error={c.q.error} retry={() => void c.q.refetch()} />
        ) : !c.view ? (
          <ChatSkeleton />
        ) : c.empty ? (
          <Hello starters={startersFor(from)} onPick={send} />
        ) : (
          <Thread c={c} />
        )}
      </div>

      <div className="sticky bottom-(--tabbar-h) z-20 md:bottom-0 md:px-8 md:pb-4">
        <div className="md:overflow-hidden md:rounded-lg md:depth-2">
          <Composer id="copilot-msg" onSend={send} className="md:border-t-0" />
        </div>
      </div>
      <NewChatSheet open={sheet} onOpenChange={setSheet} reset={c.reset} />
    </div>
  );
}

// ── the dock ────────────────────────────────────────────────────────────────

/**
 * The same chat docked beside every screen from 1200 px (Shell): each message carries the
 * screen it was sent from. `focus` changes when the person opens it, to put the cursor in it.
 */
export function CopilotDock({ onClose, focus }: { onClose: () => void; focus: number }) {
  const loc = useLocation();
  const screen = screenOf(loc.pathname);
  const c = useCopilot();
  const scroller = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  useFollow(scroller, c.count, !!c.view && !c.empty);
  const hasChat = !!c.view?.items.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line py-2.5 pl-4 pr-2">
        <PersonaAvatar size="sm" answering={c.typing} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-5">Copiloto</h2>
          <p className="t-caption truncate text-muted">O Duá cuida da loja com você</p>
        </div>
        {hasChat && !c.locked ? (
          <IconButton
            size="sm"
            label="nova conversa"
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
          >
            <ArrowCounterClockwise weight="bold" />
          </IconButton>
        ) : null}
        <IconButton size="sm" label="fechar o Copiloto" onClick={onClose}>
          <X weight="bold" />
        </IconButton>
      </header>
      {c.locked ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <PlanLocked feature="copilot" compact reason={reasonOf(c.q.error)} refresh={c.open} />
        </div>
      ) : (
        <>
          <div
            ref={scroller}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4"
          >
            {c.q.error && !c.view ? (
              <ErrorState error={c.q.error} retry={() => void c.q.refetch()} />
            ) : !c.view ? (
              <ChatSkeleton />
            ) : c.empty ? (
              <Hello starters={startersFor(screen)} onPick={(t) => c.send(t, screen)} dock />
            ) : (
              <Thread c={c} dock />
            )}
          </div>
          <Composer id="copilot-dock-msg" onSend={(t) => c.send(t, screen)} focus={focus} />
        </>
      )}
      <NewChatSheet open={sheet} onOpenChange={setSheet} reset={c.reset} />
    </div>
  );
}

// ── the pieces ──────────────────────────────────────────────────────────────

/** The first time (and after "nova conversa"): Duá says hello and offers what to ask. */
function Hello({
  starters,
  onPick,
  dock,
}: {
  starters: string[];
  onPick: (text: string) => void;
  dock?: boolean;
}) {
  const s = useSession();
  const { online } = useLiveState();
  const first = s.user.name.trim().split(/\s+/)[0] ?? '';
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
      <span
        className={cn(
          'dua-disc grid shrink-0 place-items-center overflow-hidden bg-spark-soft',
          dock ? 'size-24' : 'size-28 md:size-32',
        )}
      >
        <Mascote pose="avatar-ola" size={dock ? 88 : 120} className="mt-3" />
      </span>
      <p className={cn('mt-4', dock ? 't-title-2' : 't-title-2 md:t-title-1')}>
        Oi{first ? `, ${first}` : ''}! Eu sou o Duá.
      </p>
      <p className="t-body mt-1 max-w-[22rem] text-muted">
        Pergunte da loja ou peça uma mudança. Eu preparo, você confirma.
      </p>
      <div
        role="group"
        aria-label="sugestões para começar"
        className={cn('mt-6 flex flex-wrap justify-center gap-2', dock ? 'max-w-full' : 'max-w-xl')}
      >
        {starters.map((t) => (
          <button
            key={t}
            type="button"
            disabled={!online}
            onClick={() => onPick(t)}
            className={cn(
              'press min-h-11 rounded-full bg-spark-soft px-4 py-2 text-left text-[0.9375rem] font-medium leading-5 text-ink hover:brightness-[0.97] disabled:opacity-45',
              SELLER_EDGE,
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The conversation: the person on the right, Duá on the left with his cards under his reply. */
function Thread({ c, dock }: { c: Chat; dock?: boolean }) {
  const items = c.view?.items ?? [];
  let prevDay = '';
  let prevDua = false;
  const rows: ReactNode[] = items.map((it: CopilotItem) => {
    const day = dayLabel(it.at);
    const mark = day !== prevDay ? <DayMark>{day}</DayMark> : null;
    prevDay = day;
    let body: ReactNode;
    if (it.type === 'action') {
      body = (
        <ActionCard
          action={it}
          onConfirm={() => c.decide(it.id, 'confirm')}
          onDecline={() => c.decide(it.id, 'decline')}
          busy={c.deciding?.id === it.id ? c.deciding.decision : null}
          className={cn('my-1 self-start', !dock && 'max-w-[30rem]')}
        />
      );
      prevDua = true;
    } else if (it.author === 'dua') {
      body = (
        <Bubble
          voice="seller"
          align="start"
          time={msgTime(it.at)}
          signed={!prevDua}
          {...channelTag(it)}
          className={WIDTH}
        >
          <DuaText text={it.text} />
        </Bubble>
      );
      prevDua = true;
    } else {
      body = (
        <Bubble
          voice="you"
          author="você"
          time={msgTime(it.at)}
          {...channelTag(it)}
          className={WIDTH}
        >
          {it.text}
        </Bubble>
      );
      prevDua = false;
    }
    return (
      <Fragment key={`${it.type}:${it.id}`}>
        {mark}
        {body}
      </Fragment>
    );
  });
  return (
    <div className="flex flex-col gap-1.5">
      {rows}
      {c.outgoing.map((o) => (
        <Fragment key={o.key}>
          <Bubble
            voice="you"
            author="você"
            status={o.failed ? 'failed' : 'queued'}
            className={WIDTH}
          >
            {o.text}
          </Bubble>
          {o.failed ? (
            <button
              type="button"
              onClick={() => c.retry(o)}
              className="t-caption relative -mt-0.5 self-end font-semibold text-ink underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
            >
              tentar de novo
            </button>
          ) : null}
        </Fragment>
      ))}
      {c.typing ? (
        <div className="flex flex-col items-start gap-1">
          <p className="t-caption mt-1.5 flex items-center gap-1.5 font-semibold text-muted">
            <PersonaAvatar size="xs" answering />
            Duá · IA
          </p>
          <Typing owner />
          {c.slow ? (
            <p className="t-caption mt-0.5 text-muted" role="status">
              Está demorando mais que o normal…
            </p>
          ) : null}
        </div>
      ) : c.silent ? (
        <p className="t-caption mt-1 self-start text-muted" role="status">
          O Duá não respondeu desta vez. Pergunte de novo.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Floor's owner composer: a growing field (Enter sends, Shift+Enter breaks the line, never
 * mid-composition) and the send button. Offline it waits, and says so.
 */
function Composer({
  id,
  onSend,
  focus,
  className,
}: {
  id: string;
  onSend: (text: string) => void;
  /** changes when the cursor should go here */
  focus?: number;
  className?: string;
}) {
  const { online } = useLiveState();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focus) field.current?.focus();
  }, [focus]);
  const send = () => {
    const t = text.trim();
    if (!t || !online) return;
    onSend(t);
    setText('');
  };
  return (
    <section
      aria-label="mensagem para o Duá"
      className={cn('glass flex flex-col gap-2 border-t border-line px-3.5 pb-4 pt-3', className)}
    >
      {!online ? (
        <p className="t-caption flex items-center gap-1.5 text-muted" role="status">
          <WifiSlash weight="bold" className="size-4 shrink-0" aria-hidden />
          Sem conexão. Dá para mandar assim que a internet voltar.
        </p>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor={id}>
          sua mensagem para o Duá
        </label>
        <textarea
          ref={field}
          id={id}
          rows={1}
          value={text}
          maxLength={2000}
          disabled={!online}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Pergunte ou peça uma mudança…"
          className="t-body-lg field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-md bg-surface px-3.5 py-2.5 text-ink ring-1 ring-inset ring-line-strong placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        />
        <IconButton
          type="submit"
          label="enviar"
          variant="primary"
          disabled={!text.trim() || !online}
        >
          <PaperPlaneRight weight="fill" />
        </IconButton>
      </form>
    </section>
  );
}

/** "Nova conversa" asks first: Duá forgets the chat (what was confirmed stays). */
function NewChatSheet({
  open,
  onOpenChange,
  reset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reset: Chat['reset'];
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Começar uma conversa nova?"
      footer={
        <div className="flex flex-col gap-2 md:flex-row-reverse">
          <Button
            block
            loading={reset.isPending}
            onClick={() => reset.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
            className="md:w-auto"
          >
            começar de novo
          </Button>
          <Button variant="ghost" block onClick={() => onOpenChange(false)} className="md:w-auto">
            cancelar
          </Button>
        </div>
      }
    >
      <p className="t-body text-muted">
        O Duá esquece esta conversa. O que você já confirmou continua valendo.
      </p>
    </Sheet>
  );
}
