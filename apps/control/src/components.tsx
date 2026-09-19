import type { ReactNode } from 'react';

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
        {actions}
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

export const fmtMoney = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';

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
