import { Bag, CalendarBlank, DotsThree, Moped, NotePencil, Timer } from '@phosphor-icons/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Order } from '../lib/api.ts';
import { dateShort, minutesSince, money } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { cn } from './cn.ts';
import { PaymentChip } from './PaymentChip.tsx';
import { nextStep, STATE_META, StateChip } from './StateChip.tsx';

const COMMIT = 0.4;

/**
 * An order at a glance (§6.3): number in display type, first name, items, total,
 * delivery or pickup, age (amber past the store's accept target). Swipe right
 * advances; swipe left opens more. The big button does the same for everyone.
 */
export function OrderCard({
  order,
  now,
  acceptTarget,
  onAdvance,
  onMore,
  onOpen,
  arriving,
  selected,
  compact,
  prepDefault = 30,
}: {
  order: Order;
  now: number;
  acceptTarget: number;
  onAdvance: (o: Order, prepMinutes?: number) => void;
  onMore: (o: Order) => void;
  /** the store's usual prep time — preselected on "aceitar" */
  prepDefault?: number;
  onOpen: (o: Order) => void;
  arriving?: boolean | undefined;
  selected?: boolean | undefined;
  compact?: boolean | undefined;
}) {
  const [dx, setDx] = useState(0);
  const chips = [...new Set([15, 30, 45, prepDefault])].sort((a, b) => a - b).slice(0, 4);
  const [prep, setPrep] = useState(prepDefault);
  const start = useRef<{ x: number; y: number; w: number; locked: 'x' | 'y' | null } | null>(null);
  const passed = useRef(false);
  const next = nextStep(order.state, order.delivery.mode);
  const age = minutesSince(order.placedAt, now);
  const late = order.state === 'placed' && age >= acceptTarget;
  const first = order.customer.name.trim().split(/\s+/)[0];
  const items = order.items.map((i) => `${i.qty}× ${i.name}`);
  const nextMeta = next ? STATE_META[next.to] : null;

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      w: (e.currentTarget as HTMLElement).offsetWidth,
      locked: null,
    };
    passed.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.locked === 'x') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (s.locked !== 'x') return;
    const limited = !next && mx > 0 ? mx * 0.15 : mx;
    setDx(limited);
    const over = Math.abs(limited) / s.w > COMMIT;
    if (over !== passed.current) {
      passed.current = over;
      if (over) haptic.tick();
    }
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.locked !== 'x') return setDx(0);
    const frac = dx / s.w;
    setDx(0);
    if (frac > COMMIT && next) onAdvance(order, order.state === 'placed' ? prep : undefined);
    else if (frac < -COMMIT) onMore(order);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'a' || e.key === 'A') && order.state === 'placed') onAdvance(order, prep);
    else if (e.key === 'ArrowRight' && next)
      onAdvance(order, order.state === 'placed' ? prep : undefined);
    else if (e.key === 'Enter') onOpen(order);
  };

  return (
    <article
      aria-label={`pedido ${order.number}, ${first}, ${money(order.totalCents)}, ${STATE_META[order.state].label}`}
      tabIndex={0}
      onKeyDown={onKey}
      className={cn(
        'relative isolate overflow-hidden rounded-lg outline-offset-4',
        arriving && 'animate-drop-in',
      )}
    >
      {/* what the swipe reveals: the next state's colour and icon under the finger */}
      {dx !== 0 ? (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 flex items-center justify-between px-6"
          style={{
            background: dx > 0 && nextMeta ? `var(--st-${nextMeta.var})` : 'var(--surface-sunken)',
            color: dx > 0 && nextMeta ? `var(--st-${nextMeta.var}-ink)` : 'var(--ink-muted)',
          }}
        >
          <span className="t-label flex items-center gap-2">
            {nextMeta ? <nextMeta.Icon weight="bold" className="size-6" /> : null}
            {next?.label}
          </span>
          <span className="t-label flex items-center gap-2">
            mais <DotsThree weight="bold" className="size-6" />
          </span>
        </div>
      ) : null}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        className={cn(
          'rounded-lg bg-surface p-4 depth-1 transition-[transform,box-shadow] duration-(--duration-smooth) ease-(--ease-soft)',
          dx !== 0 && 'transition-none',
          // inset: the article clips to its radius for the swipe reveal
          selected && 'ring-2 ring-inset ring-primary',
          late && 'ring-2 ring-inset ring-warning',
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(order)}
          className="block w-full text-left"
          aria-label={`abrir pedido ${order.number}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="t-display tnum leading-none">#{order.number}</p>
              <p className="t-body-lg mt-1.5 truncate font-semibold">{first}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StateChip state={order.state} mode={order.delivery.mode} />
              <span
                className={cn(
                  't-caption tnum inline-flex items-center gap-1',
                  late ? 'font-bold text-warning' : 'text-muted',
                )}
              >
                <Timer className="size-4" aria-hidden />
                {age < 1
                  ? 'agora'
                  : age < 60
                    ? `${age} min`
                    : `${Math.floor(age / 60)} h ${age % 60} min`}
              </span>
            </div>
          </div>
          {!compact ? (
            <ul className="t-body mt-3 space-y-0.5">
              {items.slice(0, 4).map((t, i) => (
                <li key={i} className="truncate">
                  {t}
                </li>
              ))}
              {items.length > 4 ? (
                <li className="text-muted">
                  + {items.length - 4} {items.length === 5 ? 'item' : 'itens'}
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="t-body mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="tnum font-semibold text-ink">{money(order.totalCents)}</span>
            <PaymentChip payment={order.payment} quiet className="h-6 px-2" />
            <span className="inline-flex items-center gap-1">
              {order.delivery.mode === 'delivery' ? (
                <Moped className="size-4" />
              ) : (
                <Bag className="size-4" />
              )}
              {order.delivery.mode === 'delivery'
                ? (order.delivery.neighborhood ?? 'entrega')
                : 'retirada'}
            </span>
            {order.scheduledFor ? (
              <span className="inline-flex items-center gap-1">
                <CalendarBlank className="size-4" /> {dateShort(order.scheduledFor)}
              </span>
            ) : null}
            {order.notes ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <NotePencil className="size-4" /> obs.
              </span>
            ) : null}
          </div>
        </button>
        {order.state === 'placed' ? (
          <div className="mt-4" role="radiogroup" aria-label="tempo de preparo">
            <p className="t-caption mb-1.5 text-muted">Fica pronto em (minutos)</p>
            <div className="grid grid-cols-4 gap-1.5">
              {chips.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={prep === m}
                  onClick={() => {
                    haptic.tick();
                    setPrep(m);
                  }}
                  className={cn(
                    't-label tnum min-h-11 min-w-0 rounded-full ring-1 transition-colors',
                    prep === m
                      ? 'bg-spark text-on-spark ring-spark'
                      : 'ring-line-strong hover:bg-hover',
                  )}
                >
                  {m}
                  <span className="sr-only"> minutos</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {next ? (
          <button
            type="button"
            onClick={() => onAdvance(order, order.state === 'placed' ? prep : undefined)}
            className={cn(
              't-label mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-md transition-transform active:scale-[0.98]',
              order.state === 'placed'
                ? 'bg-primary text-on-primary depth-1'
                : 'bg-sunken text-ink hover:bg-press',
            )}
          >
            {nextMeta ? <nextMeta.Icon weight="bold" className="size-5" /> : null}
            {next.label}
            {order.state === 'placed' ? (
              <span className="tnum opacity-80">· {prep} min</span>
            ) : null}
          </button>
        ) : null}
      </div>
    </article>
  );
}
