import facts from './screens.facts.json';

// Site-wide facts. Section copy lives in each section component; anything two sections share lives here.

export const site = {
  name: 'Venduá',
  domain: 'https://vendua.com.br',
  description:
    'Uma loja online com a sua cara e um app no celular para tocar o dia: pedidos, cardápio, horários e Pix. Para doceiras, marmitarias, hamburguerias e padarias. A partir de R$ 69,90 por mês.',
  instagram: { url: 'https://www.instagram.com/vendua.digital/', handle: '@vendua.digital' },
  emails: ['vinicius.junquira@vendua.com.br', 'jorge.andre@vendua.com.br'],
};

// The merchant admin, where sign-up lives. A build-time setting (PUBLIC_ADMIN_URL): vite.config.ts
// bakes it into the bundle, and bun (postbuild, tests) reads it from the environment.
const admin = new URL(import.meta.env.PUBLIC_ADMIN_URL || 'https://painel.vendua.com.br');
if (admin.protocol !== 'https:' && admin.hostname !== '127.0.0.1' && admin.hostname !== 'localhost')
  throw new Error('PUBLIC_ADMIN_URL must be https');

/**
 * The three plans exactly as decided (owner, 2026-10-03); prices are display strings, the admin
 * charges from Core. Bandeira is the recommended one: the site's sign-up links preselect it.
 * `trial` is the only free offer (Bandeira, no card) and the only "grátis" postbuild.ts lets through.
 * `available` follows the CRM's flag of the same name (Core answers 409 PLAN_UNAVAILABLE for a closed
 * plan): a closed plan keeps its price and perks but gets no sign-up link.
 */
export const plans = {
  mirim: {
    id: 'mirim',
    name: 'Venduá Mirim',
    short: 'Mirim',
    price: 'R$ 69,90',
    trial: null,
    available: true,
  },
  bandeira: {
    id: 'bandeira',
    name: 'Venduá Bandeira',
    short: 'Bandeira',
    price: 'R$ 169',
    trial: '14 dias grátis',
    available: true,
    /** Duá's monthly conversations, and how many the trial gets */
    conversations: '250',
    trialConversations: '50',
  },
  pangolim: {
    id: 'pangolim',
    name: 'Venduá Pangolim',
    short: 'Pangolim',
    price: 'R$ 449',
    trial: null,
    // closed until Venduá can offer own domains (owner, 2026-10-03)
    available: false,
    conversations: '1.000',
  },
} as const;
export const recommended = plans.bandeira;
export type PlanId = keyof typeof plans;

export const signup = (plano?: PlanId) => {
  if (plano && !plans[plano].available) throw new Error(`${plano} is not open for sign-up`);
  const url = new URL('/admin/comecar', admin);
  if (plano) url.searchParams.set('plano', plano);
  return url.href;
};

/**
 * The fictional store in every screenshot. The numbers come from `screens.facts.json`, which
 * `scripts/assets.ts screens` writes from the same admin it captures, so copy that quotes a screen
 * always matches it.
 */
export const store = {
  name: 'Bolos da Nena',
  owner: facts.owner,
  tagline: 'Bolo de vó, feito hoje.',
  salesToday: facts.salesToday,
  ordersToday: facts.ordersToday,
  /** the order that "arrives" in the hero and on the lock screen */
  newOrder: facts.newOrder,
  earlierOrder: facts.earlierOrder,
  /** the day's recap on the "Seu dia" screen (18h): best seller, busiest hour, % vs the same weekday last week, average ticket */
  dayRecap: facts.seuDia,
};

/** Core's real push payload (packages/core/src/admin/workers.ts): title, body and the one action */
export const push = {
  app: 'Minha loja',
  title: (n: number) => `Pedido #${n} chegou`,
  body: (o: { customer: string; total: string; mode: string }) =>
    `${o.customer} · ${o.total} · ${o.mode}`,
  action: 'aceitar',
};
