// Today's change from the status sheet, written into the store's special-days list without
// touching any other day the merchant set (ranges and yearly repeats included).
import type { SpecialDay } from '../../lib/api.ts';

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
/** a real date for year + "-MM-DD" (a 29 Feb in a common year rolls to 1 Mar) */
const inYear = (year: number, md: string) => {
  const [m, d] = md.slice(1).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10);
};
const lastDay = (d: SpecialDay) => (d.until && d.until > d.date ? d.until : d.date);
/** Core's list key (parseSpecialDays rejects a repeat) */
const keyOf = (d: SpecialDay) => `${d.date}|${d.until ?? ''}|${d.yearly ? 'y' : ''}`;

/** Whether a stored entry covers `date` (modules/store.ts specialCovers). */
export function covers(d: SpecialDay, date: string) {
  if (date < d.date) return false;
  const until = lastDay(d);
  if (!d.yearly) return date <= until;
  const md = date.slice(5);
  const from = d.date.slice(5);
  const to = until.slice(5);
  return until.slice(0, 4) === d.date.slice(0, 4) ? md >= from && md <= to : md >= from || md <= to;
}

/** a one-off for `date` alone: what "salvar horário de hoje" writes */
export const onlyOn = (d: SpecialDay, date: string) =>
  d.date === date && !d.yearly && lastDay(d) === date;

/** One-off days already gone change nothing, and Core keeps at most 60 entries. */
const live = (days: SpecialDay[], date: string) =>
  days.filter((d) => d.yearly || lastDay(d) >= date);

function dedupe(days: SpecialDay[]) {
  const seen = new Set<string>();
  return days.filter((d) => {
    const k = keyOf(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The list with `date` back on the usual hours and every other day kept: today's own override
 * goes, a range covering today restarts tomorrow, and a yearly one skips this year's turn (what
 * is left of that turn after today stays, as a one-off).
 */
export function liftDay(days: SpecialDay[], date: string): SpecialDay[] {
  const out: SpecialDay[] = [];
  for (const d of live(days, date)) {
    if (!covers(d, date)) {
      out.push(d);
      continue;
    }
    if (onlyOn(d, date)) continue;
    const span = spanDays(d.date, lastDay(d));
    const year = Number(date.slice(0, 4));
    // this year's turn of a yearly entry; one crossing new year began the year before
    const start = d.yearly
      ? inYear(date.slice(5) >= d.date.slice(5) ? year : year - 1, d.date.slice(4))
      : d.date;
    const end = addDays(start, span);
    const { until: _until, yearly: _yearly, ...base } = d;
    if (end > date) {
      const from = addDays(date, 1);
      out.push({ ...base, date: from, ...(end > from ? { until: end } : {}) });
    }
    if (d.yearly) {
      const next = inYear(Number(start.slice(0, 4)) + 1, d.date.slice(4));
      out.push({
        ...base,
        date: next,
        yearly: true,
        ...(span ? { until: addDays(next, span) } : {}),
      });
    }
  }
  return dedupe(out);
}

/** The list with `day` ruling `date`: a one-off for the day outranks any range or yearly entry. */
export function setDay(days: SpecialDay[], date: string, day: SpecialDay): SpecialDay[] {
  return dedupe([...live(days, date).filter((d) => !onlyOn(d, date)), day]);
}
