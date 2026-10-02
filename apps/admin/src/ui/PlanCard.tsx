import { CheckCircle, Circle, Gift } from '@phosphor-icons/react';
import type { Plan } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { cn } from './cn.ts';
import { Skeleton } from './feedback.tsx';

// What a plan includes, said from its feature flags (Core's plans rows), so a renamed or
// repriced plan never needs a UI change. Prices always come from `priceCents`.

export const perMonth = (p: Pick<Plan, 'priceCents'>) =>
  p.priceCents === null ? null : `${money(p.priceCents)}/mês`;

export function perksOf(plan: Plan, address: string) {
  const fee =
    plan.feeBps > 0
      ? {
          text: `Taxa da Venduá de ${(plan.feeBps / 100).toLocaleString('pt-BR')}% por pedido`,
          sub: 'o Mercado Pago cobra a tarifa dele nos pagamentos online',
        }
      : {
          text: 'Nenhuma taxa da Venduá por pedido',
          sub: 'o Mercado Pago cobra a tarifa dele nos pagamentos online',
        };
  return [
    plan.features.customDomain
      ? { text: 'Seu domínio próprio', sub: 'como www.sualoja.com.br' }
      : { text: `Sua loja em ${address}`, sub: 'sem domínio próprio' },
    plan.features.customSite
      ? { text: 'Um site feito para a sua loja', sub: 'pelo nosso agente de IA' }
      : { text: 'O visual padrão Venduá', sub: 'sem site personalizado' },
    fee,
  ];
}

export function PlanPerks({
  plan,
  address,
  className,
}: {
  plan: Plan;
  /** "sualoja.vendua.com.br", or the store's real one */
  address: string;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-2.5', className)}>
      {perksOf(plan, address).map((p) => (
        <li key={p.text} className="flex gap-2.5">
          <CheckCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <span className="min-w-0">
            <span className="block break-words font-medium">{p.text}</span>
            <span className="t-caption block text-muted">{p.sub}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A plan as a radio card: name, monthly price, what it includes. */
export function PlanOption({
  plan,
  selected,
  onSelect,
  address,
  badge,
  disabled,
  trial,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  address: string;
  badge?: string | undefined;
  disabled?: boolean;
  /** a new store: the plan's free days show (a running subscription never trials again) */
  trial?: boolean;
}) {
  const price = perMonth(plan);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => {
        haptic.tick();
        onSelect();
      }}
      className={cn(
        'relative flex w-full flex-col gap-4 rounded-lg bg-surface p-5 text-left depth-1 transition-[box-shadow,background-color] duration-(--duration-quick)',
        'hover:bg-hover disabled:pointer-events-none disabled:opacity-60',
        selected ? 'ring-2 ring-primary' : 'ring-1 ring-line',
      )}
    >
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="t-title-2">{plan.name}</span>
            {badge ? (
              <span className="t-caption rounded-full bg-spark-soft px-2 py-0.5 font-semibold text-ink">
                {badge}
              </span>
            ) : null}
          </span>
          {price ? (
            <span className="mt-1 block">
              <span className="tnum font-display text-[1.75rem] font-semibold leading-8">
                {money(plan.priceCents!)}
              </span>
              <span className="t-body text-muted">/mês</span>
            </span>
          ) : null}
          {trial && plan.trialDays > 0 ? (
            <span className="t-label mt-2 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-success">
              <Gift weight="fill" className="size-4" aria-hidden /> {plan.trialDays} dias grátis,
              sem cartão
            </span>
          ) : null}
        </span>
        {selected ? (
          <CheckCircle weight="fill" className="size-7 shrink-0 text-primary" aria-hidden />
        ) : (
          <Circle className="size-7 shrink-0 text-faint" aria-hidden />
        )}
      </span>
      <PlanPerks plan={plan} address={address} />
    </button>
  );
}

/** The plan hero while Conta loads. */
export function PlanCardSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="carregando">
      <div className="space-y-4 rounded-lg bg-surface p-5 depth-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-32" />
        <div className="space-y-2.5 pt-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full max-w-sm" />
          ))}
        </div>
        <Skeleton className="h-12 w-40" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="rounded-lg bg-surface p-4 depth-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="mt-3 h-12 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
