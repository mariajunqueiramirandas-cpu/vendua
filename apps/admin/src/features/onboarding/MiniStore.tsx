import {
  LockSimple,
  Motorcycle,
  ShoppingBag,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { localNow, todayHours } from '@vendua/kernel/rules';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, money } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { DishGlyph, DishPrint, dishOf, type Dish } from './dishes.tsx';
import type { Spot } from './flow.ts';
import type { WeekModel } from '../../ui/TimeRangeField.tsx';
import { fromWeek } from '../../ui/TimeRangeField.tsx';

export interface Draft {
  name: string;
  tagline: string;
  logoUrl: string | null;
  week: WeekModel;
  pickup: boolean;
  delivery: boolean;
  /** the store's main colour (appearance tokens), null until chosen */
  accent: string | null;
  onAccent: string | null;
}

type Item = { id: string; name: string; priceCents: number; imageUrl: string | null };

// imitates the storefront's own front (storefronts/_template menu-hero), so it keeps the
// storefront's colours rather than the admin's theme (the README's one exception to tokens)
const INK = '#123c32';
const PAPER = '#f7f4ea';
// the part of the store the open question changes: a paper gap, a lime ring, a forest hairline
const HALO = 'shadow-[0_0_0_2px_#f7f4ea,0_0_0_5px_#d9f875,0_0_0_6px_rgb(18_60_50/0.35)]';
const halo = (on: boolean, round = 'rounded-[8px]') =>
  cn('transition-shadow duration-(--duration-smooth)', on && [HALO, round]);

const MIXED: Dish[] = ['flan', 'bowl', 'burger', 'cup'];

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * The store assembling itself, as the customer will see it: name → the sign, logo → the app
 * icon, colour → the cover and the bag, phrase and hours → the lines under the name, products →
 * the menu. Signup shows it too, before the store exists, so the same phone carries the journey.
 */
export function MiniStore({
  draft,
  products,
  whatsapp,
  timeZone,
  specialDays,
  url,
  examples,
  spot = null,
  className,
}: {
  draft: Draft;
  products: Item[];
  whatsapp: boolean;
  /** the store's: "today" is its day, not the phone's */
  timeZone: string;
  specialDays: SpecialDay[];
  /** shown in the address bar, without https:// */
  url?: string | undefined;
  /** sketched dishes until real ones exist (from what the store sells) */
  examples?: readonly string[] | undefined;
  /** the part the open question changes */
  spot?: Spot | null | undefined;
  /** the phone's width (it keeps its proportions) */
  className?: string | undefined;
}) {
  const anyHours = draft.week.some((d) => d.length);
  const today = anyHours
    ? todayHours({ timezone: timeZone, windows: fromWeek(draft.week), specialDays }).windows
    : [];
  const now = localNow(timeZone).minutes;
  const openNow = today.find((w) => {
    const o = minutes(w.open);
    const c = minutes(w.close);
    return now >= o && (c <= o || now < c);
  });
  const status = !anyHours
    ? null
    : openNow
      ? { open: true, label: 'Aberto agora', when: `até ${hhmm(openNow.close)}` }
      : today.length
        ? {
            open: false,
            label: 'Hoje',
            when: today.map((h) => `${hhmm(h.open)}–${hhmm(h.close)}`).join(', '),
          }
        : { open: false, label: 'Fechado hoje', when: '' };
  const accent = draft.accent ?? INK;
  const onAccent = draft.onAccent ?? PAPER;
  const name = draft.name.trim();
  // four sketched dishes from what the store sells (a store of unknown kind gets a mixed menu)
  const ex = examples?.length ? examples : [''];
  const ghosts = Array.from({ length: 4 }, (_, i) => {
    const dish = dishOf(ex[i % ex.length]!);
    return { label: ex[i] ?? '', dish: dish === 'cloche' ? MIXED[i]! : dish };
  });
  return (
    <div
      className={cn(
        'mx-auto rounded-[46px] bg-[#0b120f] p-[9px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_30px_60px_-20px_rgb(0_0_0/0.55)]',
        className ?? 'w-full max-w-[300px]',
      )}
    >
      <div
        className="relative flex aspect-[9/18.5] flex-col overflow-hidden rounded-[37px]"
        style={{ background: PAPER, color: INK }}
      >
        {/* the address bar: the store's own link, the first thing a customer sees */}
        <div className="relative z-10 flex items-center justify-center px-5 pb-2 pt-3">
          <span
            aria-hidden
            className="absolute left-1/2 top-2 h-[18px] w-16 -translate-x-1/2 rounded-full bg-[#0b120f]"
          />
          <p className="tnum mt-6 flex max-w-full min-w-0 items-center gap-1 truncate rounded-full bg-[#123c32]/[0.06] px-3 py-1 text-[10.5px] text-[#4f6a5e]">
            <LockSimple weight="bold" className="size-2.5 shrink-0" aria-hidden />
            <span className="truncate">{url ?? 'sua-loja.vendua.com.br'}</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* the cover: the store's colour with its dishes printed on it */}
          <div
            className={cn(
              'relative h-[78px] overflow-hidden transition-[background-color,box-shadow] duration-(--duration-smooth)',
              spot === 'color' && 'shadow-[inset_0_0_0_3px_#d9f875]',
            )}
            style={{
              background: `radial-gradient(90% 140% at 92% -10%, color-mix(in srgb, ${onAccent} 14%, transparent), transparent 62%), ${accent}`,
              color: `color-mix(in srgb, ${onAccent} 18%, transparent)`,
            }}
          >
            <DishPrint scale={0.42} />
          </div>

          <div className="px-4">
            {/* the logo as an app icon cut out of the cover's edge */}
            <span
              className={cn(
                'relative -mt-7 grid size-14 place-items-center overflow-hidden rounded-[17px] bg-[#d9f875] font-display text-[26px] font-semibold leading-none tracking-[-0.04em] text-[#123c32] shadow-[0_0_0_3px_#f7f4ea,0_8px_18px_-6px_rgb(18_60_50/0.35)] transition-shadow duration-(--duration-smooth)',
                spot === 'logo' &&
                  'shadow-[0_0_0_3px_#f7f4ea,0_0_0_6px_#d9f875,0_0_0_7px_rgb(18_60_50/0.35)]',
              )}
            >
              {draft.logoUrl ? (
                <img src={draft.logoUrl} alt="" className="size-full bg-white object-cover" />
              ) : (
                (name.slice(0, 1) || '?').toUpperCase()
              )}
            </span>

            {/* the name set like the sign over the door */}
            <div className={cn('-mx-1 mt-2.5 px-1', halo(spot === 'name'))}>
              {name ? (
                <p
                  key={name}
                  className={cn(
                    'line-clamp-2 font-display font-semibold leading-[1.02] tracking-[-0.035em] [text-wrap:balance]',
                    name.length > 18 ? 'text-[19px]' : 'text-[23px]',
                  )}
                >
                  {name}
                </p>
              ) : (
                <span className="my-1 block h-5 w-2/3 rounded-md bg-[#123c32]/[0.07]" />
              )}
            </div>

            <div className={cn('-mx-1 mt-1 min-h-4 px-1', halo(spot === 'tagline'))}>
              {draft.tagline.trim() ? (
                <p
                  key={draft.tagline}
                  className="animate-fade-up line-clamp-2 text-[11.5px] leading-[15px] text-[#4f6a5e]"
                >
                  {draft.tagline}
                </p>
              ) : (
                <span className="mt-1.5 block h-2.5 w-4/5 rounded bg-[#123c32]/[0.06]" />
              )}
            </div>

            <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {status ? (
                <p
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full py-[3px] pl-2 pr-2.5 text-[10.5px]',
                    status.open ? 'bg-[#d9f875] text-[#123c32]' : 'bg-[#efe9d8] text-[#4f6a5e]',
                    halo(spot === 'hours', 'rounded-full'),
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 rounded-full',
                      status.open ? 'bg-[#123c32]' : 'bg-[#4f6a5e]/60',
                    )}
                  />
                  <strong className="font-semibold text-[#123c32]">{status.label}</strong>
                  {status.when ? <span className="tnum">{status.when}</span> : null}
                </p>
              ) : (
                <span
                  className={cn(
                    'block h-[22px] w-28 rounded-full bg-[#123c32]/[0.06]',
                    halo(spot === 'hours', 'rounded-full'),
                  )}
                />
              )}
              <p
                className={cn(
                  '-mx-1 inline-flex min-h-[18px] items-center gap-2 px-1 text-[10.5px] text-[#4f6a5e]',
                  halo(spot === 'how'),
                  spot === 'how' && !draft.pickup && !draft.delivery && 'w-24',
                )}
              >
                {draft.delivery ? (
                  <span className="inline-flex items-center gap-1">
                    <Motorcycle aria-hidden className="size-3" /> entrega
                  </span>
                ) : null}
                {draft.pickup ? (
                  <span className="inline-flex items-center gap-1">
                    <Storefront aria-hidden className="size-3" /> retirada
                  </span>
                ) : null}
              </p>
            </div>

            <p className="mt-4 font-display text-[13px] font-semibold tracking-[-0.01em]">
              Cardápio
            </p>
            <div
              className={cn(
                'mt-2 grid grid-cols-2 gap-2',
                halo(spot === 'products', 'rounded-[12px]'),
              )}
            >
              {products.length
                ? products.slice(0, 4).map((p) => (
                    <div
                      key={p.id}
                      className="animate-fade-up overflow-hidden rounded-[12px] bg-[#fffdf8] shadow-[0_1px_2px_rgb(18_60_50/0.08),0_4px_12px_rgb(18_60_50/0.06)]"
                    >
                      <div className="aspect-[4/3] bg-[#efe9d8]">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="grid size-full place-items-center">
                            <DishGlyph dish={dishOf(p.name)} className="h-4/5" />
                          </span>
                        )}
                      </div>
                      <div className="px-2 pb-2 pt-1.5">
                        <p className="truncate text-[10.5px] font-semibold leading-[14px]">
                          {p.name}
                        </p>
                        <p className="tnum text-[10.5px] leading-[14px] text-[#4f6a5e]">
                          {money(p.priceCents)}
                        </p>
                      </div>
                    </div>
                  ))
                : ghosts.map(({ label, dish }, i) => (
                    <div
                      key={i}
                      aria-hidden
                      className="overflow-hidden rounded-[12px] border border-dashed border-[#123c32]/20"
                    >
                      <div className="grid aspect-[4/3] place-items-center bg-[#efe9d8]/60">
                        <DishGlyph dish={dish} className="h-4/5 opacity-45" />
                      </div>
                      <p className="truncate px-2 py-1.5 text-[10.5px] leading-[14px] text-[#4f6a5e]">
                        {label || ' '}
                      </p>
                    </div>
                  ))}
            </div>
          </div>
        </div>

        {/* the WhatsApp button stores float over the menu */}
        {whatsapp || spot === 'whatsapp' ? (
          <span
            aria-hidden
            className={cn(
              'animate-pop absolute bottom-[60px] right-3.5 grid size-9 place-items-center rounded-full',
              whatsapp
                ? 'bg-[#1f7a4d] text-white shadow-[0_6px_14px_-4px_rgb(18_60_50/0.5)]'
                : 'border-[1.5px] border-dashed border-[#123c32]/35 bg-[#f7f4ea] text-[#123c32]/45',
              halo(spot === 'whatsapp', 'rounded-full'),
            )}
          >
            <WhatsappLogo weight="fill" className="size-5" />
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-[#f7f4ea] from-60% to-transparent px-3 pb-3 pt-5">
          <p
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-2.5 text-[11.5px] font-semibold transition-[background-color,box-shadow] duration-(--duration-smooth)',
              (spot === 'pay' || spot === 'color') && HALO,
            )}
            style={{ background: accent, color: onAccent }}
          >
            <ShoppingBag aria-hidden weight="bold" className="size-3.5" /> Ver sacola
          </p>
        </div>
      </div>
    </div>
  );
}
