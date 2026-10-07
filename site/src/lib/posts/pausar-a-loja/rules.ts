// The store's clock as Core and the Kernel decide it, on one fictional week of Bolos da Nena
// (15 to 21 nov 2026). Sources: packages/core/src/modules/store.ts deriveStatus (open / paused /
// closed), packages/core/src/modules/notices.ts (the shopper's banners), packages/kernel/src/rules
// hours.ts statusWords + format.ts formatWhen (the sign's words), packages/kernel/src/pages/closed.ts
// (the bag's note), site/scripts/assets.ts NENA_HOURS (her week). Time is minutes from Sunday 00:00.

export const DAY = 1440;
export const WEEK = 7 * DAY;

export type Win = { open: number; close: number };

/** NENA_HOURS: Tuesday to Saturday 8h–18h, Sunday 8h–12h, closed on Monday */
export const NENA: Win[][] = [
  [{ open: 480, close: 720 }],
  [],
  [{ open: 480, close: 1080 }],
  [{ open: 480, close: 1080 }],
  [{ open: 480, close: 1080 }],
  [{ open: 480, close: 1080 }],
  [{ open: 480, close: 1080 }],
];

export const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** dom 15 nov 2026 is day 0 */
export const DATE = [15, 16, 17, 18, 19, 20, 21];

/** A special day of this week (days 0–6): closed, or other hours. */
export type Special = { day: number; label: string; closed: boolean; win?: Win };

export function windowsOn(day: number, specials: Special[]): Win[] {
  const s = day < 7 ? specials.find((x) => x.day === day) : undefined;
  if (s) return s.closed || !s.win ? [] : [s.win];
  return NENA[day % 7]!;
}

export type Status =
  | { kind: 'open'; closesAt: number }
  | { kind: 'closed'; opensAt: number | null }
  | { kind: 'paused'; resumesAt: number | null };

/** deriveStatus: a pause wins until it ends by itself; then the week and its special days. */
export function statusAt(t: number, specials: Special[], pauseUntil?: number | null): Status {
  if (pauseUntil !== undefined && (pauseUntil === null || pauseUntil > t))
    return { kind: 'paused', resumesAt: pauseUntil };
  const day = Math.floor(t / DAY);
  const m = t - day * DAY;
  for (const w of windowsOn(day, specials))
    if (m >= w.open && m < w.close) return { kind: 'open', closesAt: day * DAY + w.close };
  for (let d = day; d <= day + 8; d++)
    for (const w of windowsOn(d, specials)) {
      const at = d * DAY + w.open;
      if (at > t) return { kind: 'closed', opensAt: at };
    }
  return { kind: 'closed', opensAt: null };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (t: number) => {
  const m = ((t % DAY) + DAY) % DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
/** "8h", "14h30" */
export const hShort = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`;

/** formatWhen: "hoje às 18:00", "amanhã às 08:00", "sáb às 08:00" */
export function when(at: number, now: number): string {
  const days = Math.floor(at / DAY) - Math.floor(now / DAY);
  if (days === 0) return `hoje às ${hhmm(at)}`;
  if (days === 1) return `amanhã às ${hhmm(at)}`;
  return `${WEEKDAY[Math.floor(at / DAY) % 7]} às ${hhmm(at)}`;
}

/** statusWords: the sign on the store's page ("Aberto até 18:00", "Pausado até 14:30") */
export type SignWord = 'Aberto' | 'Pausado' | 'Fechado';

export function signWords(s: Status, now: number): { word: SignWord; rest: string } {
  if (s.kind === 'open') return { word: 'Aberto', rest: `até ${hhmm(s.closesAt)}` };
  if (s.kind === 'paused') {
    if (s.resumesAt === null) return { word: 'Pausado', rest: '' };
    const w = when(s.resumesAt, now);
    return { word: 'Pausado', rest: `até ${w.startsWith('hoje às ') ? w.slice(8) : w}` };
  }
  return s.opensAt === null
    ? { word: 'Fechado', rest: '' }
    : { word: 'Fechado', rest: `abre ${when(s.opensAt, now)}` };
}

/** Core's notice moment: Intl pt-BR { weekday: 'short', hour, minute } → "sáb., 14:30" */
export const coreMoment = (at: number) => `${WEEKDAY[Math.floor(at / DAY) % 7]}., ${hhmm(at)}`;

/** closedNote: what the bag says while the store is closed (null: it takes this bag) */
export function bagNote(opensAt: number | null, now: number, preorders: boolean): string {
  const w = opensAt === null ? null : when(opensAt, now);
  if (preorders)
    return `Fora do horário, aceitamos só encomendas: deixe na sacola apenas os itens de encomenda${
      w ? ` ou volte ${w}` : ''
    }.`;
  return w
    ? `Estamos fechados — abrimos ${w}. Seus itens ficam na sacola até lá.`
    : 'Estamos fechados agora. Seus itens continuam na sacola.';
}

export const dayName = (t: number) => WEEKDAY_LONG[Math.floor(t / DAY) % 7]!;

export type Span = '15m' | '1h' | 'today' | 'indefinite';
export type DemandSpan = '30m' | '1h' | '2h' | 'today';

/** Core's /store/pause and /store/demand: when each length ends ('today': the next midnight) */
export function spanEnd(span: Span | DemandSpan, now: number): number | null {
  if (span === 'indefinite') return null;
  if (span === 'today') return (Math.floor(now / DAY) + 1) * DAY;
  return now + { '15m': 15, '30m': 30, '1h': 60, '2h': 120 }[span];
}

/** the default prep time (store_settings.prep_time_minutes) */
export const PREP_MINUTES = 30;
export const PAUSE_MESSAGE_MAX = 200;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents: number) => brl.format(cents / 100);
