import type { AvailabilitySchedule, Product } from '../../lib/api.ts';
import { hhmm, WEEKDAYS } from '../../lib/format.ts';

export type ScheduleWindow = AvailabilitySchedule['windows'][number];

/** The week as a merchant reads it: segunda first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const MAX_WINDOWS = 7;

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;

/** [1,2,3,4,5] → "seg a sex" · [6,0] → "sáb e dom" · [1,3,5] → "seg, qua e sex" */
export function daysText(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'todos os dias';
  const idx = WEEK_ORDER.map((d, i) => (set.has(d) ? i : -1)).filter((i) => i >= 0);
  const runs: number[][] = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  }
  const parts = runs.flatMap((r) =>
    r.length >= 3
      ? [`${WEEKDAYS[WEEK_ORDER[r[0]!]!]} a ${WEEKDAYS[WEEK_ORDER[r[r.length - 1]!]!]}`]
      : r.map((i) => WEEKDAYS[WEEK_ORDER[i]!]!),
  );
  return list(parts);
}

export const windowText = (w: ScheduleWindow) =>
  `${daysText(w.days)}, ${w.from && w.to ? `das ${hhmm(w.from)} às ${hhmm(w.to)}` : 'o dia todo'}`;

/** "Seg a sex, das 11h às 15h; sáb, o dia todo" */
export function scheduleShort(s: AvailabilitySchedule): string {
  const t = s.windows
    .filter((w) => w.days.length)
    .map(windowText)
    .join('; ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Nenhum dia escolhido';
}

/** The full sentence under the editor, including what shoppers see outside the windows. */
export function scheduleSentence(s: AvailabilitySchedule): string {
  return `Aparece na loja ${s.windows
    .filter((w) => w.days.length)
    .map(windowText)
    .join('; ')}. Fora disso, ${
    s.outside === 'hidden' ? 'some do cardápio' : 'aparece como indisponível'
  }.`;
}

export const outsideNow = (p: Pick<Product, 'availableNow' | 'availabilitySchedule'>) =>
  !!p.availabilitySchedule && p.availableNow === false;

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** null when fine; otherwise what to fix, in words */
export function windowProblem(w: ScheduleWindow): string | null {
  if (!w.days.length) return 'Escolha pelo menos um dia.';
  if (!!w.from !== !!w.to) return 'Preencha o início e o fim.';
  if (w.from && w.to && mins(w.to) <= mins(w.from))
    return 'O fim precisa ser depois do início, no mesmo dia.';
  return null;
}
