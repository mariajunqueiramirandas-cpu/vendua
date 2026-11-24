import { Link, useLocation } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useAgentStatus, type AgentStatus } from '@/lib/queries.ts';

const DOT: Record<AgentStatus['tone'], string> = {
  live: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  off: 'bg-border-strong',
};

/** Compact live agent status pill shown in the Agente hub header. */
export function AgentStatusPill() {
  const status = useAgentStatus();
  const { pathname } = useLocation();
  if (!status.label) return null;

  const to = status.modelsMissing ? '/ia/modelos' : '/agente/configurar';
  const onConfig = pathname.startsWith('/agente/configurar') && !status.modelsMissing;

  const inner = (
    <>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[status.tone])} />
      <span className="truncate">{status.label}</span>
      {!onConfig && <SlidersHorizontal className="size-3 shrink-0 text-muted-foreground" />}
    </>
  );

  if (onConfig) {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium text-foreground shadow-card">
        {inner}
      </span>
    );
  }

  return (
    <Link
      to={to}
      title={status.modelsMissing ? 'configurar modelo de IA' : 'ajustar autonomia do agente'}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors shadow-card',
        status.tone === 'bad'
          ? 'border-destructive/30 bg-destructive-soft text-destructive-foreground hover:bg-destructive-soft/80'
          : 'bg-card text-foreground hover:bg-muted',
      )}
    >
      {inner}
    </Link>
  );
}
