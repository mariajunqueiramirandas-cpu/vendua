import {
  block,
  defineGuard,
  DEFAULT_PROMISES,
  grounded,
  pass,
  withoutRefs,
  type ConversationState,
  type OutputGuard,
} from '@vendua/agent-runtime';

// The verifier's Vendedor rules (sales-agent.md §4.8), on top of the runtime's `grounded`:
// promises only the ledger backs, no allergen claim without the product's own attribute, no
// links the model typed, and nothing sold out offered as if it were there.

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function hasFigure(
  s: Readonly<ConversationState>,
  pred: (id: string, value: unknown) => boolean,
): boolean {
  return Object.values(s.ledger).some((f) => pred(f.id, f.value));
}

const FREE_DELIVERY =
  /\b(entrega|frete|taxa de entrega)\s+(e\s+|sai\s+|fica\s+)?(gratis|gratuita|de graca|zerada)\b/;
const GRANT =
  /\b(te dou|dou|darei|consigo|libero|vou liberar|faco|posso fazer|posso dar|ganhou|ganha)\s+(um |uma |o |a )?(desconto|cupom|brinde|cortesia|abatimento)\b/;
const FREEBIE = /\b(brinde|cortesia|por conta da casa|de graca|gratis)\b/;
const REFUND =
  /\b(reembols\w*|estorn\w*|devolv\w+ (o |seu )?dinheiro|cancel(ei|amos|ado|ar) (o |seu )?pedido)\b/;

/** Promises Core must back: free delivery, a discount, a freebie, a refund or a cancellation. */
export const ledgerPromises: OutputGuard = defineGuard({
  id: 'promises',
  stage: 'output',
  run: (_rendered, ctx) => {
    const text = fold(withoutRefs(ctx.raw));
    const s = ctx.state;
    if (
      FREE_DELIVERY.test(text) &&
      !hasFigure(s, (id, v) => (id === 'cart.fee' || id === 'entrega.taxa') && v === 0)
    )
      return block(
        'promise:free_delivery',
        'Só diga que a entrega é grátis citando {{cart.fee}} ou {{entrega.taxa}} quando a loja calcular zero.',
      );
    if (GRANT.test(text) && !hasFigure(s, (id) => id === 'cupom.valor' || id === 'cart.discount'))
      return block(
        'promise:discount',
        'Desconto ou cupom só os que a loja concedeu (offer_incentive ou apply_coupon). Não ofereça por conta própria.',
      );
    if (FREEBIE.test(text) && !/\b(entrega|frete)\b/.test(text))
      return block('promise:freebie', 'A loja não ofereceu brinde nem cortesia. Não prometa.');
    if (REFUND.test(text))
      return block(
        'promise:refund',
        'Reembolso e cancelamento são da loja: use handoff e diga que a loja resolve.',
      );
    return pass;
  },
});

const ALLERGEN =
  /\b(sem|livre de|nao (tem|contem|leva|vai))\s+(gluten|lactose|leite|amendoim|castanhas?|nozes|ovos?|frutos do mar|camarao|soja)\b|\b(vegan[oa]s?|vegetarian[oa]s?|zero lactose|sem gluten|sem lactose|nao e alergenico)\b/;

/** Allergen and diet claims only through the product's own attribute ({{slug.diet}}). */
export const allergenClaims: OutputGuard = defineGuard({
  id: 'allergens',
  stage: 'output',
  run: (_rendered, ctx) =>
    ALLERGEN.test(fold(withoutRefs(ctx.raw)))
      ? block(
          'allergen',
          'Não afirme nada sobre alergênicos ou dieta por conta própria. Cite {{codigo.diet}} de get_product; se a loja não informou, diga que vai confirmar e use ask_store.',
        )
      : pass,
});

/** Links come only from Core's cards (the sacola, the Pix, the payment page). */
export const noTypedLinks: OutputGuard = defineGuard({
  id: 'links',
  stage: 'output',
  run: (_rendered, ctx) =>
    /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|com\.br|net|app)\b/i.test(withoutRefs(ctx.raw))
      ? block('link', 'Não escreva links. Use send_link ou send_card; a loja põe o link.')
      : pass,
});

/** Sold-out names, from the store pack: offered literally they're blocked; "não temos" is fine. */
function soldOut(s: Readonly<ConversationState>): readonly string[] {
  const pack = s.context.tenant as { catalog?: string[] } | null;
  return (pack?.catalog ?? [])
    .filter((l) => /· (esgotado|indisponível agora)/.test(l))
    .map((l) => l.split(' · ')[1] ?? '')
    .filter((n) => n.length >= 3);
}

export const verifier = grounded({
  promises: [...DEFAULT_PROMISES, /\bchega (em|até) \d/i, /\bfica pronto em \d/i],
});

const NEGATIVE =
  /(?:n[aã]o temos|n[aã]o tem|acabou|esgot\w+|em falta|indispon[ií]vel|sem estoque)\b[^.!?\n]*/gi;

/** A sold-out product offered literally is blocked; saying it's out ("não temos X hoje") is not. */
export const soldOutOffers: OutputGuard = defineGuard({
  id: 'sold_out',
  stage: 'output',
  run: (_rendered, ctx) => {
    const text = ` ${fold(withoutRefs(ctx.raw).replace(NEGATIVE, ' ')).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    const hit = soldOut(ctx.state).find((name) => {
      const needle = fold(name)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      return needle.length >= 3 && text.includes(` ${needle} `);
    });
    return hit
      ? block(
          'sold_out',
          `"${hit}" está esgotado agora: não ofereça. Diga que acabou e sugira algo parecido ou a lista de espera.`,
        )
      : pass;
  },
});

export const VENDEDOR_GUARDS = [
  verifier,
  soldOutOffers,
  ledgerPromises,
  allergenClaims,
  noTypedLinks,
] as const;
