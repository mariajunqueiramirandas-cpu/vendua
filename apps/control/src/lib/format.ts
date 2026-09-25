export const fmtMoney = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Agent spend is metered in USD (model/tool pricing), unlike BRL deal values — don't use fmtMoney. */
export const fmtUsd = (usd: number) => `US$ ${usd.toFixed(2)}`;

export const fmtUsdCents = (cents: number | null | undefined) =>
  cents == null ? '—' : fmtUsd(cents / 100);

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';

/** 'YYYY-MM-DD' parses as UTC midnight — build a local-day Date to avoid the day-shift. */
export const fmtDay = (iso: string | null | undefined) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fmtDate(iso);
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
};

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const rel = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Signed distance for a scheduled action: 'em X' upcoming, 'há X' overdue. */
export const relDue = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const a = Math.abs(ms) / 1000;
  const v =
    a < 60
      ? 'agora'
      : a < 3600
        ? `${Math.floor(a / 60)}min`
        : a < 86400
          ? `${Math.floor(a / 3600)}h`
          : `${Math.floor(a / 86400)}d`;
  return ms < 0 ? `há ${v}` : `em ${v}`;
};

export const isLate = (iso: string | null | undefined) =>
  !!iso && new Date(iso).getTime() < Date.now();
