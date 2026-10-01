import { localNow, todayHours } from '@vendua/kernel/rules';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, money, WEEKDAYS } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { fromWeek, type WeekModel } from '../../ui/TimeRangeField.tsx';

export interface Draft {
  name: string;
  tagline: string;
  logoUrl: string | null;
  week: WeekModel;
  pickup: boolean;
  delivery: boolean;
}

type Item = { id: string; name: string; priceCents: number; imageUrl: string | null };

/** The store assembling itself: name → header, logo → avatar, hours → status, products → the grid. */
export function MiniStore({
  draft,
  products,
  whatsapp,
  timeZone,
  specialDays,
}: {
  draft: Draft;
  products: Item[];
  whatsapp: boolean;
  /** the store's: "today" is its day, not the phone's */
  timeZone: string;
  specialDays: SpecialDay[];
}) {
  const hours = todayHours({
    timezone: timeZone,
    windows: fromWeek(draft.week),
    specialDays,
  }).windows;
  const weekday = localNow(timeZone).weekday;
  const anyHours = draft.week.some((d) => d.length);
  const how = [draft.pickup && 'retirada', draft.delivery && 'entrega'].filter(Boolean).join(' · ');
  return (
    <div className="mx-auto max-w-[340px] rounded-[40px] bg-[#0c1410] p-3 depth-3">
      <div className="aspect-[9/17] overflow-hidden rounded-[30px] bg-[#fcfbf8] text-[#1a1714]">
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#123c32] text-sm font-semibold text-white">
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              (draft.name.trim().slice(0, 1) || '?').toUpperCase()
            )}
          </span>
          {draft.name.trim() ? (
            <span className="min-w-0 flex-1 truncate font-semibold">{draft.name}</span>
          ) : (
            <span className="h-3 flex-1 rounded bg-black/5" />
          )}
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px]">sacola</span>
        </div>
        <div className="px-4 py-4">
          {draft.tagline ? (
            <p key={draft.tagline} className="animate-fade-up font-display text-xl leading-tight">
              {draft.tagline}
            </p>
          ) : (
            <div className="h-6 w-3/4 rounded bg-black/5" />
          )}
          {anyHours ? (
            <p
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                hours.length ? 'bg-[#e8f5dd] text-[#2f4a00]' : 'bg-black/5 text-black/65',
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
            <div className="mt-2 h-5 w-28 rounded-full bg-black/5" />
          )}
          <p className="mt-1 min-h-4 text-[11px] text-black/65">{how}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(products.length ? products.slice(0, 6) : Array.from({ length: 4 }, () => null)).map(
              (p, i) =>
                p ? (
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
                ) : (
                  <div
                    key={i}
                    className="aspect-[4/5] rounded-lg border border-dashed border-black/10"
                  />
                ),
            )}
          </div>
          {whatsapp ? (
            <p className="animate-fade-up mt-3 text-center text-[11px] font-semibold text-[#1f7a4d]">
              ● fale com a gente no WhatsApp
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
