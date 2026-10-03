import { json } from '@sveltejs/kit';
import { plans } from '$lib/content';
import { cents } from '$lib/plans/money';

// The built page's catalog, in Core's shape (/site/v1/plans). In production nginx answers
// /precos.json from Core, so this file only serves the preview, the tests and a static host.
export const prerender = true;

const num = (s: string | undefined) => (s ? Number(s.replace(/\./g, '')) : 0);

export function GET() {
  return json({
    plans: Object.values(plans).map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: cents(p.price),
      trialDays: p.trial ? Number(/^(\d+)/.exec(p.trial)?.[1] ?? 0) : 0,
      available: p.available,
      aiConversations: num('conversations' in p ? p.conversations : undefined),
      aiTrialConversations: num('trialConversations' in p ? p.trialConversations : undefined),
      features: p.features,
    })),
  });
}
