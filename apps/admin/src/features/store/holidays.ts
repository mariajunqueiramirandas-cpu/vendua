// Brazil's national holidays, offered as one-tap special days on Loja. Fixed dates repeat every
// year; Carnaval, Sexta-feira Santa and Corpus Christi move with Easter, so they're added for
// the year they fall in.

const DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

/** Easter Sunday in the Gregorian calendar (Meeus/Jones/Butcher), YYYY-MM-DD */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export interface Holiday {
  date: string;
  /** Carnaval: Monday and Tuesday */
  until?: string;
  label: string;
  /** the same date every year */
  yearly: boolean;
}

const FIXED: [string, string][] = [
  ['01-01', 'Ano-Novo'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Consciência Negra'],
  ['12-25', 'Natal'],
];

/** The holidays from `today` (YYYY-MM-DD, store time) through the next twelve months, in order. */
export function holidaysAhead(today: string): Holiday[] {
  const y = Number(today.slice(0, 4));
  const last = addDays(today, 365);
  const out: Holiday[] = [];
  for (const year of [y, y + 1]) {
    const e = easter(year);
    out.push(
      ...FIXED.map(([md, label]) => ({ date: `${year}-${md}`, label, yearly: true })),
      { date: addDays(e, -48), until: addDays(e, -47), label: 'Carnaval', yearly: false },
      { date: addDays(e, -2), label: 'Sexta-feira Santa', yearly: false },
      { date: addDays(e, 60), label: 'Corpus Christi', yearly: false },
    );
  }
  return out
    .filter((h) => (h.until ?? h.date) >= today && h.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date));
}
