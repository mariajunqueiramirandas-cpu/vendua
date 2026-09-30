import type { ReactNode } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import type {
  DeploymentKind,
  DeploymentStatus,
  FleetSeverity,
  ProbeCheck,
  ProbeStatus,
  ProvisionState,
} from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { Badge } from '@/components/ui/badge.tsx';

type Variant = 'default' | 'outline' | 'warn' | 'bad' | 'live' | 'agent-soft';
export type Tone = { label: string; variant: Variant };

export const DEPLOY_STATUS: Record<DeploymentStatus, Tone> = {
  live: { label: 'no ar', variant: 'live' },
  pending: { label: 'pendente', variant: 'warn' },
  failed: { label: 'falhou', variant: 'bad' },
  rolled_back: { label: 'revertida', variant: 'outline' },
  superseded: { label: 'substituída', variant: 'default' },
};

export const DEPLOY_KIND: Record<DeploymentKind, string> = {
  promote: 'promoção',
  auto: 'automática',
  provision: 'provisionamento',
  rollback: 'reversão',
};

export const PROBE: Record<ProbeStatus, Tone & { dot: string }> = {
  ok: { label: 'ok', variant: 'live', dot: 'bg-stage-live-dot' },
  failing: { label: 'falhando', variant: 'bad', dot: 'bg-destructive' },
  unknown: { label: 'desconhecida', variant: 'default', dot: 'bg-muted-foreground' },
};

export const SEVERITY: Record<FleetSeverity, Tone> = {
  critical: { label: 'crítico', variant: 'bad' },
  warning: { label: 'atenção', variant: 'warn' },
};

export const PROVISION_STEPS: [ProvisionState, string][] = [
  ['release', 'versão'],
  ['verify', 'verificação'],
  ['invite', 'convite'],
  ['live', 'no ar'],
];

export const SOURCE_LABEL: Record<string, string> = { invite: 'convite', signup: 'cadastro' };

const CHECK_LABEL: Record<string, string> = {
  page: 'página',
  loader: 'loader',
  state: 'estado',
  checkout: 'checkout',
};

export const STORE_SUFFIX = '.vendua.com.br';

export const short = (id: string | null | undefined) => (id ? id.slice(0, 7) : '—');

/** "há 11min" / "agora" — the relative stamp every fleet row uses. */
export const ago = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const r = rel(iso);
  return r === 'agora' ? 'agora' : `há ${r}`;
};

/** "16:22" today, "29/09 16:22" before — fits a narrow time column. */
export const stamp = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
};

export const kb = (bytes: number | undefined) =>
  bytes == null ? '—' : `${Math.round(bytes / 1024).toLocaleString('pt-BR')} KB`;

/** health_checks.checks may arrive as a JSON string (jsonb stored as text) — accept both. */
export function parseChecks(v: unknown): ProbeCheck[] {
  let x = v;
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? (x as ProbeCheck[]) : [];
}

export function ToneTag<K extends string>({
  map,
  value,
  className,
  title,
}: {
  map: Record<K, Tone>;
  value: K | null | undefined;
  className?: string | undefined;
  title?: string | undefined;
}) {
  if (!value) return <span className="text-xs text-muted-foreground/70">—</span>;
  const t = map[value] ?? { label: value, variant: 'default' as const };
  return (
    <Badge variant={t.variant} className={className} title={title}>
      {t.label}
    </Badge>
  );
}

export function ProbeChip({ status }: { status: ProbeStatus | null | undefined }) {
  const t = PROBE[status ?? 'unknown'] ?? PROBE.unknown;
  return (
    <Badge variant={t.variant}>
      <span className={cn('size-1.5 rounded-full', t.dot)} />
      {t.label}
    </Badge>
  );
}

export function SeverityDot({ severity, quiet }: { severity: FleetSeverity; quiet?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        severity === 'critical' ? 'bg-destructive' : 'bg-warning',
        quiet && 'opacity-40',
      )}
    />
  );
}

/** Public host as a link that never swallows the row click. */
export function HostLink({ host, className }: { host: string | null; className?: string }) {
  if (!host) return <span className="text-xs text-muted-foreground/70">sem domínio</span>;
  return (
    <a
      href={`https://${host}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline',
        className,
      )}
    >
      <span className="truncate">{host}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-[11.5px] tracking-tight', className)}>{children}</span>
  );
}

/** versão → verificação → convite → no ar, the current step bold; `error` tints it amber. */
export function ProvisionProgress({
  state,
  error,
  className,
}: {
  state: ProvisionState;
  error?: boolean | undefined;
  className?: string | undefined;
}) {
  const idx = Math.max(
    0,
    PROVISION_STEPS.findIndex(([s]) => s === state),
  );
  const done = state === 'live';
  return (
    <ol aria-label="progresso" className={cn('grid grid-cols-4 gap-1', className)}>
      {PROVISION_STEPS.map(([s, label], i) => {
        const current = i === idx && !done;
        return (
          <li key={s} className="flex min-w-0 flex-col gap-1" aria-current={current || undefined}>
            <span
              className={cn(
                'h-1 rounded-full bg-muted',
                (i < idx || done) && 'bg-success dark:bg-agent/80',
                current && (error ? 'bg-warning' : 'bg-primary dark:bg-agent'),
              )}
            />
            <span
              className={cn(
                'truncate text-[11px] text-muted-foreground',
                current && 'font-semibold text-foreground',
                current && error && 'text-warning-foreground',
                done && i === 3 && 'font-semibold text-foreground',
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** page / loader / state / checkout ✓/✗ with the failing detail. */
export function CheckList({ checks }: { checks: ProbeCheck[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {checks.map((c) => (
        <li key={c.id} className="flex min-w-0 items-center gap-1.5">
          {c.ok ? (
            <Check className="size-3.5 shrink-0 text-success" />
          ) : (
            <X className="size-3.5 shrink-0 text-destructive-foreground" />
          )}
          <span className={cn('shrink-0', !c.ok && 'font-medium text-destructive-foreground')}>
            {CHECK_LABEL[c.id] ?? c.id}
          </span>
          {c.detail && <span className="truncate text-muted-foreground">{c.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
