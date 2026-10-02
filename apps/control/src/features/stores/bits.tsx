import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type {
  BillingStore,
  CustomDomainStatus,
  IncidentSeverity,
  MpStatus,
  SiteRequestStatus,
  SubscriptionStatus,
} from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';

type Variant = 'default' | 'outline' | 'warn' | 'bad' | 'live' | 'contacted' | 'agent-soft';
type Tone = { label: string; variant: Variant };

export const SUB_STATUS: Record<SubscriptionStatus, Tone> = {
  pending: { label: 'pendente', variant: 'warn' },
  trialing: { label: 'em teste', variant: 'contacted' },
  active: { label: 'ativa', variant: 'live' },
  past_due: { label: 'em atraso', variant: 'bad' },
  cancelled: { label: 'cancelada', variant: 'default' },
};

export const METHOD_LABEL: Record<'card' | 'pix', string> = { card: 'cartão', pix: 'pix' };

export const MP_STATUS: Record<MpStatus, Tone> = {
  connected: { label: 'conectado', variant: 'live' },
  expiring: { label: 'expirando', variant: 'warn' },
  disconnected: { label: 'desconectado', variant: 'bad' },
  restricted: { label: 'restrito', variant: 'bad' },
};

export const DOMAIN_STATUS: Record<CustomDomainStatus, Tone> = {
  pending_dns: { label: 'aguardando dns', variant: 'default' },
  dns_ok: { label: 'dns ok · ativar', variant: 'warn' },
  active: { label: 'ativo', variant: 'live' },
  failed: { label: 'falhou', variant: 'bad' },
};

export const SITE_STATUSES = [
  ['requested', 'pedido'],
  ['in_progress', 'em produção'],
  ['delivered', 'entregue'],
  ['cancelled', 'cancelado'],
] as const satisfies readonly (readonly [SiteRequestStatus, string])[];

export const SITE_STATUS: Record<SiteRequestStatus, Tone> = {
  requested: { label: 'pedido', variant: 'warn' },
  in_progress: { label: 'em produção', variant: 'agent-soft' },
  delivered: { label: 'entregue', variant: 'live' },
  cancelled: { label: 'cancelado', variant: 'default' },
};

export const SEVERITIES = [
  ['info', 'aviso'],
  ['degraded', 'instabilidade'],
  ['outage', 'fora do ar'],
] as const satisfies readonly (readonly [IncidentSeverity, string])[];

export const SEVERITY: Record<IncidentSeverity, Tone> = {
  info: { label: 'aviso', variant: 'outline' },
  degraded: { label: 'instabilidade', variant: 'warn' },
  outage: { label: 'fora do ar', variant: 'bad' },
};

/** Status pill from one of the tone maps; unknown values from a newer Core still render. */
export function Tag<K extends string>({
  map,
  value,
  empty = '—',
  className,
}: {
  map: Record<K, Tone>;
  value: K | null | undefined;
  empty?: ReactNode | undefined;
  className?: string | undefined;
}) {
  if (!value) return <span className="text-xs text-muted-foreground/70">{empty}</span>;
  const t = map[value] ?? { label: value, variant: 'default' as const };
  return (
    <Badge variant={t.variant} className={className}>
      {t.label}
    </Badge>
  );
}

/** Slug that opens the live store in a new tab — never swallows the row click on its own. */
export function StoreLink({ store, className }: { store: BillingStore; className?: string }) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline',
        className,
      )}
    >
      <span className="truncate">{store.slug}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

/** Filter pills with counts — one scrollable row on phones. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count: number | undefined; tone?: 'warn' | undefined }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="no-scrollbar -mx-3 flex min-w-0 gap-1 overflow-x-auto px-3 md:mx-0 md:px-0"
    >
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-hover hover:text-foreground pointer-coarse:h-9',
            'aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground',
          )}
        >
          {o.label}
          <span
            className={cn(
              'text-[11px] tnum',
              o.tone === 'warn' && o.count && value !== o.value
                ? 'rounded-full bg-warning-soft px-1 font-semibold text-warning-foreground'
                : 'opacity-75',
            )}
          >
            {o.count ?? '·'}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Small uppercase section heading used inside sheets. */
export function SheetSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
