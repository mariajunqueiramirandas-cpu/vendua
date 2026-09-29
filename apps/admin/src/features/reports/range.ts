import { isoDate } from '../../lib/format.ts';

export type Period = 'hoje' | '7d' | '30d' | 'custom';

// Shared with the route prefetch (app/routes.tsx), so the warmed-up query is the one Reports asks for.
export function rangeOf(p: Period, custom?: { from: string; to: string }) {
  const today = isoDate(new Date());
  if (p === 'custom' && custom) return custom;
  const back = p === 'hoje' ? 0 : p === '7d' ? 6 : 29;
  return { from: isoDate(new Date(Date.now() - back * 86_400_000)), to: today };
}
