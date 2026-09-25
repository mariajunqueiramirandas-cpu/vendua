import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox as InboxIcon, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { LEAD_STATE_LABEL } from '@/lib/labels.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from './ui/badge.tsx';
import { Button, type ButtonProps } from './ui/button.tsx';
import { Skeleton } from './ui/controls.tsx';

export function EmptyState({
  title,
  hint,
  icon: Icon = InboxIcon,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode | undefined;
  icon?: typeof InboxIcon | undefined;
  action?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-4 py-8 text-center',
        className,
      )}
    >
      <Icon className="mb-1 size-5 text-muted-foreground/70" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2 flex gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void | undefined;
  className?: string | undefined;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="não foi possível carregar"
      hint={errorMessage(error)}
      className={className}
      action={
        onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw /> tentar de novo
          </Button>
        )
      }
    />
  );
}

/** Placeholder rows while a list loads — keeps layout stable. */
export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

const STAGE_VARIANT = {
  lead: 'lead',
  contacted: 'contacted',
  invited: 'invited',
  live: 'live',
} as const;

export function StateChip({ state, className }: { state: string; className?: string }) {
  const variant = STAGE_VARIANT[state as keyof typeof STAGE_VARIANT] ?? 'default';
  return (
    <Badge variant={variant} className={className}>
      {LEAD_STATE_LABEL[state] ?? state}
    </Badge>
  );
}

/** Monogram puck — marks a person/thread across the app. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const init = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-mono font-semibold text-agent dark:bg-secondary',
        size === 'sm' && 'size-6 text-[10px]',
        size === 'md' && 'size-8 text-[11px]',
        size === 'lg' && 'size-10 text-sm',
      )}
    >
      {init || '·'}
    </span>
  );
}

/** Score 0–100 as a sliver + tabular number. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={`score ${score}`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs tnum">{score}</span>
    </span>
  );
}

/** Two-tap confirm for destructive actions — arms on first tap, fires on second. */
export function ConfirmButton({
  children,
  confirm = 'confirmar?',
  onConfirm,
  variant = 'outline',
  ...props
}: Omit<ButtonProps, 'onClick'> & { confirm?: ReactNode; onConfirm: () => void }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 2600);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <Button
      {...props}
      variant={arm ? 'destructive' : variant}
      onClick={() => (arm ? (setArm(false), onConfirm()) : setArm(true))}
      onBlur={() => setArm(false)}
    >
      {arm ? confirm : children}
    </Button>
  );
}

export interface Kpi {
  label: string;
  value: ReactNode;
  to?: string | undefined;
  tone?: 'warn' | 'bad' | 'agent' | undefined;
  hint?: ReactNode | undefined;
}

/** One compact row of numbers — scrolls sideways on phones instead of stacking cards. */
export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn('no-scrollbar -mx-3 flex overflow-x-auto px-3 md:mx-0 md:px-0', className)}>
      <div className="flex min-w-full divide-x rounded-lg border bg-card">
        {items.map((k) => {
          const body = (
            <>
              <div className="text-[11px] font-medium whitespace-nowrap text-muted-foreground">
                {k.label}
              </div>
              <div
                className={cn(
                  'font-mono text-lg leading-tight font-medium whitespace-nowrap tnum',
                  k.tone === 'warn' && 'text-warning-foreground',
                  k.tone === 'bad' && 'text-destructive-foreground',
                )}
              >
                {k.value}
              </div>
              {k.hint && (
                <div className="text-[11px] whitespace-nowrap text-muted-foreground">{k.hint}</div>
              )}
            </>
          );
          const cls = 'flex min-w-28 flex-1 flex-col gap-0.5 px-3 py-2';
          return k.to ? (
            <Link key={k.label} to={k.to} className={cn(cls, 'transition-colors hover:bg-hover')}>
              {body}
            </Link>
          ) : (
            <div key={k.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quiet label/value pair for fact grids. */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm">{children}</span>
    </div>
  );
}
