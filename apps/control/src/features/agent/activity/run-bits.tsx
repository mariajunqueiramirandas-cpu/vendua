import { PauseCircle } from 'lucide-react';
import type { AgentRun } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Tooltip } from '@/components/ui/controls.tsx';
import { isActive } from './queries.ts';

export const RUN_STATUS_LABEL: Record<string, string> = {
  queued: 'na fila',
  running: 'rodando',
  done: 'feito',
  failed: 'falhou',
  canceled: 'cancelado',
};

const STATUS_VARIANT = {
  queued: 'outline',
  running: 'agent',
  done: 'default',
  failed: 'bad',
  canceled: 'outline',
} as const;

export function RunStatus({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status as keyof typeof STATUS_VARIANT] ?? 'default'}
      className={className}
    >
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {RUN_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function RunKind({ kind, className }: { kind: string; className?: string }) {
  return (
    <span className={cn('text-xs whitespace-nowrap text-muted-foreground', className)}>
      {RUN_KIND_LABEL[kind] ?? kind}
    </span>
  );
}

/** Queued thread-bound run held by a staff pause — it waits until the agent is reactivated there. */
export const isPausedRun = (r: AgentRun) => isActive(r.status) && r.thread_agent_enabled === false;

export function PausedChip() {
  return (
    <Tooltip content="a conversa está pausada — o run fica na fila até o agente ser reativado nela">
      <span className="inline-flex">
        <Badge variant="warn">
          <PauseCircle /> pausado
        </Badge>
      </span>
    </Tooltip>
  );
}

export const shortId = (id: string) => id.slice(0, 8);

/** The run's error worth showing — a cancel writes its own status word there, which the badge already says. */
export const runError = (r: AgentRun) =>
  r.error && r.error.trim().toLowerCase() !== (RUN_STATUS_LABEL[r.status] ?? r.status)
    ? r.error
    : null;

export function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Wall time: start → finish, or start → now while it still runs. */
export function runDuration(r: AgentRun, now = Date.now()): number | null {
  if (!r.started_at) return null;
  const end = r.finished_at ? new Date(r.finished_at).getTime() : isActive(r.status) ? now : null;
  return end == null ? null : end - new Date(r.started_at).getTime();
}

export const fmtTokens = (r: AgentRun) => (r.tokens_in + r.tokens_out).toLocaleString('pt-BR');
