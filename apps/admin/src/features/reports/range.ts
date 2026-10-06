import { qk } from '../../lib/query.ts';

export const PERIODS = [
  { value: 'hoje', label: 'hoje' },
  { value: 'ontem', label: 'ontem' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes', label: 'este mês' },
  { value: 'mes-passado', label: 'mês passado' },
  { value: 'custom', label: 'personalizado' },
] as const;
export type Period = (typeof PERIODS)[number]['value'];
export const DEFAULT_PERIOD: Period = '7d';
export const isPeriod = (v: string | null): v is Period => PERIODS.some((p) => p.value === v);

// Shared with the route prefetch (app/routes.ts), so the warmed-up query is the one Reports asks
// for. A preset's days are Core's, in the store's calendar; a custom range is the dates typed.
export function reportsQuery(p: Period, custom?: { from: string; to: string }) {
  if (p === 'custom' && custom)
    return { key: qk.reports('custom', custom.from, custom.to), params: custom };
  const period = p === 'custom' ? DEFAULT_PERIOD : p;
  return { key: qk.reports(period), params: { period } };
}
