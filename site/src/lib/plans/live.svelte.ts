import { catalogUrl, plans as built, signupUrl, type PlanId } from '$lib/content';
import { brl, group } from './money';

// The plans as the CRM has them now. The prerendered page carries content.ts's values (crawlers,
// no JS, Core down); once in the browser, Core's public catalog replaces them in place.

export interface LivePlan {
  id: PlanId;
  name: string;
  short: string;
  price: string;
  /** "14 dias grátis", or null without a trial */
  trial: string | null;
  available: boolean;
  /** Duá's conversations a month and in the trial ("1.000"), absent without Duá */
  conversations?: string | undefined;
  trialConversations?: string | undefined;
}

export const plans: Record<PlanId, LivePlan> = $state(
  structuredClone(built) as unknown as Record<PlanId, LivePlan>,
);

/** a sign-up link for a plan the catalog says is open, else none */
export const signupFor = (p: LivePlan) => (p.available ? signupUrl(p.id) : null);

interface CatalogPlan {
  id: string;
  name: string;
  priceCents: number | null;
  trialDays: number;
  available: boolean;
  aiConversations: number;
  aiTrialConversations: number;
  features: { vendedor?: boolean };
}

const count = (n: unknown) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null;

let started = false;

/** Once per page: read the catalog and update what it says about our three plans. */
export async function loadLivePlans(fetcher: typeof fetch = fetch) {
  if (started) return;
  started = true;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetcher(catalogUrl, { signal: ctl.signal, credentials: 'omit' });
    clearTimeout(timer);
    if (!r.ok) return;
    const body = (await r.json()) as { plans?: CatalogPlan[] };
    for (const c of body.plans ?? []) {
      if (!(c.id in plans)) continue;
      const p = plans[c.id as PlanId];
      const cents = count(c.priceCents);
      if (cents && cents >= 100) p.price = brl(cents).replace(' ', ' ');
      if (typeof c.name === 'string' && c.name.trim().length >= 2) {
        p.name = c.name.trim();
        p.short = p.name.replace(/^Venduá\s+/, '');
      }
      const days = count(c.trialDays);
      if (days !== null) p.trial = days > 0 ? `${days} dias grátis` : null;
      if (typeof c.available === 'boolean') p.available = c.available;
      const month = count(c.aiConversations);
      const trial = count(c.aiTrialConversations);
      if (c.features?.vendedor && month) {
        p.conversations = group(month);
        p.trialConversations = trial ? group(trial) : undefined;
      } else if (c.features && !c.features.vendedor) {
        p.conversations = undefined;
        p.trialConversations = undefined;
      }
    }
  } catch {
    /* offline, Core down, a bad answer: the built values stand */
  }
}
