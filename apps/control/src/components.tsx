import { useEffect, useState, type ReactNode } from 'react';

/** Page chrome — serif display title + count/context line + actions. */
export function Page({
  title,
  sub,
  actions,
  children,
}: {
  title: string;
  sub?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="topbar">
        <h1>{title}</h1>
        {sub && <span className="sub">{sub}</span>}
        <div className="spacer" />
        {actions && <div className="tb-acts">{actions}</div>}
      </div>
      <div className="content">{children}</div>
    </>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <div className="empty">
      <span className="serif">{title}</span>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export function StateChip({ state }: { state: string }) {
  const label: Record<string, string> = {
    lead: 'lead',
    contacted: 'contatado',
    invited: 'convidado',
    live: 'ativo',
  };
  return <span className={`chip state-${state}`}>{label[state] ?? state}</span>;
}

/** Monogram puck — marks a person/thread across the app. */
export function Avatar({ name, lg }: { name: string; lg?: boolean }) {
  const init = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`avatar${lg ? ' lg' : ''}`} aria-hidden>
      {init || '·'}
    </span>
  );
}

/** Score 0–100 as a sliver + tabular number. */
export function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className="scorebar" title={`score ${score}`}>
      <span className="rail-m">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="mono">{score}</span>
    </span>
  );
}

/** Two-tap confirm for destructive actions — arms red, fires on second click. */
export function ConfirmBtn({
  children,
  confirm = 'confirmar?',
  onConfirm,
  className = '',
}: {
  children: ReactNode;
  confirm?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 2600);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <button
      className={`btn ${className}${arm ? ' arm' : ''}`}
      onClick={() => (arm ? (setArm(false), onConfirm()) : setArm(true))}
      onBlur={() => setArm(false)}
    >
      {arm ? confirm : children}
    </button>
  );
}

export const fmtMoney = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';

/** Date-only values ('YYYY-MM-DD') — `new Date(s)` parses them as UTC
 *  midnight, which renders as the previous day anywhere west of UTC.
 *  Build a local-day Date instead. */
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
