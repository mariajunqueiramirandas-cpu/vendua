// When Duá writes about a stopped sacola, by Core's rule (packages/core/src/vendedor/sweeper.ts,
// recoveryPass): once the shopper has been quiet for the delay (5 to 120 min, 15 by default), only
// while the store is open, and only inside 24 h of the shopper's last message. Minutes are counted
// from the midnight of the day of that message. The store's hours here are an example.

export const OPEN = 9 * 60;
export const CLOSE = 19 * 60;
export const DAY = 24 * 60;
export const WINDOW = 24 * 60;

export const isOpen = (m: number) => {
  const t = ((m % DAY) + DAY) % DAY;
  return t >= OPEN && t < CLOSE;
};

/** The first minute at or after `m` with the store open. */
export function nextOpen(m: number): number {
  if (isOpen(m)) return m;
  const day = Math.floor(m / DAY);
  const t = m - day * DAY;
  return t < OPEN ? day * DAY + OPEN : (day + 1) * DAY + OPEN;
}

export interface Plan {
  due: number;
  at: number | null;
  waited: boolean;
}

export function plan(last: number, delay: number): Plan {
  const due = last + delay;
  const at = nextOpen(due);
  return { due, at: at < last + WINDOW ? at : null, waited: at !== due };
}

export const hhmm = (m: number) => {
  const t = ((m % DAY) + DAY) % DAY;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const dayWord = (m: number, last: number) =>
  Math.floor(m / DAY) > Math.floor(last / DAY) ? 'amanhã' : 'hoje';
