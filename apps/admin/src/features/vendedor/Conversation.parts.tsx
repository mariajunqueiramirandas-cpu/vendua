import {
  BookOpen,
  Camera,
  HandPalm,
  Info,
  Link as LinkIcon,
  MagnifyingGlass,
  Package,
  Prohibit,
  QrCode,
  Receipt,
  ShieldCheck,
  Storefront,
  User,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type Sacola,
  type SummaryCardData,
  type ThreadDetail,
  type ThreadMessage,
  type WhyView,
} from '../../lib/api.ts';
import { dateShort, money, plural, when } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Bone } from '../../ui/skeletons.tsx';
import {
  ActionReceipt,
  Bubble,
  CoreMark,
  CoreReceipt,
  DayMark,
  EventChip,
  VoiceNote,
  type BubbleStatus,
} from '../../ui/vendedor/index.ts';
import { PAPER } from '../../ui/vendedor/tones.ts';

// ── small helpers ─────────────────────────────────────────────────────────────

export function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** The shopper's face in lists and app bars: initials on paper, a person when there are none. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const i = initials(name);
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full bg-sunken font-display text-[0.9375rem] font-semibold text-ink',
        className,
      )}
    >
      {i || <User weight="bold" className="size-5 text-muted" />}
    </span>
  );
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'hoje';
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return 'ontem';
  return dateShort(d);
}

/** "19:42" in the thread, the admin's own clock style */
export const msgTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** "mar 2025" */
export const monthYear = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' })
    .format(new Date(iso))
    .replace(/\./g, '')
    .replace(' de ', ' ');

/** "14 pedidos · cliente desde mar 2025", or what little we know of a first-timer */
export function customerLine(d: Pick<ThreadDetail, 'customer' | 'thread'>) {
  const c = d.customer;
  if (c && c.orders > 0)
    return `${plural(c.orders, 'pedido', 'pedidos')}${c.firstSeen ? ` · cliente desde ${monthYear(c.firstSeen)}` : ''}`;
  if (d.thread.channel === 'web') return 'conversa pelo site';
  return [d.thread.phone, 'primeira conversa'].filter(Boolean).join(' · ');
}

const STATUS: Record<string, BubbleStatus> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

const ORDER_STATE: Record<string, string> = {
  placed: 'feito',
  confirmed: 'aceito',
  preparing: 'em preparo',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export function orderLine(o: NonNullable<ThreadDetail['order']>, short = false) {
  if (short) return `Pedido #${o.number} · ${ORDER_STATE[o.state] ?? o.state}`;
  const pay =
    o.paymentStatus === 'paid'
      ? 'pago'
      : o.state === 'cancelled' || o.state === 'refunded'
        ? null
        : 'aguardando pagamento';
  return [`Pedido #${o.number} ${ORDER_STATE[o.state] ?? o.state}`, pay]
    .filter(Boolean)
    .join(' · ');
}

// What Core's cards did, in Duá's past tense (sales-agent-ux §5)
const CARD: Record<string, { words: string; title: string; Icon: Icon }> = {
  summary: { words: 'gerou o resumo do pedido', title: 'Seu pedido', Icon: Receipt },
  pix: { words: 'mandou o Pix', title: 'Pix', Icon: QrCode },
  order: { words: 'fez o pedido', title: 'Pedido', Icon: Package },
  link: { words: 'mandou o link da sacola', title: 'Link da sacola', Icon: LinkIcon },
  product: { words: 'mostrou um produto', title: 'Produto', Icon: Package },
};

const isSummary = (d: unknown): d is SummaryCardData =>
  !!d && typeof d === 'object' && Array.isArray((d as SummaryCardData).lines);

/** WhatsApp's *bold* and _italic_ markers, as plain words */
const plain = (s: string) => s.replace(/(^|\s)[*_~]+|[*_~]+(?=\s|$)/g, '$1');

// ── the thread ───────────────────────────────────────────────────────────────

/** a reply the store sent from here that Core hasn't answered for yet, or that failed */
export interface Outgoing {
  key: string;
  text: string;
  failed: boolean;
}

/**
 * The messages of a conversation in three voices, with Core's receipts and cards between them
 * and "por quê" once per turn of his. `asCustomer` is the test chat: the owner plays the
 * shopper on the right in forest, and Duá answers from the left (MiniChat's `owner`).
 */
export function ThreadMessages({
  detail,
  onWhy,
  outgoing = [],
  onRetry,
  verdict,
  asCustomer,
}: {
  detail: ThreadDetail;
  onWhy?: ((m: ThreadMessage) => void) | undefined;
  outgoing?: Outgoing[] | undefined;
  onRetry?: ((o: Outgoing) => void) | undefined;
  /** Ensaio: "eu mandaria isso" / "eu mandaria diferente" under each draft */
  verdict?: ((m: ThreadMessage, v: 'same' | 'different') => void) | undefined;
  asCustomer?: boolean | undefined;
}) {
  // skipped: Duá wrote it while the floor wasn't his, and it never went out
  const msgs = detail.messages.filter((m) => !(m.author === 'agent' && m.status === 'skipped'));
  // "por quê" once per turn: on its card's receipt, else under its last bubble
  const carded = new Set(msgs.filter((m) => m.card && m.turnId).map((m) => m.turnId));
  const lastOfTurn = new Map<string, string>();
  for (const m of msgs) if (m.turnId && m.author === 'agent') lastOfTurn.set(m.turnId, m.id);
  const shopper = detail.thread.name;
  const sellerSide = asCustomer ? 'start' : 'end';
  let prevDay = '';
  let prevAuthor = '';
  return (
    <>
      {msgs.map((m) => {
        const day = dayLabel(m.at);
        const dayMark = day !== prevDay ? <DayMark>{day}</DayMark> : null;
        prevDay = day;
        const signed = !(prevAuthor === 'agent' && m.author === 'agent');
        prevAuthor = m.author;
        const time = msgTime(m.at);
        const why = onWhy && m.turnId ? () => onWhy(m) : undefined;
        let body: ReactNode;
        if (m.author === 'shopper') {
          const voice = asCustomer ? 'you' : 'in';
          const author = asCustomer ? 'você, como cliente' : shopper;
          body =
            m.kind === 'audio' ? (
              <VoiceNote
                seconds={m.seconds}
                transcript={m.transcript ?? m.body}
                voice={voice}
                time={time}
                className={asCustomer ? 'self-end' : undefined}
              />
            ) : (
              <Bubble voice={voice} author={author} time={time}>
                {m.body ?? <Media />}
              </Bubble>
            );
        } else if (m.author === 'agent') {
          const draft = m.status === 'draft';
          body = (
            <>
              <Bubble
                voice="seller"
                time={time}
                status={STATUS[m.status]}
                tag={m.suggestion ? 'sugestão' : undefined}
                draft={draft}
                signed={signed}
                align={sellerSide}
              >
                {m.body ?? <Media />}
              </Bubble>
              {draft && verdict ? <Verdict m={m} onVerdict={verdict} /> : null}
              {why && !carded.has(m.turnId) && lastOfTurn.get(m.turnId!) === m.id ? (
                <WhyLink onClick={why} align={sellerSide} suggestion={m.suggestion} />
              ) : null}
            </>
          );
        } else if (m.author === 'merchant') {
          body = (
            <Bubble voice="you" author="você" time={time} status={STATUS[m.status]}>
              {m.body ?? <Media />}
            </Bubble>
          );
        } else if (m.card) {
          const c = CARD[m.card];
          body = (
            <>
              <ActionReceipt icon={c?.Icon} onWhy={why}>
                {c?.words ?? 'mandou um cartão da loja'}
              </ActionReceipt>
              {m.card === 'summary' && isSummary(m.data) ? (
                <CoreReceipt data={m.data} align={sellerSide} />
              ) : (
                <CoreCard title={c?.title ?? 'Da loja'} align={sellerSide}>
                  {plain(m.body ?? '')}
                </CoreCard>
              )}
            </>
          );
        } else {
          body = <StoreNote align={sellerSide}>{m.body}</StoreNote>;
        }
        return (
          <Fragment key={m.id}>
            {dayMark}
            {body}
          </Fragment>
        );
      })}
      {detail.order && !asCustomer ? (
        <EventChip to={`/pedidos/${detail.order.id}`}>{orderLine(detail.order)}</EventChip>
      ) : null}
      {outgoing.map((o) => (
        <Fragment key={o.key}>
          <Bubble voice="you" author="você" status={o.failed ? 'failed' : 'queued'}>
            {o.text}
          </Bubble>
          {o.failed && onRetry ? (
            <button
              type="button"
              onClick={() => onRetry(o)}
              className="t-caption relative -mt-0.5 self-end font-semibold text-ink underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
            >
              tentar de novo
            </button>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

function Media() {
  return (
    <span className="inline-flex items-center gap-1.5 italic text-muted">
      <Camera weight="bold" className="size-4" aria-hidden />
      foto
    </span>
  );
}

function WhyLink({
  onClick,
  align,
  suggestion,
}: {
  onClick: () => void;
  align: 'start' | 'end';
  suggestion: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={suggestion ? 'por que o Duá sugeriu isso' : 'por que o Duá respondeu assim'}
      className={cn(
        "t-caption relative mb-1 font-semibold text-muted underline underline-offset-2 hover:text-ink after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']",
        align === 'end' ? 'self-end' : 'self-start',
      )}
    >
      por quê
    </button>
  );
}

function Verdict({
  m,
  onVerdict,
}: {
  m: ThreadMessage;
  onVerdict: (m: ThreadMessage, v: 'same' | 'different') => void;
}) {
  if (m.verdict)
    return (
      <p className="t-caption self-end text-muted">
        {m.verdict === 'same'
          ? 'você mandaria isso'
          : m.verdict === 'different'
            ? 'você mandaria diferente'
            : 'comparado'}
      </p>
    );
  const cls =
    'press t-label h-12 rounded-full bg-surface px-4 text-[0.875rem] ring-1 ring-inset ring-line-strong hover:bg-hover';
  return (
    <div
      className="flex flex-wrap justify-end gap-2 self-end"
      role="group"
      aria-label="você mandaria isso?"
    >
      <button type="button" className={cls} onClick={() => onVerdict(m, 'same')}>
        eu mandaria isso
      </button>
      <button type="button" className={cls} onClick={() => onVerdict(m, 'different')}>
        eu mandaria diferente
      </button>
    </div>
  );
}

/** Core's own card (Pix, link, order, product): paper with its words, every figure Core's */
function CoreCard({
  title,
  children,
  align,
}: {
  title: string;
  children: ReactNode;
  align: 'start' | 'end';
}) {
  return (
    <figure
      className={cn(
        'm-0 w-[min(88%,24rem)] rounded-[14px] px-3.5 pb-2.5 pt-3',
        PAPER,
        align === 'end' ? 'self-end' : 'self-start',
      )}
    >
      <figcaption className="flex items-center justify-between gap-2 text-muted">
        <span className="text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.08em]">
          {title}
        </span>
        <CoreMark />
      </figcaption>
      <p className="mt-1.5 whitespace-pre-line text-[0.875rem] leading-5 [overflow-wrap:anywhere]">
        {children}
      </p>
    </figure>
  );
}

/** A message the store's system sent on its own ("vou chamar alguém da loja") */
function StoreNote({ children, align }: { children: ReactNode; align: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'flex max-w-[84%] flex-col gap-1',
        align === 'end' ? 'items-end self-end' : 'items-start self-start',
      )}
    >
      <p className="t-caption mt-1.5 flex items-center gap-1.5 font-semibold text-muted">
        <Storefront weight="bold" className="size-4" aria-hidden />
        mensagem automática da loja
      </p>
      <p className="t-body-lg rounded-[18px] rounded-br-md bg-sunken px-3 py-2 text-ink [overflow-wrap:anywhere]">
        {children}
      </p>
    </div>
  );
}

// ── "por quê" ────────────────────────────────────────────────────────────────

const STEP: Record<WhyView['steps'][number]['kind'], { Icon: Icon; tone: string }> = {
  lookup: { Icon: MagnifyingGlass, tone: 'text-muted' },
  figure: { Icon: ShieldCheck, tone: 'text-success' },
  rule: { Icon: BookOpen, tone: 'text-muted' },
  action: { Icon: HandPalm, tone: 'text-ink' },
  blocked: { Icon: Prohibit, tone: 'text-warning' },
};

export const whyTitle = (m: ThreadMessage | null) =>
  m?.suggestion
    ? 'Por que o Duá sugeriu isso'
    : m?.card
      ? 'Por que o Duá fez isso'
      : 'Por que o Duá respondeu assim';

/**
 * The turn behind a message in plain words (UX §3.3): what the shopper asked, what he looked
 * up, which figures came from the store, which rule applied. Then "ensinar a responder
 * diferente", which opens Ensinar with the question filled in.
 */
export function WhyBody({ threadId, message }: { threadId: string; message: ThreadMessage }) {
  const teach = useCan('manager');
  const q = useQuery({
    queryKey: qk.vendedor.why(threadId, message.id),
    queryFn: () => api.vendedor.why(threadId, message.id),
    staleTime: Infinity,
  });
  if (q.isPending)
    return (
      <div className="space-y-3 py-2" aria-busy>
        <Bone className="h-4 w-3/4" />
        <Bone className="h-4 w-2/3" delay={80} />
        <Bone className="h-4 w-1/2" delay={160} />
      </div>
    );
  if (q.error || !q.data)
    return <p className="t-body text-muted">Não deu para abrir o motivo agora. Tente de novo.</p>;
  const w = q.data;
  return (
    <div className="flex flex-col gap-4">
      {w.asked ? (
        <div>
          <p className="t-caption font-semibold text-muted">o cliente escreveu</p>
          <blockquote className="t-body mt-1 border-l-2 border-line-strong pl-3 italic">
            “{w.asked}”
          </blockquote>
        </div>
      ) : null}
      {w.steps.length ? (
        <ul className="flex flex-col gap-2.5">
          {w.steps.map((s, i) => {
            const st = STEP[s.kind] ?? STEP.lookup;
            return (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full bg-sunken',
                    st.tone,
                  )}
                >
                  <st.Icon weight="bold" className="size-4" aria-hidden />
                </span>
                <span className="t-body min-w-0 pt-0.5 [overflow-wrap:anywhere]">
                  {s.text[0]!.toUpperCase() + s.text.slice(1)}.
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-body text-muted">Ele só respondeu, sem consultar nada da loja.</p>
      )}
      {teach && w.asked ? (
        <ButtonLink
          to={`/vendedor/ensinar?pergunta=${encodeURIComponent(w.asked.slice(0, 200))}`}
          variant="quiet"
          icon={<BookOpen weight="bold" />}
          className="self-start"
        >
          ensinar o Duá a responder diferente
        </ButtonLink>
      ) : null}
    </div>
  );
}

// ── the customer and the sacola ──────────────────────────────────────────────

/** What the store knows of this shopper: orders, the usual, how they pay (masked phone). */
export function CustomerFacts({ detail }: { detail: ThreadDetail }) {
  const c = detail.customer;
  if (!c)
    return (
      <p className="t-body text-muted">
        {detail.thread.channel === 'web'
          ? 'Conversa pelo chat do site: sem WhatsApp para mostrar.'
          : 'Ainda não pediu nada nesta loja.'}
      </p>
    );
  const short: [string, ReactNode][] = [];
  if (c.phone) short.push(['WhatsApp', <span className="tnum">{c.phone}</span>]);
  short.push(['Pedidos', <span className="tnum">{c.orders}</span>]);
  if (c.preferredPayment) short.push(['Paga com', c.preferredPayment]);
  const long: [string, ReactNode][] = [];
  if (c.usual) long.push(['Sempre pede', c.usual]);
  if (c.lastOrder)
    long.push([
      'Último pedido',
      `#${c.lastOrder.number} · ${c.lastOrder.items} · ${when(c.lastOrder.placedAt)}`,
    ]);
  if (c.addresses.length) long.push(['Endereços', c.addresses.map((a) => a.label).join(' · ')]);
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2">
        {short.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="t-body text-muted">{k}</dt>
            <dd className="t-body min-w-0 truncate font-semibold">{v}</dd>
          </div>
        ))}
        {long.map(([k, v]) => (
          <div key={k} className="mt-1">
            <dt className="t-caption text-muted">{k}</dt>
            <dd className="t-body font-semibold [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {c.cancelledRecently > 0 ? (
        <p className="t-caption flex items-center gap-1.5 rounded-sm bg-warning-soft px-2.5 py-1.5 font-semibold text-warning">
          <Warning weight="bold" className="size-4 shrink-0" aria-hidden />
          cancelou {plural(c.cancelledRecently, 'pedido', 'pedidos')} há pouco
        </p>
      ) : null}
    </div>
  );
}

/** Every line of the live sacola, as Core priced it */
export function SacolaLines({ sacola, order }: { sacola: Sacola; order: ThreadDetail['order'] }) {
  return (
    <div className="flex flex-col gap-4">
      {sacola.lines.length ? (
        <table className="w-full border-collapse text-[0.9375rem] leading-6">
          <caption className="sr-only">
            sacola, calculada pela loja: total {money(sacola.totalCents)}
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">item</th>
              <th scope="col">valor</th>
            </tr>
          </thead>
          <tbody>
            {sacola.lines.map((l, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2 pr-3 align-top [overflow-wrap:anywhere]">{l.text}</td>
                <td className="tnum whitespace-nowrap py-2 text-right align-top font-display font-medium">
                  {money(l.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pt-2.5 text-left font-bold">
                Total até agora
              </th>
              <td className="tnum whitespace-nowrap pt-2.5 text-right font-display text-[1.0625rem] font-bold">
                {money(sacola.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : null}
      <p className="flex items-start gap-1.5 text-muted">
        <Info weight="bold" className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="t-caption">
          Valores calculados pela loja, com o seu cardápio. A entrega e o pagamento entram no resumo
          antes de fechar.
        </span>
      </p>
      {order ? (
        <ButtonLink
          to={`/pedidos/${order.id}`}
          variant="secondary"
          icon={<Receipt weight="bold" />}
        >
          ver o pedido #{order.number}
        </ButtonLink>
      ) : null}
    </div>
  );
}

// ── scrolling ────────────────────────────────────────────────────────────────

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A conversation opens at its newest message, and follows new ones while you're near the end
 * (not when you scrolled up to read). `box` is the pane's own scroller; without it, the page.
 */
export function useFollow(
  box: React.RefObject<HTMLElement | null> | null,
  count: number,
  ready: boolean,
) {
  const first = useRef(true);
  const [near, setNear] = useState(true);
  useEffect(() => {
    const el = box?.current;
    const target: HTMLElement | Window = el ?? window;
    const on = () => {
      const gap = el
        ? el.scrollHeight - el.scrollTop - el.clientHeight
        : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      setNear(gap < 240);
    };
    target.addEventListener('scroll', on, { passive: true });
    return () => target.removeEventListener('scroll', on);
  }, [box]);
  useLayoutEffect(() => {
    if (!ready) return;
    if (!first.current && !near) return;
    const smooth = !first.current && !reduced();
    const go = () => {
      const el = box?.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      else
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto',
        });
    };
    go();
    // the page's own scroll restore runs after the first paint: land at the end after it
    if (first.current) requestAnimationFrame(() => requestAnimationFrame(go));
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ready]);
}
