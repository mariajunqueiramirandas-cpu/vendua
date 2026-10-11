import { useEffect, useMemo, useState } from 'react';
import { Bike, Clock, Instagram, MapPin, MessageCircle, ShoppingBag, Store } from 'lucide-react';
import {
  BlockArea,
  Img,
  defineSection,
  formatTime,
  formatWhen,
  image,
  localNow,
  text,
  todayHours,
  useDeliverySummary,
  useLinks,
  useMoney,
  useStore,
  useStoreHours,
  useStoreStatus,
  type SectionProps,
  type StatusHint,
} from '@vendua/kernel';
import { DishPrint } from './_shared/DishArt.tsx';

// The store's front door: its cover (a photo, or its dishes printed like wrapping paper), its
// app-icon logo, the name set like a shop sign, the live status, today's hours on a strip, and
// the three facts people decide on (how long, how much to deliver, the minimum).
export const schema = defineSection({
  type: 'store:menu-hero',
  settings: {
    cover: image(),
    openLabel: text({ max: 30, default: 'Aberto agora' }),
    closedLabel: text({ max: 30, default: 'Fechado agora' }),
    pausedLabel: text({ max: 60, default: 'Pausado por alguns minutos' }),
    untilLabel: text({ max: 20, default: 'até' }),
    opensLabel: text({ max: 20, default: 'abre' }),
    deliveryLabel: text({ max: 30, default: 'Entrega' }),
    fromLabel: text({ max: 20, default: 'a partir de' }),
    freeDeliveryLabel: text({ max: 30, default: 'Entrega grátis' }),
    someFreeLabel: text({ max: 60, default: 'Entrega grátis em algumas regiões' }),
    freeOverLabel: text({ max: 30, default: 'grátis acima de' }),
    pickupLabel: text({ max: 30, default: 'Retirada na loja' }),
    minOrderLabel: text({ max: 30, default: 'Pedido mínimo' }),
    moreLabel: text({ max: 40, default: 'Endereço e horários' }),
    everyDayLabel: text({ max: 30, default: 'todos os dias' }),
    closedDayLabel: text({ max: 30, default: 'fechado' }),
    todayLabel: text({ max: 30, default: 'Hoje' }),
  },
  areas: { aside: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

type Settings = SectionProps<typeof schema>['settings'];

// Core's moment in the menu's words: only when Core served one (a manual close has none)
function hintText(hint: StatusHint | null, timeZone: string, s: Settings): string {
  if (!hint?.at) return '';
  if (hint.kind === 'open-until') return `${s.untilLabel} ${formatTime(hint.at, timeZone)}`;
  if (hint.kind === 'opens') return `${s.opensLabel} ${formatWhen(hint.at, timeZone)}`;
  if (hint.kind === 'paused-until') return `${s.untilLabel} ${formatWhen(hint.at, timeZone)}`;
  return '';
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

// the store's wall clock, a minute at a time: the strip's needle walks with it, and "today"
// turns over at the store's midnight even in a tab left open overnight
const clockOf = (timeZone: string) => {
  const { date, weekday, minutes } = localNow(timeZone);
  return { date, weekday, minutes };
};

function useStoreClock(timeZone: string): { date: string; weekday: number; minutes: number } {
  const [now, setNow] = useState(() => clockOf(timeZone));
  useEffect(() => {
    setNow(clockOf(timeZone));
    const t = window.setInterval(() => setNow(clockOf(timeZone)), 60_000);
    return () => window.clearInterval(t);
  }, [timeZone]);
  return now;
}

// Core keeps a store open past midnight on yesterday's overnight window (Sun 18:00–02:00 is open
// on Monday at 00:30), and only Core knows whether yesterday was overridden: the profile lists
// special days from today on. So the tail comes from Core's answer, not from rebuilding
// yesterday: open now, none of today's windows running, until Core's closing time.
function spillOf(
  windows: { open: string; close: string }[],
  minutes: number,
  hint: StatusHint | null,
  timeZone: string,
): { open: string; close: string }[] {
  if (hint?.kind !== 'open-until' || !hint.at) return [];
  const running = windows.some((w) => {
    const o = minutesOf(w.open);
    const c = minutesOf(w.close);
    return minutes >= o && (c <= o || minutes < c);
  });
  return running ? [] : [{ open: '00:00', close: formatTime(hint.at, timeZone) }];
}

/**
 * Today on one line: the hours the store opens, drawn from 6h (earlier when it opens earlier) to
 * midnight, with a needle at the store's own clock. The words beside it say the same thing; the
 * strip is for the glance ("fecha daqui a pouco", "abre de novo à noite").
 */
function DayStrip({ windows, now }: { windows: { open: string; close: string }[]; now: number }) {
  const spans = windows.map((w) => {
    const open = minutesOf(w.open);
    const close = minutesOf(w.close);
    // a window past midnight ends at the end of today's strip
    return [open, close <= open ? 1440 : close] as const;
  });
  const start = Math.min(360, ...spans.map(([o]) => Math.floor(o / 60) * 60));
  const span = 1440 - start;
  const at = (m: number) => `${((Math.min(Math.max(m, start), 1440) - start) / span) * 100}%`;
  const ticks = [start, ...[360, 720, 1080].filter((t) => t - start >= 180), 1440];
  return (
    <div className="day" aria-hidden="true">
      <div className="day-track">
        {spans.map(([o, c]) => (
          <span
            key={o}
            className="day-span"
            style={{ left: at(o), right: `calc(100% - ${at(c)})` }}
          />
        ))}
        <span className="day-past" style={{ width: at(now) }} />
        {now >= start ? <span className="day-now" style={{ left: at(now) }} /> : null}
      </div>
      <div className="day-ticks">
        {ticks.map((t) => (
          <span key={t} style={{ left: at(t) }}>
            {(t / 60) % 24}h
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MenuHero({ settings: s }: SectionProps<typeof schema>) {
  const { store, loading } = useStore();
  const { status, hint, timeZone } = useStoreStatus();
  const { rows } = useStoreHours();
  const clock = useStoreClock(timeZone);
  const hours = store?.hours;
  // today by the store's own date, recomputed when it rolls over (special days included), with
  // last night's window while it still runs
  const today = useMemo(() => {
    if (!hours) return null;
    const t = todayHours(hours);
    const spill = status === 'open' ? spillOf(t.windows, clock.minutes, hint, timeZone) : [];
    return spill.length ? { ...t, windows: [...spill, ...t.windows], closed: false } : t;
  }, [hours, clock.date, clock.minutes, status, hint, timeZone]);
  const { delivery, pickup } = useDeliverySummary();
  const { contacts } = useLinks();
  const money = useMoney();

  const statusLabel =
    status === 'open' ? s.openLabel : status === 'paused' ? s.pausedLabel : s.closedLabel;
  const when = hintText(hint, timeZone, s);

  const fee = !delivery
    ? null
    : delivery.fee.form === 'free'
      ? s.freeDeliveryLabel
      : delivery.fee.form === 'some-free'
        ? s.someFreeLabel
        : delivery.fee.form === 'flat'
          ? `${s.deliveryLabel} ${money(delivery.fee.cents)}`
          : `${s.deliveryLabel} ${s.fromLabel} ${money(delivery.fee.cents)}`;
  // a pickup-only store's minimum is the store's own; with delivery it depends on the zone
  const minOrder = delivery
    ? { cents: delivery.minOrderCents, varies: delivery.minOrderVaries }
    : { cents: store?.minOrderCents ?? 0, varies: false };
  const hasHours = rows.some((r) => !r.closed);
  // a store open only on special days (a pop-up) still shows today's card
  const showToday = !!today && (hasHours || !today.closed);
  const hasMore =
    !!store && !!(store.address || hasHours || contacts.whatsapp || contacts.instagram);
  const name = store?.name.trim() ?? '';

  return (
    <section className="hero" aria-busy={loading && !store ? true : undefined}>
      <div className="hero-cover" data-photo={s.cover ? true : undefined}>
        {s.cover ? (
          <Img src={s.cover} alt="" width={1120} height={260} sizes="100vw" priority />
        ) : (
          <DishPrint />
        )}
      </div>

      <div className="hero-body" data-today={showToday || hasMore || undefined}>
        <div className="hero-id">
          <span className="hero-logo" aria-hidden="true">
            {store?.logoUrl ? (
              <Img
                src={store.logoUrl}
                alt=""
                width={240}
                height={240}
                sizes="(min-width: 768px) 120px, 88px"
                priority
              />
            ) : (
              <span>{name.charAt(0)}</span>
            )}
          </span>
          <h1 className="hero-name" data-long={name.length > 18 || undefined}>
            {store?.name ?? ' '}
          </h1>
          {store?.tagline ? <p className="hero-tagline">{store.tagline}</p> : null}
          {status ? (
            <p className="hero-status" data-status={status} role="status">
              <span className="hero-dot" aria-hidden="true" />
              <strong>{statusLabel}</strong>
              {when ? <span className="hero-when">{when}</span> : null}
            </p>
          ) : null}

          {store ? (
            <ul className="hero-facts">
              {delivery ? (
                <li>
                  <Clock size={18} aria-hidden="true" />
                  <span className="tnum">
                    {delivery.etaMin === delivery.etaMax
                      ? delivery.etaMin
                      : `${delivery.etaMin}–${delivery.etaMax}`}{' '}
                    min
                  </span>
                </li>
              ) : pickup ? (
                <li>
                  <Clock size={18} aria-hidden="true" />
                  <span className="tnum">~{pickup.prepMinutes} min</span>
                </li>
              ) : null}
              {delivery && fee ? (
                <li>
                  <Bike size={18} aria-hidden="true" />
                  <span>
                    {fee}
                    {delivery.freeOverCents !== null
                      ? `, ${s.freeOverLabel} ${money(delivery.freeOverCents)}`
                      : ''}
                  </span>
                </li>
              ) : null}
              {pickup ? (
                <li>
                  <Store size={18} aria-hidden="true" />
                  <span>{s.pickupLabel}</span>
                </li>
              ) : null}
              {minOrder.cents > 0 ? (
                <li>
                  <ShoppingBag size={18} aria-hidden="true" />
                  <span>
                    {s.minOrderLabel} {minOrder.varies ? `${s.fromLabel} ` : ''}
                    {money(minOrder.cents)}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}

          <BlockArea name="aside" className="hero-aside" />
        </div>

        {showToday || hasMore ? (
          <div className="hero-today">
            {today && showToday ? (
              <div className="hero-today-head">
                <p className="hero-today-line">
                  <span>{today.special?.label || s.todayLabel}</span>
                  <strong className="tnum">
                    {today.closed
                      ? s.closedDayLabel
                      : today.windows.map((w) => `${w.open}–${w.close}`).join(', ')}
                  </strong>
                </p>
                {!today.closed ? <DayStrip windows={today.windows} now={clock.minutes} /> : null}
              </div>
            ) : null}

            {hasMore ? (
              <details className="hero-more">
                <summary>{s.moreLabel}</summary>
                <div className="hero-more-body">
                  {store.address ? (
                    <p className="hero-line">
                      <MapPin size={18} aria-hidden="true" />
                      <span>{store.address}</span>
                    </p>
                  ) : null}
                  {hasHours ? (
                    <dl className="hero-hours">
                      {rows.map((r) => (
                        <div
                          key={r.days.join()}
                          data-today={r.days.includes(clock.weekday) || undefined}
                        >
                          <dt>{r.days.length === 7 ? s.everyDayLabel : r.label}</dt>
                          <dd className="tnum">
                            {r.closed
                              ? s.closedDayLabel
                              : r.windows.map((w) => `${w.open}–${w.close}`).join(', ')}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <p className="hero-contacts">
                    {contacts.whatsapp ? (
                      <a href={contacts.whatsapp.href} target="_blank" rel="noopener noreferrer">
                        <MessageCircle size={18} aria-hidden="true" />
                        WhatsApp
                      </a>
                    ) : null}
                    {contacts.instagram ? (
                      <a href={contacts.instagram.href} target="_blank" rel="noopener noreferrer">
                        <Instagram size={18} aria-hidden="true" />@{contacts.instagram.handle}
                      </a>
                    ) : null}
                  </p>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
