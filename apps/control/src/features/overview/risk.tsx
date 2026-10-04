import type { CustomerRisk } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';

export const RISK_LABEL: Record<CustomerRisk, string> = {
  cancelled: 'cancelada',
  suspended: 'suspensa',
  past_due: 'inadimplente',
  payment_pending: 'pagamento pendente',
  probe_failing: 'site falhando',
  incident_open: 'incidente aberto',
  whatsapp_down: 'WhatsApp caiu',
  ai_exhausted: 'IA esgotada',
  trial_ending: 'teste acabando',
  no_orders_14d: 'sem pedidos 14d',
  admin_idle_14d: 'painel parado 14d',
};

// red = money or the store is down; amber = needs a nudge soon; gray = a quiet signal
const RISK_TONE: Record<CustomerRisk, 'bad' | 'warn' | 'default'> = {
  cancelled: 'default',
  suspended: 'bad',
  past_due: 'bad',
  payment_pending: 'warn',
  probe_failing: 'bad',
  incident_open: 'bad',
  whatsapp_down: 'bad',
  ai_exhausted: 'warn',
  trial_ending: 'warn',
  no_orders_14d: 'default',
  admin_idle_14d: 'default',
};

/** A store's risk codes (most severe first, as Core orders them) as chips; the rest fold into "+N". */
export function RiskChips({
  risk,
  max,
  className,
}: {
  risk: CustomerRisk[];
  max?: number | undefined;
  className?: string | undefined;
}) {
  if (!risk.length) return null;
  const shown = max != null && risk.length > max ? risk.slice(0, Math.max(1, max)) : risk;
  const rest = risk.slice(shown.length);
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((r) => (
        <Badge key={r} variant={RISK_TONE[r]}>
          {RISK_LABEL[r] ?? r}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Badge variant="outline" title={rest.map((r) => RISK_LABEL[r] ?? r).join(', ')}>
          +{rest.length}
        </Badge>
      )}
    </span>
  );
}
