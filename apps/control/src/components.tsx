import { useEffect, useState, type ReactNode } from 'react';
import type { Meeting } from './api.ts';

/** Canonical entity labels — one source so a copy change lands once. Pairs
 *  keep pipeline order for selects/columns; the Record serves chips and
 *  inline text. */
export const LEAD_STATES = [
  ['lead', 'lead'],
  ['contacted', 'contatado'],
  ['invited', 'convidado'],
  ['live', 'ativo'],
] as const;
export const LEAD_STATE_LABEL: Record<string, string> = Object.fromEntries(LEAD_STATES);

export const AGENT_GOALS = [
  ['negotiation', 'fechar negócio'],
  ['meeting', 'marcar reunião'],
] as const;
export const AGENT_GOAL_LABEL: Record<string, string> = Object.fromEntries(AGENT_GOALS);

export const AGENT_MODES = [
  ['off', 'off'],
  ['draft', 'rascunho'],
  ['auto', 'auto'],
] as const;
export const AGENT_MODE_LABEL: Record<string, string> = Object.fromEntries(AGENT_MODES);

export const RUN_KIND_LABEL: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
  strategist: 'estrategista',
};

export const MEETING_STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};

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
  return <span className={`chip state-${state}`}>{LEAD_STATE_LABEL[state] ?? state}</span>;
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

/** Signed distance for a scheduled action: 'em X' upcoming, 'há X' overdue. */
export const relDue = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const a = Math.abs(ms) / 1000;
  const v =
    a < 60 ? 'agora' : a < 3600 ? `${Math.floor(a / 60)}min` : a < 86400 ? `${Math.floor(a / 3600)}h` : `${Math.floor(a / 86400)}d`;
  return ms < 0 ? `há ${v}` : `em ${v}`;
};

/** True when the timestamp is in the past — pairs with .due.bad styling. */
export const isLate = (iso: string | null | undefined) =>
  !!iso && new Date(iso).getTime() < Date.now();
