import {
  ArrowCounterClockwise,
  Bag,
  CalendarBlank,
  Check,
  CookingPot,
  DotsThree,
  Fire,
  Moped,
  NotePencil,
  Prohibit,
  WarningOctagon,
} from '@phosphor-icons/react';
import { memo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { KitchenItem, KitchenTicket } from '../../lib/api.ts';
import { cn } from '../../ui/cn.ts';
import {
  actionFor,
  allergySegments,
  isWithout,
  itemMatches,
  itemsFor,
  mentionsAllergy,
  minutes,
  modifierLabel,
  progress,
  stopwatch,
  timing,
  type StationPick,
  type Urgency,
} from './model.ts';

// One shared second for every timer on screen (thirty tickets, one interval).
let second = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;
const beats = new Set<() => void>();
function onBeat(fn: () => void) {
  beats.add(fn);
  if (!ticker) {
    second = Date.now();
    ticker = setInterval(() => {
      second = Date.now();
      beats.forEach((b) => b());
    }, 1000);
  }
  return () => {
    beats.delete(fn);
    if (!beats.size && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
/** now, to the second; `fixed` pins it (the /_ui reference) */
export function useSecond(fixed?: number) {
  const now = useSyncExternalStore(onBeat, () => second);
  return fixed ?? now;
}

// Colour is never the only signal (§4.2): each urgency has a tint, a fuse and a word.
export const URGENCY: Record<
  Urgency,
  { word: string; text: string; band: string; fuse: string; ring: string }
> = {
  fresh: {
    word: 'no tempo',
    text: 'text-success',
    band: '',
    fuse: 'bg-success',
    ring: 'ring-line',
  },
  warn: {
    word: 'atenção',
    text: 'text-warning',
    band: 'bg-warning-soft',
    fuse: 'bg-warning',
    ring: 'ring-warning/45',
  },
  late: {
    word: 'atrasado',
    text: 'text-danger',
    band: 'bg-danger-soft',
    fuse: 'fuse-late',
    ring: 'ring-danger',
  },
  scheduled: {
    word: 'encomenda',
    text: 'text-info',
    band: 'bg-info-soft',
    fuse: 'bg-info',
    ring: 'ring-line',
  },
};

export interface TicketProps {
  ticket: KitchenTicket;
  station: StationPick;
  stationName: (id: string | null) => string;
  /** 1–9: the bump-bar key that selects it */
  slot?: number | undefined;
  selected?: boolean | undefined;
  /** the keyboard's item cursor (index among this station's items) */
  cursor?: number | null | undefined;
  /** just landed: drops in with a lime edge */
  arriving?: boolean | undefined;
  /** "tudo junto" picked a dish: the tickets without it step back */
  focusKey?: string | null | undefined;
  /** bumped, waiting out its undo window until this instant */
  bumpAt?: number | undefined;
  now?: number | undefined;
  onToggle: (t: KitchenTicket, items: KitchenItem[], done: boolean) => void;
  onAction: (t: KitchenTicket) => void;
  onMore: (t: KitchenTicket) => void;
  onUndo: (t: KitchenTicket) => void;
  onSelect?: ((t: KitchenTicket) => void) | undefined;
}

/**
 * A kitchen ticket: the number big enough to read across the pass, a clock that burns down a fuse
 * against the prep time, every item a big tap target (made / not made), what to leave out in red,
 * allergies called out, and one button for the next step.
 */
export const Ticket = memo(function Ticket(p: TicketProps) {
  const { ticket: t, station } = p;
  const now = useSecond(p.now);
  const time = timing(t, now);
  const tone = URGENCY[time.urgency];
  const { mine, others } = itemsFor(t, station);
  const own = progress(mine);
  const action = actionFor(t, station);
  const allergy = mentionsAllergy(t.notes);
  const dimmed = !!p.focusKey && !t.items.some((i) => itemMatches(i, p.focusKey!));
  const waitingOn = [...new Set(others.filter((i) => !i.doneAt).map((i) => i.stationId))];
  const ModeIcon = t.mode === 'delivery' ? Moped : Bag;
  const clockFace = time.urgency === 'scheduled' ? 'hoje' : stopwatch(time.elapsed);
  const sub =
    time.urgency === 'scheduled'
      ? `preparo de ${minutes(t.prepMinutes * 60_000)}`
      : time.left < 0
        ? `atrasado ${minutes(-time.left)}`
        : `faltam ${minutes(time.left)}`;

  return (
    <article
      aria-label={`Pedido ${t.number}${t.name ? `, ${t.name}` : ''}: ${own.done} de ${own.total} itens feitos, ${tone.word}${t.rush ? ', prioridade' : ''}`}
      data-ticket={t.id}
      onPointerDown={() => p.onSelect?.(t)}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg bg-surface ring-1 transition-[opacity,scale] duration-200 depth-1',
        tone.ring,
        time.urgency === 'late' && 'ring-2',
        p.selected && 'ring-[3px] ring-spark',
        p.arriving && 'animate-drop-in',
        dimmed && 'scale-[0.98] opacity-35',
      )}
    >
      {/* the fuse: how much of the prep time is gone */}
      <div className="h-2 shrink-0 bg-sunken" aria-hidden>
        <div
          className={cn('h-full transition-[width] duration-1000 ease-linear', tone.fuse)}
          style={{ width: `${Math.min(100, Math.max(3, time.ratio * 100))}%` }}
        />
      </div>

      <header className={cn('px-4 pb-3 pt-3', tone.band)}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {p.slot ? (
                <kbd
                  className="t-caption grid size-6 shrink-0 place-items-center rounded-[6px] bg-ink font-bold text-surface"
                  aria-hidden
                >
                  {p.slot}
                </kbd>
              ) : null}
              <h3 className="tnum font-display text-[2rem] font-semibold leading-none tracking-tight">
                #{t.number}
              </h3>
              {t.rush ? (
                <Fire weight="fill" className="size-6 shrink-0 text-danger" aria-hidden />
              ) : null}
            </div>
            <p className="t-label mt-1.5 flex min-w-0 items-center gap-1.5 text-muted">
              <ModeIcon weight="bold" className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {t.mode === 'delivery' ? 'Entrega' : 'Retirada'}
                {t.name ? ` · ${t.name}` : ''}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                'tnum font-display text-[1.75rem] font-semibold leading-none',
                tone.text,
              )}
            >
              {clockFace}
            </p>
            <p className={cn('t-caption mt-1.5 font-semibold', tone.text)}>{sub}</p>
          </div>
        </div>

        {t.rush || allergy || t.scheduledFor || p.arriving || t.state === 'confirmed' ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {p.arriving ? <Tag className="bg-spark text-on-spark">novo</Tag> : null}
            {t.rush ? (
              <Tag className="bg-danger text-surface">
                <Fire weight="fill" aria-hidden /> prioridade
              </Tag>
            ) : null}
            {allergy ? (
              <Tag className="bg-surface text-danger ring-2 ring-danger">
                <WarningOctagon weight="fill" aria-hidden /> alergia
              </Tag>
            ) : null}
            {t.scheduledFor ? (
              <Tag className="bg-info-soft text-info">
                <CalendarBlank weight="bold" aria-hidden /> encomenda
              </Tag>
            ) : null}
            {t.state === 'confirmed' ? (
              <Tag className="bg-[var(--st-aceito)] text-[var(--st-aceito-ink)]">na fila</Tag>
            ) : null}
          </div>
        ) : null}
      </header>

      <ul className="flex-1 divide-y divide-line border-t border-line">
        {mine.map((i, k) => (
          <ItemRow
            key={i.id}
            item={i}
            cursor={p.cursor === k}
            focus={!!p.focusKey && itemMatches(i, p.focusKey)}
            onToggle={() => p.onToggle(t, [i], !i.doneAt)}
          />
        ))}
      </ul>

      {others.length ? (
        <p className="t-caption border-t border-dashed border-line px-4 py-2 text-muted">
          +{others.length} {others.length === 1 ? 'item' : 'itens'} em{' '}
          {[...new Set(others.map((i) => p.stationName(i.stationId)))].join(', ')}
          {' · '}
          {progress(others).done === others.length
            ? 'tudo feito'
            : `${progress(others).done} ${progress(others).done === 1 ? 'feito' : 'feitos'}`}
        </p>
      ) : null}

      {t.notes ? (
        <div
          className={cn(
            'mx-3 mb-1 mt-2 flex gap-2 rounded-md px-3 py-2.5',
            allergy ? 'bg-danger-soft ring-1 ring-danger' : 'bg-warning-soft',
          )}
        >
          <NotePencil
            weight="bold"
            className={cn('mt-0.5 size-5 shrink-0', allergy ? 'text-danger' : 'text-warning')}
            aria-hidden
          />
          <p className="t-body min-w-0 whitespace-pre-line break-words font-semibold">
            {allergySegments(t.notes).map((s, k) =>
              s.hit ? (
                <mark key={k} className="rounded bg-danger px-1 text-surface">
                  {s.text}
                </mark>
              ) : (
                <span key={k}>{s.text}</span>
              ),
            )}
          </p>
        </div>
      ) : null}

      <footer className="mt-auto flex items-center gap-2 p-3">
        {own.total > 1 && own.done ? (
          <span className="tnum t-label shrink-0 px-1 text-muted" aria-hidden>
            {own.done}/{own.total}
          </span>
        ) : null}
        {action ? (
          <button
            type="button"
            onClick={() => p.onAction(t)}
            className={cn(
              'press t-label flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[1.0625rem] font-bold',
              action.kind === 'start'
                ? 'bg-[var(--st-preparando)] text-[var(--st-preparando-ink)]'
                : action.allDone
                  ? 'animate-beckon bg-spark text-on-spark'
                  : // before every item is ticked, "pronto" is there but quiet
                    'bg-sunken text-ink ring-1 ring-line-strong hover:bg-hover',
            )}
          >
            {action.kind === 'start' ? (
              <CookingPot weight="bold" className="size-6" aria-hidden />
            ) : (
              <Check weight="bold" className="size-6" aria-hidden />
            )}
            <span className="truncate">{action.label}</span>
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`mais opções do pedido ${t.number}`}
          title="mais opções"
          onClick={() => p.onMore(t)}
          className="press grid size-14 shrink-0 place-items-center rounded-md text-muted ring-1 ring-line hover:bg-hover"
        >
          <DotsThree weight="bold" className="size-7" />
        </button>
      </footer>
      {station !== 'all' && waitingOn.length && !mine.some((i) => !i.doneAt) ? (
        <p className="t-caption -mt-1 px-4 pb-3 text-muted">
          Sua parte está pronta. Falta: {waitingOn.map((s) => p.stationName(s)).join(', ')}.
        </p>
      ) : null}

      {p.bumpAt ? <BumpVeil ticket={t} until={p.bumpAt} now={now} onUndo={p.onUndo} /> : null}
    </article>
  );
});

function Tag({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-bold [&_svg]:size-4',
        className,
      )}
    >
      {children}
    </span>
  );
}

function ItemRow({
  item: i,
  cursor,
  focus,
  onToggle,
}: {
  item: KitchenItem;
  cursor: boolean;
  focus: boolean;
  onToggle: () => void;
}) {
  const done = !!i.doneAt;
  return (
    <li>
      <button
        type="button"
        aria-pressed={done}
        onClick={onToggle}
        className={cn(
          'press-row flex min-h-14 w-full items-start gap-3 px-4 py-2.5 text-left',
          cursor && 'ring-[3px] ring-inset ring-spark',
          focus && !done && 'bg-spark-soft',
        )}
      >
        <span
          className={cn(
            'tnum grid h-10 min-w-10 shrink-0 place-items-center rounded-sm px-1.5 font-display text-[1.25rem] font-bold',
            done
              ? 'bg-success-soft text-success'
              : i.qty > 1
                ? 'bg-ink text-surface'
                : 'bg-sunken text-ink',
          )}
        >
          {done ? <Check weight="bold" className="size-6" aria-label="feito" /> : `${i.qty}×`}
        </span>
        <span className="min-w-0 flex-1 pt-1">
          <span
            className={cn(
              'block text-[1.125rem] font-bold leading-snug',
              done && 'text-muted line-through decoration-2',
            )}
          >
            {done && i.qty > 1 ? `${i.qty}× ` : ''}
            {i.name}
          </span>
          {i.modifiers.map((m, k) =>
            isWithout(m.name) ? (
              <span
                key={k}
                className={cn(
                  't-body mt-0.5 flex items-center gap-1 font-bold',
                  done ? 'text-muted' : 'text-danger',
                )}
              >
                <Prohibit weight="bold" className="size-4 shrink-0" aria-hidden />
                {modifierLabel(m)}
              </span>
            ) : (
              <span key={k} className="t-body mt-0.5 block text-muted">
                + {modifierLabel(m)}
              </span>
            ),
          )}
          {i.combo.map((c, k) => (
            <span key={k} className="t-body mt-0.5 block text-muted">
              <span className="font-semibold text-ink">{c.slotName}:</span>{' '}
              {c.qty > 1 ? `${c.qty}× ` : ''}
              {c.name}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}

/** "Pronto" waits a few seconds on the ticket itself, with the undo where the finger is. */
function BumpVeil({
  ticket,
  until,
  now,
  onUndo,
}: {
  ticket: KitchenTicket;
  until: number;
  now: number;
  onUndo: (t: KitchenTicket) => void;
}) {
  const left = Math.max(0, until - now);
  // set once: changing a running animation's duration makes it jump
  const [drain] = useState(() => Math.max(0, until - Date.now()));
  return (
    <div className="animate-fade-up absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-spark p-4 text-on-spark">
      <span className="grid size-16 place-items-center rounded-full bg-on-spark text-spark">
        <Check weight="bold" className="size-9" aria-hidden />
      </span>
      <p className="tnum font-display text-[2rem] font-semibold leading-none">
        #{ticket.number} pronto
      </p>
      <button
        type="button"
        onClick={() => onUndo(ticket)}
        className="press t-label inline-flex h-14 items-center gap-2 rounded-md bg-surface px-6 text-[1.0625rem] font-bold text-ink depth-2"
      >
        <ArrowCounterClockwise weight="bold" className="size-6" aria-hidden />
        desfazer
        <span className="tnum text-muted">{Math.ceil(left / 1000)}</span>
      </button>
      <div className="absolute inset-x-0 bottom-0 h-2 bg-on-spark/15" aria-hidden>
        <div
          className="animate-drain h-full bg-on-spark"
          style={{ animationDuration: `${drain}ms` }}
        />
      </div>
    </div>
  );
}
