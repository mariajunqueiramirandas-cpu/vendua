import { Bike, Clock, Instagram, MapPin, MessageCircle, ShoppingBag, Store } from 'lucide-react';
import {
  BlockArea,
  Img,
  defineSection,
  formatTime,
  formatWhen,
  image,
  text,
  useDeliverySummary,
  useLinks,
  useMoney,
  useStore,
  useStoreHours,
  useStoreStatus,
  type SectionProps,
  type StatusHint,
} from '@vendua/kernel';
import { DishGlyph, type Dish } from './_shared/DishArt.tsx';

// The store's front door, the way a delivery app opens a restaurant: cover, logo, live status,
// and the three facts people decide on (how long, how much to deliver, the minimum).
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
  },
  areas: { aside: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

const COVER_DISHES: Dish[] = ['flan', 'cup', 'bowl', 'pop', 'pizza', 'burger', 'box', 'cloche'];

type Settings = SectionProps<typeof schema>['settings'];

// Core's moment in the menu's words: only when Core served one (a manual close has none)
function hintText(hint: StatusHint | null, timeZone: string, s: Settings): string {
  if (!hint?.at) return '';
  if (hint.kind === 'open-until') return `${s.untilLabel} ${formatTime(hint.at, timeZone)}`;
  if (hint.kind === 'opens') return `${s.opensLabel} ${formatWhen(hint.at, timeZone)}`;
  if (hint.kind === 'paused-until') return `${s.untilLabel} ${formatWhen(hint.at, timeZone)}`;
  return '';
}

export default function MenuHero({ settings: s }: SectionProps<typeof schema>) {
  const { store, loading } = useStore();
  const { status, hint, timeZone } = useStoreStatus();
  const { rows } = useStoreHours();
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

  return (
    <section className="hero" aria-busy={loading && !store ? true : undefined}>
      <div className="hero-cover" data-photo={s.cover ? true : undefined}>
        {s.cover ? (
          <Img src={s.cover} alt="" width={1120} height={208} sizes="100vw" priority />
        ) : (
          <span className="hero-doodles" aria-hidden="true">
            {COVER_DISHES.map((d) => (
              <DishGlyph key={d} dish={d} spark={false} />
            ))}
          </span>
        )}
      </div>

      <div className="hero-card">
        <div className="hero-top">
          <span className="hero-avatar" aria-hidden="true">
            {store?.logoUrl ? (
              <Img
                src={store.logoUrl}
                alt=""
                width={160}
                height={160}
                sizes="(min-width: 768px) 104px, 76px"
                priority
              />
            ) : (
              <span>{store?.name.trim().charAt(0) ?? ''}</span>
            )}
          </span>
          <div className="hero-id">
            <h1 className="hero-name">{store?.name ?? ' '}</h1>
            {store?.tagline ? <p className="hero-tagline">{store.tagline}</p> : null}
            {status ? (
              <p className="hero-status" data-status={status} role="status">
                <span className="hero-dot" aria-hidden="true" />
                <strong>{statusLabel}</strong>
                {when ? <span> · {when}</span> : null}
              </p>
            ) : null}
          </div>
        </div>

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
                    ? ` · ${s.freeOverLabel} ${money(delivery.freeOverCents)}`
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

        {store && (store.address || hasHours || contacts.whatsapp || contacts.instagram) ? (
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
                    <div key={r.days.join()}>
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
    </section>
  );
}
