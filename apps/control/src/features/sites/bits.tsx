import { Bot, UserRound } from 'lucide-react';
import type { SiteTask, SiteTaskStatus } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';

type Variant = 'default' | 'outline' | 'warn' | 'bad' | 'live' | 'contacted' | 'agent-soft';

export const STATUS_LABEL: Record<SiteTaskStatus, string> = {
  queued: 'na fila',
  firing: 'disparando',
  running: 'construindo',
  pr_open: 'PR aberto',
  approved: 'aprovado',
  merged: 'mesclado',
  delivered: 'entregue',
  escalated: 'travado',
  cancelled: 'cancelado',
};

/** failed CI runs on distinct shas before staff take over (Core's MAX_FIX_PUSHES) */
export const MAX_FIX_PUSHES = 4;
/** a running task with no PR this long after its fire may be retried (Core's rule) */
export const STUCK_MS = 60 * 60_000;

export const isDone = (s: SiteTaskStatus) => s === 'delivered' || s === 'cancelled';

/** Amber = a person has to act (approve the green PR); red = it broke; lime = the agent works. */
function statusVariant(t: Pick<SiteTask, 'status' | 'ci' | 'runner'>): Variant {
  switch (t.status) {
    case 'firing':
      return 'agent-soft';
    case 'running':
      return t.runner === 'human' ? 'outline' : 'agent-soft';
    case 'pr_open':
      return t.ci === 'success' ? 'warn' : t.ci === 'failure' ? 'outline' : 'agent-soft';
    case 'approved':
    case 'merged':
      return 'contacted';
    case 'delivered':
      return 'live';
    case 'escalated':
      return 'bad';
    default:
      return 'default';
  }
}

export function StatusChip({
  t,
  className,
}: {
  t: Pick<SiteTask, 'status' | 'ci' | 'runner'>;
  className?: string | undefined;
}) {
  return (
    <Badge variant={statusVariant(t)} className={className}>
      {STATUS_LABEL[t.status] ?? t.status}
    </Badge>
  );
}

const CI: Record<'pending' | 'success' | 'failure', { label: string; variant: Variant }> = {
  pending: { label: 'CI rodando', variant: 'outline' },
  success: { label: 'CI verde', variant: 'live' },
  failure: { label: 'CI vermelho', variant: 'bad' },
};

/** CI state plus the fix pushes used (x/4); nothing before the PR exists. */
export function CiChip({
  t,
  withCount = true,
}: {
  t: Pick<SiteTask, 'ci' | 'iterations'>;
  withCount?: boolean | undefined;
}) {
  if (!t.ci && !t.iterations) return <span className="text-xs text-muted-foreground/70">—</span>;
  const c = t.ci ? CI[t.ci] : null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {c && <Badge variant={c.variant}>{c.label}</Badge>}
      {withCount && (
        <span
          className={cn(
            'text-xs tnum',
            t.iterations > MAX_FIX_PUSHES
              ? 'font-medium text-destructive-foreground'
              : 'text-muted-foreground',
          )}
          title="correções de CI usadas"
        >
          {Math.min(t.iterations, 99)}/{MAX_FIX_PUSHES}
        </span>
      )}
    </span>
  );
}

export const KIND_LABEL = { generate: 'site', revision: 'ajuste' } as const;

export function KindChip({ kind }: { kind: SiteTask['kind'] }) {
  return <Badge variant="outline">{KIND_LABEL[kind] ?? kind}</Badge>;
}

export function Runner({ runner }: { runner: SiteTask['runner'] }) {
  const human = runner === 'human';
  const Icon = human ? UserRound : Bot;
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
      <Icon className={cn('size-3.5 shrink-0', !human && 'text-agent-ink')} />
      {human ? 'pessoa' : 'routine'}
    </span>
  );
}

/** "5h 40min", "35min", "1d 2h" */
export function span(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export type DueTone = 'late' | 'soon' | 'ok' | 'done';
/** under this the task is "perto do prazo" (Core's site.due_soon) */
const SOON_MS = 8 * 60 * 60_000;

/** Time left to the 1-day promise, from the task's state and the clock. */
export function due(
  t: Pick<SiteTask, 'status' | 'dueAt' | 'deliveredAt'>,
  now: number,
): { text: string; tone: DueTone } {
  const at = new Date(t.dueAt).getTime();
  if (t.status === 'cancelled') return { text: 'cancelado', tone: 'done' };
  if (t.status === 'delivered') {
    const late = t.deliveredAt ? new Date(t.deliveredAt).getTime() - at : 0;
    return { text: late > 0 ? `entregue ${span(late)} depois` : 'no prazo', tone: 'done' };
  }
  const left = at - now;
  if (left < 0) return { text: `atrasado há ${span(left)}`, tone: 'late' };
  return { text: `faltam ${span(left)}`, tone: left < SOON_MS ? 'soon' : 'ok' };
}

export const DUE_TONE: Record<DueTone, string> = {
  late: 'font-medium text-destructive-foreground',
  soon: 'font-medium text-warning-foreground',
  ok: 'text-foreground',
  done: 'text-muted-foreground',
};

export function Due({
  t,
  now,
  className,
}: {
  t: Pick<SiteTask, 'status' | 'dueAt' | 'deliveredAt'>;
  now: number;
  className?: string | undefined;
}) {
  const d = due(t, now);
  return (
    <span className={cn('whitespace-nowrap tnum', DUE_TONE[d.tone], className)}>{d.text}</span>
  );
}
