import { localNow, todayHours } from '@vendua/kernel/rules';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, money, WEEKDAYS } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { fromWeek, type WeekModel } from '../../ui/TimeRangeField.tsx';
import type { Spot } from './flow.ts';

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

// imitates a storefront, so it keeps its own colours (the README's one exception to tokens)
const INK = '#123c32';
// the part of the store the open question changes: a cream gap, a lime ring, a forest hairline
const HALO = 'shadow-[0_0_0_3px_#fcfbf8,0_0_0_6px_#d9f875,0_0_0_7px_rgb(18_60_50/0.3)]';
const halo = (on: boolean, round = 'rounded-[10px]') =>
  cn('transition-shadow duration-(--duration-smooth)', on && [HALO, round]);

/**
 * The store assembling itself: name → header, logo → avatar, colour → the buttons, hours → the
 * status, products → the grid. Signup shows it too, before the store exists, so the same phone
 * carries the whole journey.
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
}: {
  draft: Draft;
  products: Item[];
  whatsapp: boolean;
  /** the store's: "today" is its day, not the phone's */
  timeZone: string;
  specialDays: SpecialDay[];
  /** shown in the address bar, without https:// */
  url?: string | undefined;
  /** ghost products until real ones exist (from what the store sells) */
  examples?: readonly string[] | undefined;
  /** the part the open question changes */
  spot?: Spot | null | undefined;
}) {
  const hours = todayHours({
    timezone: timeZone,
    windows: fromWeek(draft.week),
    specialDays,
  }).windows;
  const weekday = localNow(timeZone).weekday;
  const anyHours = draft.week.some((d) => d.length);
  const how = [draft.pickup && 'retirada', draft.delivery && 'entrega'].filter(Boolean).join(' · ');
  const accent = draft.accent ?? INK;
  const onAccent = draft.onAccent ?? '#ffffff';
  return (
    <div className="mx-auto max-w-[340px] rounded-[40px] bg-[#0c1410] p-3 depth-3">
      <div className="relative flex aspect-[9/17] flex-col overflow-hidden rounded-[30px] bg-[#fcfbf8] text-[#1a1714]">
        {url ? (
          <div className="px-4 pt-3">
            <p className="tnum truncate rounded-full bg-black/5 px-3 py-1 text-center text-[11px] text-black/60">
              {url}
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold transition-[background-color,box-shadow] duration-(--duration-smooth)',
              (spot === 'logo' || spot === 'color') && HALO,
            )}
            style={{ background: accent, color: onAccent }}
          >
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              (draft.name.trim().slice(0, 1) || '?').toUpperCase()
            )}
          </span>
          <span className={cn('min-w-0 flex-1 px-1', halo(spot === 'name'))}>
            {draft.name.trim() ? (
              <span className="block truncate font-semibold">{draft.name}</span>
            ) : (
              <span className="my-1 block h-3 rounded bg-black/5" />
            )}
          </span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px]">sacola</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className={cn('-mx-1 px-1', halo(spot === 'tagline'))}>
            {draft.tagline ? (
              <p key={draft.tagline} className="animate-fade-up font-display text-xl leading-tight">
                {draft.tagline}
              </p>
            ) : (
              <div className="h-6 w-3/4 rounded bg-black/5" />
            )}
          </div>
          {anyHours ? (
            <p
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                hours.length ? 'bg-[#e8f5dd] text-[#2f4a00]' : 'bg-black/5 text-black/65',
                halo(spot === 'hours', 'rounded-full'),
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  hours.length ? 'bg-[#1f7a4d]' : 'bg-black/30',
                )}
              />
              {hours.length
                ? `Hoje: ${hours.map((h) => `${hhmm(h.open)}–${hhmm(h.close)}`).join(', ')}`
                : `${WEEKDAYS[weekday]}: fechado`}
            </p>
          ) : (
            <div
              className={cn(
                'mt-2 h-5 w-28 rounded-full bg-black/5',
                halo(spot === 'hours', 'rounded-full'),
              )}
            />
          )}
          <p
            className={cn(
              '-mx-1 mt-1 min-h-4 px-1 text-[11px] text-black/65',
              halo(spot === 'how'),
              spot === 'how' && !how && 'w-24',
            )}
          >
            {how}
          </p>
          <div className={cn('mt-3 grid grid-cols-2 gap-2', halo(spot === 'products'))}>
            {products.length
              ? products.slice(0, 4).map((p) => (
                  <div
                    key={p.id}
                    className="animate-fade-up overflow-hidden rounded-lg bg-white shadow-sm"
                  >
                    <div className="aspect-[4/3] bg-[#efe9d8]">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <NoPhoto className="text-[#123c32]" />
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[11px] font-semibold">{p.name}</p>
                      <p className="text-[11px] text-black/60">{money(p.priceCents)}</p>
                    </div>
                  </div>
                ))
              : Array.from({ length: 4 }, (_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="flex aspect-[4/5] flex-col justify-end rounded-lg border border-dashed border-black/10 p-1.5"
                  >
                    {examples?.[i] ? (
                      <p className="truncate text-[11px] text-black/60">{examples[i]}</p>
                    ) : null}
                  </div>
                ))}
          </div>
          {whatsapp || spot === 'whatsapp' ? (
            <p
              className={cn(
                'animate-fade-up mt-3 text-center text-[11px] font-semibold',
                whatsapp ? 'text-[#1f7a4d]' : 'text-black/45',
                halo(spot === 'whatsapp'),
              )}
            >
              ● fale com a gente no WhatsApp
            </p>
          ) : null}
        </div>
        <div className="px-4 pb-4">
          <p
            className={cn(
              'rounded-full py-2 text-center text-[12px] font-semibold transition-[background-color,box-shadow] duration-(--duration-smooth)',
              (spot === 'pay' || spot === 'color') && HALO,
            )}
            style={{ background: accent, color: onAccent }}
          >
            ver sacola
          </p>
        </div>
      </div>
    </div>
  );
}
