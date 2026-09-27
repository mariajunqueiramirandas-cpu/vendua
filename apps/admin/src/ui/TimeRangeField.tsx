import { Copy, PencilSimple, Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Window_ } from '../lib/api.ts';
import { hhmm, WEEKDAYS, WEEKDAYS_LONG } from '../lib/format.ts';
import { IconButton } from './Button.tsx';
import { cn } from './cn.ts';
import { TimeInput, Toggle } from './fields.tsx';

export type WeekModel = { open: string; close: string }[][]; // [day 0..6] → ranges

export function toWeek(windows: Window_[]): WeekModel {
  const w: WeekModel = Array.from({ length: 7 }, () => []);
  for (const x of windows) for (const d of x.days) w[d]!.push({ open: x.open, close: x.close });
  for (const d of w) d.sort((a, b) => a.open.localeCompare(b.open));
  return w;
}

/** Days with identical ranges fold back into one window each (what Core stores). */
export function fromWeek(w: WeekModel): Window_[] {
  const map = new Map<string, number[]>();
  w.forEach((ranges, day) => {
    for (const r of ranges) {
      const k = `${r.open}-${r.close}`;
      map.set(k, [...(map.get(k) ?? []), day]);
    }
  });
  return [...map].map(([k, days]) => {
    const [open, close] = k.split('-') as [string, string];
    return { days, open, close };
  });
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Hours per weekday as bars on a 24 h track; tap a day to edit it; copy one day to all (§7). */
export function TimeRangeField({
  value,
  onChange,
}: {
  value: WeekModel;
  onChange: (w: WeekModel) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const set = (day: number, ranges: WeekModel[number]) =>
    onChange(value.map((r, d) => (d === day ? ranges : r)));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <ul className="divide-y divide-line">
      {order.map((day) => {
        const ranges = value[day]!;
        const isOpen = ranges.length > 0;
        const editing = open === day;
        return (
          <li key={day} className="py-1.5">
            <div className="flex min-h-12 items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(editing ? null : day)}
                aria-expanded={editing}
                aria-label={`editar ${WEEKDAYS_LONG[day]}`}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-sm text-left"
              >
                <span className="w-10 shrink-0 font-semibold capitalize">{WEEKDAYS[day]}</span>
                <span
                  className="relative hidden h-2.5 flex-1 rounded-full bg-sunken sm:block"
                  aria-hidden
                >
                  {ranges.map((r, i) => {
                    const a = mins(r.open);
                    let b = mins(r.close);
                    if (b <= a) b = 24 * 60; // overnight: draw to midnight
                    return (
                      <span
                        key={i}
                        className="absolute inset-y-0 rounded-full bg-[var(--chart)]"
                        style={{
                          left: `${(a / 1440) * 100}%`,
                          width: `${((b - a) / 1440) * 100}%`,
                        }}
                      />
                    );
                  })}
                </span>
                <span
                  className={cn(
                    'tnum t-body min-w-0 flex-1 truncate sm:w-32 sm:flex-none sm:text-right',
                    !isOpen && 'text-muted',
                  )}
                >
                  {isOpen
                    ? ranges.map((r) => `${hhmm(r.open)}–${hhmm(r.close)}`).join(', ')
                    : 'fechado'}
                </span>
                <PencilSimple className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
              <div className="shrink-0">
                <Toggle
                  checked={isOpen}
                  onChange={(v) => {
                    set(day, v ? [{ open: '09:00', close: '18:00' }] : []);
                    if (v) setOpen(day);
                  }}
                  label={<span className="sr-only">abre {WEEKDAYS_LONG[day]}</span>}
                />
              </div>
            </div>
            {editing && isOpen ? (
              <div className="animate-fade-up mb-2 space-y-2 rounded-md bg-sunken p-3">
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <TimeInput
                      label={`${WEEKDAYS_LONG[day]}: abre`}
                      value={r.open}
                      onCommit={(t) =>
                        set(
                          day,
                          ranges.map((x, k) => (k === i ? { ...x, open: t } : x)),
                        )
                      }
                    />
                    <span className="text-muted">às</span>
                    <TimeInput
                      label={`${WEEKDAYS_LONG[day]}: fecha`}
                      value={r.close}
                      onCommit={(t) =>
                        set(
                          day,
                          ranges.map((x, k) => (k === i ? { ...x, close: t } : x)),
                        )
                      }
                    />
                    {ranges.length > 1 ? (
                      <IconButton
                        label="tirar este horário"
                        size="sm"
                        onClick={() =>
                          set(
                            day,
                            ranges.filter((_, k) => k !== i),
                          )
                        }
                      >
                        <X />
                      </IconButton>
                    ) : null}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => set(day, [...ranges, { open: '18:00', close: '22:00' }])}
                    className="t-caption inline-flex min-h-10 items-center gap-1 rounded-sm px-2 text-muted hover:bg-press hover:text-ink"
                  >
                    <Plus className="size-4" /> outro horário no dia
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(value.map(() => ranges.map((r) => ({ ...r }))))}
                    className="t-caption inline-flex min-h-10 items-center gap-1 rounded-sm px-2 text-muted hover:bg-press hover:text-ink"
                  >
                    <Copy className="size-4" /> copiar para todos os dias
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
