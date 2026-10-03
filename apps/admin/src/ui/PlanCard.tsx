import {
  ChatCircleDots,
  CheckCircle,
  CookingPot,
  Gift,
  Globe,
  type Icon,
  MagicWand,
  Printer,
  Receipt,
  Sparkle,
  Storefront,
  Ticket,
  Coins,
} from '@phosphor-icons/react';
import type { Plan, PlanFeature } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { cn } from './cn.ts';
import { Skeleton } from './feedback.tsx';

// What a plan includes, said from its feature flags and limits (Core's plans rows), so a renamed
// or repriced plan never needs a UI change. Prices always come from `priceCents`.

export const perMonth = (p: Pick<Plan, 'priceCents'>) =>
  p.priceCents === null ? null : `${money(p.priceCents)}/mês`;

/** "Venduá Bandeira" → "Bandeira", for "tudo do Bandeira, e mais:" */
export const shortName = (p: Pick<Plan, 'name'>) => p.name.replace(/^Venduá\s+/i, '');

const count = (n: number) => n.toLocaleString('pt-BR');

export interface Perk {
  key: string;
  text: string;
  /** said after the text, kept on one line ("250 conversas/mês") */
  extra?: string;
  sub: string;
  Icon: Icon;
  /** the features it stands for: a plan without one of them doesn't have it */
  needs: PlanFeature[];
}

export function perksOf(
  plan: Plan,
  address: string,
  opts: { trial?: boolean | undefined } = {},
): Perk[] {
  const f = plan.features;
  const out: Perk[] = [
    {
      key: 'store',
      text: `Sua loja em ${address}`,
      sub: 'cardápio, pedidos e Pix',
      Icon: Storefront,
      needs: [],
    },
    {
      key: 'coupons',
      text: 'Cupons de desconto',
      sub: 'para trazer gente nova para a loja',
      Icon: Ticket,
      needs: [],
    },
  ];
  if (f.kds && f.printing)
    out.push({
      key: 'kitchen',
      text: 'Cozinha (KDS) e impressão automática',
      sub: 'o pedido aparece na tela e sai impresso na cozinha',
      Icon: CookingPot,
      needs: ['kds', 'printing'],
    });
  else if (f.kds)
    out.push({
      key: 'kitchen',
      text: 'Cozinha (KDS)',
      sub: 'os pedidos numa tela, na ordem de preparo',
      Icon: CookingPot,
      needs: ['kds'],
    });
  else if (f.printing)
    out.push({
      key: 'kitchen',
      text: 'Impressão automática',
      sub: 'o pedido sai impresso na cozinha',
      Icon: Printer,
      needs: ['printing'],
    });
  if (f.loyalty)
    out.push({
      key: 'loyalty',
      text: 'Cartão fidelidade',
      sub: 'a cada pedido entregue, o cliente ganha um selo',
      Icon: Gift,
      needs: ['loyalty'],
    });
  if (f.vendedor)
    out.push({
      key: 'vendedor',
      text: 'Vendedor com IA no WhatsApp',
      extra: `${count(plan.aiConversations)} conversas/mês`,
      sub:
        opts.trial && plan.trialDays > 0 && plan.aiTrialConversations > 0
          ? `${count(plan.aiTrialConversations)} conversas no teste grátis`
          : 'cada cliente conta uma vez a cada 24 h',
      Icon: ChatCircleDots,
      needs: ['vendedor'],
    });
  if (f.customDomain && f.customSite)
    out.push({
      key: 'site',
      text: 'Domínio próprio e site feito pelo nosso agente de IA',
      sub: 'como www.sualoja.com.br',
      Icon: Globe,
      needs: ['customDomain', 'customSite'],
    });
  else if (f.customDomain)
    out.push({
      key: 'site',
      text: 'Seu domínio próprio',
      sub: 'como www.sualoja.com.br',
      Icon: Globe,
      needs: ['customDomain'],
    });
  else if (f.customSite)
    out.push({
      key: 'site',
      text: 'Um site feito para a sua loja',
      sub: 'pelo nosso agente de IA',
      Icon: MagicWand,
      needs: ['customSite'],
    });
  out.push(
    plan.feeBps > 0
      ? {
          key: 'fee',
          text: `Taxa da Venduá de ${(plan.feeBps / 100).toLocaleString('pt-BR')}% por pedido`,
          sub: 'o Mercado Pago cobra a tarifa dele nos pagamentos online',
          Icon: Receipt,
          needs: [],
        }
      : {
          key: 'fee',
          text: 'Nenhuma taxa por pedido',
          sub: 'o Mercado Pago cobra a tarifa dele nos pagamentos online',
          Icon: Coins,
          needs: [],
        },
  );
  return out;
}

/** What `plan` has that `base` doesn't: a feature it lacks, or more of the Vendedor. */
export function perksAdded(
  plan: Plan,
  base: Plan,
  address: string,
  opts: { trial?: boolean | undefined } = {},
) {
  return perksOf(plan, address, opts).filter(
    (p) =>
      p.needs.some((f) => !base.features[f]) ||
      (p.key === 'vendedor' &&
        base.features.vendedor &&
        plan.aiConversations > base.aiConversations),
  );
}

/** The plans one can pick, in Core's order (cheapest first): legacy ones carry no price. */
export const publicPlans = (plans: Plan[]) => plans.filter((p) => p.priceCents !== null);

/**
 * The plan before `plan` in that order, when `plan` keeps all of it: its card then says "tudo do
 * <it>, e mais:". Staff toggle features one by one, so a plan that drops one lists all its own.
 */
export function prevOf(plans: Plan[], plan: Plan) {
  const list = publicPlans(plans);
  const i = list.findIndex((p) => p.id === plan.id);
  const prev = i > 0 ? list[i - 1] : undefined;
  if (!prev) return undefined;
  const keeps =
    (Object.keys(prev.features) as PlanFeature[]).every(
      (f) => !prev.features[f] || plan.features[f],
    ) && plan.aiConversations >= prev.aiConversations;
  return keeps ? prev : undefined;
}

/** The first plan up from `current` that adds something to it. */
export function nextUp(plans: Plan[], current: Plan) {
  return publicPlans(plans).find(
    (p) =>
      p.id !== current.id &&
      (current.priceCents === null || p.priceCents! > current.priceCents) &&
      perksAdded(p, current, '').length > 0,
  );
}

/** The cheapest public plan that has `f`. */
export const cheapestWith = (plans: Plan[], f: PlanFeature) =>
  publicPlans(plans)
    .filter((p) => p.features[f])
    .sort((a, b) => a.priceCents! - b.priceCents!)[0];

export function PlanPerks({
  plan,
  address,
  prev,
  trial,
  className,
}: {
  plan: Plan;
  /** "sualoja.vendua.com.br", or the store's real one */
  address: string;
  /** the plan below: only what this one adds is listed, after "tudo do <prev>, e mais:" */
  prev?: Plan | undefined;
  trial?: boolean | undefined;
  className?: string;
}) {
  const list = prev
    ? perksAdded(plan, prev, address, { trial })
    : perksOf(plan, address, { trial });
  return (
    <div className={className}>
      {prev ? (
        <p className="t-label mb-2.5 font-semibold">Tudo do {shortName(prev)}, e mais:</p>
      ) : null}
      <ul className="space-y-2.5">
        {list.map((p) => (
          <li key={p.key} className="flex gap-2.5">
            <CheckCircle
              weight="fill"
              className="mt-0.5 size-5 shrink-0 text-success"
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block break-words font-medium">
                <PerkText p={p} />
              </span>
              <span className="t-caption block text-muted">{p.sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const PerkText = ({ p }: { p: Perk }) => (
  <>
    {p.text}
    {p.extra ? (
      <>
        {' · '}
        <span className="whitespace-nowrap">{p.extra}</span>
      </>
    ) : null}
  </>
);

/** "Recomendado", or what the caller says about the plan ("seu plano"). */
export function PlanBadge({ children, strong }: { children: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        't-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
        strong ? 'bg-spark text-on-spark' : 'bg-sunken text-ink',
      )}
    >
      {strong ? <Sparkle weight="fill" className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
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
