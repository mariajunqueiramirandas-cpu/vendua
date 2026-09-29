import facts from './screens.facts.json';

// Site-wide facts. Section copy lives in each section component; anything two sections share lives here.

export const site = {
  name: 'Venduá',
  domain: 'https://vendua.com.br',
  description:
    'Uma loja online com a sua cara e um app no celular para tocar o dia: pedidos, cardápio, horários e Pix. Para doceiras, marmitarias, hamburguerias e padarias. Em breve.',
  instagram: { url: 'https://www.instagram.com/vendua.digital/', handle: '@vendua.digital' },
  emails: ['vinicius.junquira@vendua.com.br', 'jorge.andre@vendua.com.br'],
  /** every call to action reads this until sign-up opens */
  soon: 'Em breve',
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
};

/** Core's real push payload (packages/core/src/admin/workers.ts): title, body and the one action */
export const push = {
  app: 'Minha loja',
  title: (n: number) => `Pedido #${n} chegou`,
  body: (o: { customer: string; total: string; mode: string }) =>
    `${o.customer} · ${o.total} · ${o.mode}`,
  action: 'aceitar',
};
