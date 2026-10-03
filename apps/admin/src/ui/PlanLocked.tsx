import {
  ArrowRight,
  CheckCircle,
  CookingPot,
  Gift,
  type Icon,
  Info,
  Lock,
  Printer,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { api, type Plan, type PlanFeature } from '../lib/api.ts';
import { qk } from '../lib/query.ts';
import { can, useSession } from '../lib/session.ts';
import { ButtonLink } from './Button.tsx';
import { Card } from './Card.tsx';
import { cn } from './cn.ts';
import { Skeleton } from './feedback.tsx';
import { PageBody, PageHeader } from './Page.tsx';
import { cheapestWith, perMonth, PlanBadge } from './PlanCard.tsx';

// A feature the store's plan doesn't open: the screen stays reachable and becomes the upsell.
// Which plan has it comes from the public plan list (cheapest first), never from a hardcoded id.

type Locked = Extract<PlanFeature, 'kds' | 'printing' | 'loyalty'>;

// `g`: the article, so the sentences agree ("liberada" / "liberado")
const COPY: Record<Locked, { name: string; g: 'a' | 'o'; Icon: Icon; points: string[] }> = {
  kds: {
    name: 'A Cozinha',
    g: 'a',
    Icon: CookingPot,
    points: [
      'Os pedidos numa tela, na ordem em que entram',
      'Cada item marcado quando fica pronto, por estação',
      'Um painel com os números prontos para os clientes',
    ],
  },
  printing: {
    name: 'A impressão automática',
    g: 'a',
    Icon: Printer,
    points: [
      'O pedido sai impresso na cozinha, sem ninguém apertar nada',
      'Funciona com um computador Windows ou um celular Android',
      'A comanda sai de novo quando você quiser',
    ],
  },
  loyalty: {
    name: 'O cartão fidelidade',
    g: 'o',
    Icon: Gift,
    points: [
      'A cada pedido entregue, o cliente ganha um selo',
      'Com os selos, ele ganha o prêmio que você escolher',
      'Quem já comprou ganha um motivo para voltar',
    ],
  },
};

export function PlanLocked({
  feature,
  reason,
  refresh,
  compact,
  className,
  plans: given,
}: {
  feature: Locked;
  /** the plan list, when the caller has it (the style reference) */
  plans?: Plan[];
  /** Core said why (403 PLAN_REQUIRED details) */
  reason?: string | undefined;
  /** the session said open but Core refused: fetch the session again so the app agrees */
  refresh?: boolean | undefined;
  /** inside a Section that already names the feature */
  compact?: boolean;
  className?: string;
}) {
  const session = useSession();
  const qc = useQueryClient();
  const owner = can(session.user.role, 'owner');
  const plans = useQuery({
    queryKey: qk.signupPlans,
    queryFn: api.signup.plans,
    staleTime: 5 * 60_000,
    enabled: !given,
  });
  useEffect(() => {
    if (refresh) void qc.invalidateQueries({ queryKey: qk.session });
  }, [refresh, qc]);

  const list = given ?? plans.data?.plans ?? [];
  const mine = list.find((p) => p.id === session.plan?.id);
  // the plan has it, the payment doesn't yet
  const unpaid = reason === 'unpaid' || !!mine?.features[feature];
  const plan = unpaid ? mine : cheapestWith(list, feature);
  const c = COPY[feature];
  const H = compact ? 'h3' : 'h2';

  let headline: ReactNode;
  if (unpaid) headline = `${c.name} libera com o pagamento do plano`;
  else if (plan)
    headline = (
      <>
        {c.name} faz parte do <span className="whitespace-nowrap">{plan.name}</span>
      </>
    );
  else headline = `${c.name} faz parte de outro plano`;

  return (
    <Card className={cn('relative overflow-hidden', compact ? 'p-5' : 'p-5 md:p-8', className)}>
      <div
        aria-hidden
        className="absolute -right-14 -top-14 size-48 rounded-full bg-spark opacity-20 blur-3xl"
      />
      <div className={cn('relative flex flex-col gap-5', !compact && 'md:flex-row md:gap-7')}>
        <span
          className={cn(
            'relative grid shrink-0 place-items-center rounded-2xl bg-spark-soft text-ink',
            compact ? 'size-14' : 'size-16 md:size-20',
          )}
          aria-hidden
        >
          <c.Icon weight="duotone" className={compact ? 'size-7' : 'size-8 md:size-10'} />
          <span className="absolute -bottom-1.5 -right-1.5 grid size-8 place-items-center rounded-full bg-surface depth-1">
            <Lock weight="fill" className="size-4" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          {plan ? (
            <p className="t-caption mb-2 flex flex-wrap items-center gap-2 text-muted">
              {unpaid ? 'no seu plano' : 'a partir do'}
              <PlanBadge strong={plan.recommended}>{plan.name}</PlanBadge>
              {!unpaid && perMonth(plan) ? (
                <span className="tnum font-semibold text-ink">{perMonth(plan)}</span>
              ) : null}
            </p>
          ) : !given && plans.isPending ? (
            <Skeleton className="mb-2 h-6 w-44" />
          ) : null}
          <H className={cn('break-words', compact ? 't-title-2' : 't-title-1')}>{headline}</H>
          <p className="t-body mt-1 max-w-prose text-muted">
            {unpaid
              ? `${c.g === 'a' ? 'Ela' : 'Ele'} já está no seu plano e fica liberad${c.g} assim que o pagamento entrar.`
              : `Seu plano atual não tem. Com ${c.g === 'a' ? 'ela' : 'ele'}:`}
          </p>
          <ul className="mt-4 space-y-2">
            {c.points.map((p) => (
              <li key={p} className="t-body flex gap-2.5">
                <CheckCircle
                  weight="fill"
                  className="mt-0.5 size-5 shrink-0 text-success"
                  aria-hidden
                />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
          {owner ? (
            <ButtonLink
              to="/conta"
              variant={unpaid ? 'primary' : 'spark'}
              className="mt-5 max-sm:w-full"
            >
              {unpaid ? 'ver em Conta e plano' : plan ? `conhecer o ${plan.name}` : 'ver os planos'}
              <ArrowRight />
            </ButtonLink>
          ) : (
            <p className="t-body mt-5 flex gap-2 rounded-md bg-sunken p-3">
              <Info className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <span>
                Para liberar, peça ao dono da loja: o plano fica em <strong>Conta e plano</strong>.
              </span>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** A whole screen behind the plan: its header, then the lock. */
export function LockedPage({
  title,
  feature,
  reason,
  refresh,
}: {
  title: string;
  feature: Locked;
  reason?: string | undefined;
  refresh?: boolean | undefined;
}) {
  return (
    <PageBody>
      <PageHeader title={title} />
      <PlanLocked feature={feature} reason={reason} refresh={refresh} />
    </PageBody>
  );
}

/** Core's reason on a PLAN_REQUIRED, when it gave one. */
export const reasonOf = (e: unknown) => {
  const r = (e as { details?: { reason?: unknown } } | null)?.details?.reason;
  return typeof r === 'string' ? r : undefined;
};
