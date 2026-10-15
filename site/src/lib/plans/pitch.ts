import { recommended as built, type PlanId } from '$lib/content';
import { plans, type LivePlan } from './live.svelte';
import { cents } from './money';

// What a sign-up link promises, next to it, from the catalog as the CRM has it now (live.svelte.ts):
// the trial, what it costs after, and that no order pays Venduá a fee. The hero, the dawn band of the
// pages per kind of shop and the closing read these, so the three say the same thing, and a trial or
// a price changed in the CRM changes all of them at once.

/** the plan the site's sign-up links preselect */
export const recommended = (): LivePlan => plans[built.id as PlanId];

const open = () => (Object.values(plans) as LivePlan[]).filter((p) => p.available);

/** "14 dias grátis, sem cartão" for the recommended plan, or nothing while it has no trial or is closed */
export const trialLine = (p: LivePlan = recommended()): string | null =>
  p.available && p.trial ? `${p.trial}, sem cartão` : null;

/** the cheapest plan open for sign-up, for "a partir de" */
export const cheapest = (): LivePlan | null => {
  const plans = open();
  if (!plans.length) return null;
  return plans.reduce((a, b) => (cents(b.price) < cents(a.price) ? b : a));
};

/**
 * What comes after the trial, in one line: "Depois, a partir de R$ 69,90 por mês, e nenhuma taxa da
 * Venduá por pedido." Without a trial the line starts at the price; with no plan open it keeps only
 * the fee promise, which holds for every plan.
 */
export const afterLine = (p: LivePlan = recommended()): string => {
  const low = cheapest();
  const fee = 'nenhuma taxa da Venduá por pedido';
  if (!low) return `${fee[0]!.toUpperCase()}${fee.slice(1)}.`;
  const price = open().length > 1 ? `a partir de ${low.price} por mês` : `${low.price} por mês`;
  return trialLine(p)
    ? `Depois, ${price}, e ${fee}.`
    : `${price[0]!.toUpperCase()}${price.slice(1)}, e ${fee}.`;
};
