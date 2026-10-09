import type { CustomerRisk, CustomerRow } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, rel } from '@/lib/format.ts';
import { METHOD_LABEL, SUB_STATUS, Tag } from './bits.tsx';

/** Spec order, most severe first; `cancelled` ranks below every live risk. */
const SEVERITY: CustomerRisk[] = [
  'suspended',
  'past_due',
  'payment_pending',
  'probe_failing',
  'incident_open',
  'whatsapp_down',
  'ai_exhausted',
  'trial_ending',
  'no_orders_14d',
  'admin_idle_14d',
];

/** Sort weight: the worst risk dominates, more risks break ties. */
export function riskWeight(risk: CustomerRisk[]): number {
  const live = risk.filter((r) => r !== 'cancelled');
  if (!live.length) return risk.length ? -1 : 0;
  const worst = Math.min(...live.map((r) => SEVERITY.indexOf(r)).map((i) => (i < 0 ? 99 : i)));
  return (SEVERITY.length - worst) * 100 + live.length;
}

export function SubChip({
  sub,
  withMethod,
}: {
  sub: CustomerRow['subscription'];
  withMethod?: boolean | undefined;
}) {
  if (!sub) return <span className="text-xs text-muted-foreground/70">sem assinatura</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tag map={SUB_STATUS} value={sub.status} />
      {withMethod && sub.method && (
        <span className="text-xs text-muted-foreground">
          {METHOD_LABEL[sub.method as 'card' | 'pix'] ?? sub.method}
        </span>
      )}
    </span>
  );
}

type AiUse = Pick<CustomerRow['ai'], 'included' | 'used' | 'limit' | 'remaining' | 'packRemaining'>;

/** Conversations used of the allowance; red when nothing is left. */
export function AiMeter({ ai, className }: { ai: AiUse; className?: string | undefined }) {
  if (!ai.included)
    return (
      <span
        className={cn('text-xs text-muted-foreground/70', className)}
        title="o plano não inclui o Vendedor"
      >
        sem IA
      </span>
    );
  const out = ai.remaining <= 0;
  const pct = ai.limit > 0 ? Math.min(100, (ai.used / ai.limit) * 100) : out ? 100 : 0;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`${ai.used} de ${ai.limit} conversas${ai.packRemaining ? ` · +${ai.packRemaining} em pacote` : ''}`}
    >
      <span className="h-1 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className={cn('block h-full rounded-full', out ? 'bg-destructive' : 'bg-agent')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={cn('text-xs tnum', out && 'font-medium text-destructive-foreground')}>
        {ai.used}/{ai.limit}
      </span>
      {ai.packRemaining > 0 && (
        <span className="text-[11px] text-muted-foreground tnum">+{ai.packRemaining}</span>
      )}
    </span>
  );
}

/** "3d" since the last order, with the exact time on hover. */
export function LastOrder({
  at,
  className,
}: {
  at: string | null;
  className?: string | undefined;
}) {
  if (!at) return <span className={cn('text-muted-foreground/70', className)}>nenhum</span>;
  return (
    <span className={cn('tnum', className)} title={fmtDateTime(at)}>
      {rel(at)}
    </span>
  );
}
