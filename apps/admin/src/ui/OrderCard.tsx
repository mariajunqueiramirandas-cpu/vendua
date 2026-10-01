import { Bag, CalendarBlank, DotsThree, Moped, NotePencil, Timer } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Order } from '../lib/api.ts';
import { dateShort, minutesSince, money } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { reducedMotion, SPRING, springEasing } from '../lib/spring.ts';
import { cn } from './cn.ts';
import { PaymentChip } from './PaymentChip.tsx';
import { nextStep, STATE_META, StateChip } from './StateChip.tsx';

const COMMIT = 0.4;
/** px/ms: a flick this fast commits even short of COMMIT */
const FLING = 0.45;
const HOLD_MS = 450;
const EDGE = 24;

interface Gesture {
  x0: number;
  y0: number;
  w: number;
  dx: number;
  locked: 'x' | 'y' | null;
  over: boolean;
  id: number;
  trail: { t: number; x: number }[];
}

/**
 * A long press opens a sheet under the finger, outside the card: the lift must not tap it.
 * Swallows the one click that follows the next pointerup, anywhere in the document.
 */
function swallowLiftClick() {
  let t = window.setTimeout(off, 10_000);
  function kill(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    off();
  }
  function arm() {
    clearTimeout(t);
    t = window.setTimeout(off, 400);
  }
  function off() {
    clearTimeout(t);
    removeEventListener('click', kill, true);
    removeEventListener('pointerup', arm, true);
    removeEventListener('pointercancel', arm, true);
  }
  addEventListener('click', kill, true);
  addEventListener('pointerup', arm, true);
  addEventListener('pointercancel', arm, true);
}

/** release velocity over the last ~80 ms of the trail */
function velocity(trail: Gesture['trail'], now: number) {
  const last = trail[trail.length - 1]!;
  if (now - last.t > 80) return 0;
  const from = trail.find((p) => last.t - p.t <= 80) ?? last;
  const dt = last.t - from.t;
  return dt > 0 ? (last.x - from.x) / dt : 0;
}

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
  const chips = [...new Set([15, 30, 45, prepDefault])].sort((a, b) => a - b).slice(0, 4);
  const [prep, setPrep] = useState(prepDefault);
  // what the swipe reveals, and whether letting go now would commit
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const [over, setOver] = useState(false);
  const [pressing, setPressing] = useState(false);
  const surf = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const anim = useRef<Animation | null>(null);
  const hold = useRef<number>();
  const flown = useRef(false);
  const back = useRef<number>();
  // a long press or a swipe ends in a click on whatever is under the finger: swallow it
  const swallowUntil = useRef(0);
  const next = nextStep(order.state, order.delivery.mode);
  const age = minutesSince(order.placedAt, now);
  const late = order.state === 'placed' && age >= acceptTarget;
  const first = order.customer.name.trim().split(/\s+/)[0];
  const items = order.items.map((i) => `${i.qty}× ${i.name}`);
  const nextMeta = next ? STATE_META[next.to] : null;
  const advance = () => onAdvance(order, order.state === 'placed' ? prep : undefined);

  const setX = (x: number) => {
    surf.current!.style.transform = x ? `translateX(${x}px)` : '';
    setDir(x > 0 ? 1 : x < 0 ? -1 : 0);
  };
  const setOverOnce = (o: boolean) => {
    if (!g.current || g.current.over === o) return;
    g.current.over = o;
    setOver(o);
    if (o) haptic.tick();
  };
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = undefined;
    setPressing(false);
  };
  const fireHold = () => {
    cancelHold();
    g.current = null;
    swallowUntil.current = Infinity;
    swallowLiftClick();
    haptic.tick();
    onMore(order);
  };

  // cancel: spring home carrying the release velocity (px/ms, + = rightwards)
  const settle = (x: number, v: number) => {
    const el = surf.current;
    if (!el) return;
    el.style.transform = '';
    if (reducedMotion() || Math.abs(x) < 1) return setDir(0);
    const toward = (-v * Math.sign(x) * 1000) / Math.abs(x);
    const a = el.animate(
      [{ transform: `translateX(${x}px)` }, { transform: 'translateX(0px)' }],
      springEasing(SPRING, toward),
    );
    anim.current = a;
    a.onfinish = () => {
      if (anim.current !== a) return;
      anim.current = null;
      setDir(0);
    };
  };
  // commit: the card leaves in the direction of the fling, then the order moves on
  const flyOut = (x: number, w: number, v: number) => {
    const el = surf.current;
    if (!el || reducedMotion()) {
      if (el) el.style.transform = '';
      setDir(0);
      return advance();
    }
    const to = w * 1.1;
    const duration = Math.min(260, Math.max(140, (to - x) / Math.max(v, 1.2)));
    el.style.transform = '';
    const a = el.animate(
      [
        { transform: `translateX(${x}px)`, opacity: 1 },
        { transform: `translateX(${to}px)`, opacity: 0 },
      ],
      { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    anim.current = a;
    flown.current = true;
    a.onfinish = () => {
      advance();
      back.current = window.setTimeout(comeBack, 1200);
    };
  };
  // the order stayed on screen (same lane, or the move failed): bring the card back
  const comeBack = () => {
    if (!flown.current) return;
    flown.current = false;
    clearTimeout(back.current);
    anim.current?.cancel();
    anim.current = null;
    setDir(0);
    surf.current?.animate(
      [
        { opacity: 0, transform: 'scale(.96)' },
        { opacity: 1, transform: 'none' },
      ],
      springEasing(SPRING),
    );
  };
  useLayoutEffect(comeBack, [order.state]);
  useEffect(
    () => () => {
      clearTimeout(back.current);
      clearTimeout(hold.current);
    },
    [],
  );

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // the left edge belongs to the system back swipe
    if (e.clientX < EDGE || flown.current) return;
    swallowUntil.current = 0;
    const el = e.currentTarget as HTMLElement;
    // caught mid-settle: pick the card up where it is
    let base = 0;
    if (anim.current) {
      const at = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
      anim.current.cancel();
      anim.current = null;
      // nearly home (the spring's tail): a plain tap, not a catch
      base = Math.abs(at) < 6 ? 0 : at;
      setX(base);
    }
    g.current = {
      x0: e.clientX - base,
      y0: e.clientY,
      w: el.offsetWidth,
      dx: base,
      locked: base ? 'x' : null,
      over: false,
      id: e.pointerId,
      trail: [{ t: e.timeStamp, x: e.clientX }],
    };
    if (base) el.setPointerCapture(e.pointerId);
    else if (e.pointerType !== 'mouse') {
      if ((e.target as Element).closest('[data-open]')) setPressing(true);
      hold.current = window.setTimeout(fireHold, HOLD_MS);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const mx = e.clientX - s.x0;
    const my = e.clientY - s.y0;
    if (!s.locked) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      cancelHold();
      s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.locked === 'y') return void (g.current = null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    s.trail.push({ t: e.timeStamp, x: e.clientX });
    if (s.trail.length > 6) s.trail.shift();
    const x = !next && mx > 0 ? mx * 0.15 : mx;
    s.dx = x;
    setX(x);
    setOverOnce(Math.abs(x) / s.w > COMMIT && (x < 0 || !!next));
  };
  const onUp = (e: React.PointerEvent) => {
    cancelHold();
    const s = g.current;
    g.current = null;
    if (swallowUntil.current === Infinity) swallowUntil.current = e.timeStamp + 400;
    if (!s || s.locked !== 'x') return;
    swallowUntil.current = e.timeStamp + 400;
    setOver(false);
    const v = velocity(s.trail, e.timeStamp);
    const frac = s.dx / s.w;
    if (e.type === 'pointercancel') return settle(s.dx, v);
    const right = !!next && ((frac > COMMIT && v > -FLING) || (v > FLING && s.dx > 24));
    const left = !right && ((frac < -COMMIT && v < FLING) || (v < -FLING && s.dx < -24));
    if (right) return flyOut(s.dx, s.w, v);
    settle(s.dx, v);
    if (left) {
      haptic.commit();
      onMore(order);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'a' || e.key === 'A') && order.state === 'placed') onAdvance(order, prep);
    else if (e.key === 'ArrowRight' && next) advance();
    else if (e.key === 'ArrowLeft') onMore(order);
    else if (e.key === 'Enter') onOpen(order);
  };

  return (
    <article
      aria-label={`pedido ${order.number}, ${first}, ${money(order.totalCents)}, ${STATE_META[order.state].label}`}
      aria-keyshortcuts="Enter ArrowRight ArrowLeft"
      tabIndex={0}
      data-vt-src={`order:${order.id}`}
      onKeyDown={onKey}
      onClickCapture={(e) => {
        if (e.timeStamp < swallowUntil.current) {
          e.preventDefault();
          e.stopPropagation();
        }
        swallowUntil.current = 0;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // Android fires this on its own long-press timer; mouse and keyboard get "more" directly
        if (hold.current) fireHold();
        else if (swallowUntil.current < e.timeStamp) onMore(order);
      }}
      className={cn(
        'relative isolate select-none overflow-hidden rounded-lg outline-offset-4 [-webkit-touch-callout:none]',
        arriving && 'animate-drop-in',
      )}
    >
      {/* what the swipe reveals: the next state's colour and icon under the finger */}
      {dir !== 0 ? (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 flex items-center justify-between px-6"
          style={{
            background: dir > 0 && nextMeta ? `var(--st-${nextMeta.var})` : 'var(--surface-sunken)',
            color: dir > 0 && nextMeta ? `var(--st-${nextMeta.var}-ink)` : 'var(--ink-muted)',
          }}
        >
          <span
            className={cn(
              't-label flex origin-left items-center gap-2 transition-[scale] duration-(--duration-instant)',
              over && dir > 0 && 'scale-110',
            )}
          >
            {nextMeta ? <nextMeta.Icon weight="bold" className="size-6" /> : null}
            {next?.label}
          </span>
          <span
            className={cn(
              't-label flex origin-right items-center gap-2 transition-[scale] duration-(--duration-instant)',
              over && dir < 0 && 'scale-110',
            )}
          >
            mais <DotsThree weight="bold" className="size-6" />
          </span>
        </div>
      ) : null}
      <div
        ref={surf}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ touchAction: 'pan-y' }}
        className={cn(
          'rounded-lg bg-surface p-4 depth-1 transition-[scale,box-shadow] duration-(--duration-quick) ease-(--ease-soft)',
          pressing && 'scale-[.985]',
          // inset: the article clips to its radius for the swipe reveal
          selected && 'ring-2 ring-inset ring-primary',
          late && 'ring-2 ring-inset ring-warning',
        )}
      >
        <button
          type="button"
          data-open
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
                    'press t-label tnum min-h-11 min-w-0 rounded-full ring-1 transition-[color,background-color,box-shadow,scale]',
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
            onClick={advance}
            className={cn(
              'press t-label mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-md',
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
