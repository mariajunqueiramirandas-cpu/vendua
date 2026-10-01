// Money, time and text formatting — pure (Intl only). The Kernel's defaults,
// @vendua/ui-defaults, stores and the merchant admin all format through here.

export const LOCALE = 'pt-BR';
// Core's own fallback for a store saved without a zone (modules/store.ts deriveStatus)
const STORE_TIME_ZONE = 'America/Sao_Paulo';

/** The shared money formatter — pass the tenant currency (`store.currency`). */
export function formatCents(cents: number, currency = 'BRL', locale = LOCALE): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** The symbol and the number apart (a store that sets "R$" smaller), in the locale's order. */
export function formatCentsParts(
  cents: number,
  currency = 'BRL',
): { symbol: string; amount: string; symbolFirst: boolean } {
  const parts = new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).formatToParts(
    cents / 100,
  );
  const at = parts.findIndex((p) => p.type === 'currency');
  const firstNumber = parts.findIndex((p) => p.type === 'integer');
  return {
    symbol: at >= 0 ? parts[at]!.value : currency,
    amount: parts
      .filter((p) => p.type !== 'currency' && p.type !== 'literal')
      .map((p) => p.value)
      .join(''),
    symbolFirst: at >= 0 && at < firstNumber,
  };
}

function safeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** "sáb., 26 set., 18:00" — a full instant, in the store's zone when given. */
export function formatDateTime(iso: string, timeZone?: string): string {
  const tz = safeZone(timeZone);
  return new Intl.DateTimeFormat(LOCALE, {
    ...(tz ? { timeZone: tz } : {}),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "18:00" */
export function formatTime(iso: string, timeZone?: string): string {
  const tz = safeZone(timeZone);
  return new Intl.DateTimeFormat(LOCALE, {
    ...(tz ? { timeZone: tz } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "sáb., 26 set." for a store-local YYYY-MM-DD (no timezone shift). */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)));
}

const WEEKDAY_KEY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The store's wall clock: its local date, weekday (0 = Sunday) and minutes since midnight. */
export function localNow(
  timeZone: string,
  now: Date = new Date(),
): { date: string; weekday: number; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone(timeZone) ?? STORE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAY_KEY.indexOf(p.weekday ?? ''),
    // some engines print midnight as 24 under h23
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** The one phrase for "the next instant": `hoje às 18:00`, `amanhã às 09:00`, `sáb às 09:00`
 *  (within 6 days), else `12/10 às 09:00` — in the store's zone. */
export function formatWhen(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const tz = safeZone(timeZone) ?? STORE_TIME_ZONE;
  const when = localNow(tz, at);
  const days = dayNumber(when.date) - dayNumber(localNow(tz, now).date);
  const hhmm = formatTime(iso, tz);
  if (days === 0) return `hoje às ${hhmm}`;
  if (days === 1) return `amanhã às ${hhmm}`;
  if (days > 1 && days <= 6) return `${WEEKDAY_SHORT[when.weekday]} às ${hhmm}`;
  const [, mm, dd] = when.date.split('-');
  return `${dd}/${mm} às ${hhmm}`;
}

/** The word for `n` (pt-BR: only 1 is singular — "0 itens"). */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Accent- and case-blind text for matching ("Açaí" → "acai"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase(LOCALE);
}

/** `{key}` → `vars.key`; a placeholder with no value reads as nothing. */
export function interpolate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : '',
  );
}

/** "29:41" (or "1:02:05") until `to`; "0:00" once it passed. */
export function countdown(to: number, now: number): string {
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Core's resized copies of an uploaded image (`/v1/media/…?w=`, smallest variant ≥ w). */
export const MEDIA_WIDTHS = [320, 480, 640, 960, 1280];

/** A srcset for a Core media path; undefined for any other src (external, data:, CDN). */
export function mediaSrcSet(src: string, widths: readonly number[] = MEDIA_WIDTHS) {
  if (!src.startsWith('/v1/media/')) return undefined;
  const sep = src.includes('?') ? '&' : '?';
  return widths.map((w) => `${src}${sep}w=${w} ${w}w`).join(', ');
}
