import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import { buildPartyCartTx, partyProfilesTx, quotePartyTx } from '../../../modules/party.ts';
import type { Sql } from '../../../platform/db.ts';
import {
  briefText,
  cartBrief,
  core,
  ensureCart,
  productIdOf,
  thread,
  viewCart,
  type Ctx,
} from './shared.ts';

// Festa calculada F3 (docs/features/festa-calculada.md §4.6): "faz pra 40 pessoas, festa
// infantil" answered with Core's quantities (the same quote the store's /festa page shows), then
// the party in the shopper's bag. Money is the cart's, as for any other line.

type Input = {
  action: 'options' | 'quote' | 'build';
  festa?: string | undefined;
  adults?: number | undefined;
  children?: number | undefined;
  picks?: { group: string; products: string[] }[] | undefined;
};

async function inputOf(ctx: Ctx, i: Input) {
  if (!i.festa) throw new ToolError('Diga qual festa [fN] (use action "options" antes).');
  const profileId = ctx.resolve(i.festa, 'festa');
  const choices: Record<string, string[]> = {};
  for (const p of i.picks ?? []) {
    const groupId = ctx.resolve(p.group, 'grupo');
    choices[groupId] = await Promise.all(p.products.map((ref) => productIdOf(ctx, ref)));
  }
  return { profileId, adults: i.adults ?? 0, children: i.children ?? 0, choices };
}

export const partyTool = defineTool<Input, Sql>({
  name: 'party',
  description:
    'Festa calculada da loja. "options": as festas [fN], os grupos [gN] e os produtos [pN] de cada um. "quote": quantidades para N adultos/crianças com os produtos escolhidos por grupo (nada é salvo). "build": troca a sacola pela festa (o cliente precisa ter concordado). A data é escolhida em set_fulfillment.',
  effect: 'write',
  input: s.object({
    action: s.enum(['options', 'quote', 'build']),
    festa: s.string({ max: 12 }).optional().describe('quote/build: [fN] de options'),
    adults: s.int({ min: 0, max: 1000 }).optional(),
    children: s.int({ min: 0, max: 1000 }).optional(),
    picks: s
      .array(
        s.object({
          group: s.string({ max: 12 }).describe('[gN]'),
          products: s.array(s.string({ max: 80 }), { max: 10 }).describe('[pN] do grupo'),
        }),
        { max: 10 },
      )
      .optional(),
  }),
  run: async (ctx: Ctx, input) => {
    if (input.action === 'options') {
      const profiles = await partyProfilesTx(ctx.tx, ctx.tenantId, true);
      if (!profiles.length) return { content: 'A loja não tem festa calculada.' };
      const lines = profiles.map((p) => {
        const child =
          p.childFactor === 1
            ? 'criança conta inteira'
            : `criança conta ${Math.round(p.childFactor * 100)}%`;
        const groups = p.groups.map((g) => {
          const items = g.products
            .map((x) => `[${ctx.alias('product', x.productId)}] ${x.name} (${x.unitsPerSale} un.)`)
            .join(', ');
          return `  [${ctx.alias('grupo', g.id)}] ${g.name}: ${g.perGuest.toLocaleString('pt-BR')} por pessoa, escolha até ${g.maxChoices}${g.required ? '' : ' (opcional)'}: ${items}`;
        });
        return [
          `[${ctx.alias('festa', p.id)}] ${p.name} (${p.minGuests}–${p.maxGuests} pessoas; ${child})${p.description ? ` — ${p.description}` : ''}`,
          ...groups,
        ].join('\n');
      });
      return { content: lines.join('\n') };
    }
    const q = await inputOf(ctx, input);
    if (input.action === 'quote') {
      const quote = await core(() => quotePartyTx(ctx.tx, ctx.tenantId, q));
      return {
        content: [
          `Para ${quote.guests} pessoas:`,
          ...quote.lines.map(
            (l) => `- ${l.qty}× [${ctx.alias('product', l.productId)}] ${l.name} (${l.reason})`,
          ),
          'O total sai da sacola (build). É encomenda: precisa de data.',
        ].join('\n'),
        data: { quote: quote as unknown as Json },
      };
    }
    const t = await thread(ctx, { forUpdate: true });
    const cartId = await ensureCart(ctx, t);
    const { quote, report } = await core(() => buildPartyCartTx(ctx.tx, ctx.tenantId, cartId, q));
    await ctx.tx`update shopper_threads set summary = null, stage = 'building', updated_at = now() where id = ${t.id}`;
    const cart = await viewCart(ctx, { ...t, cartId });
    const brief = cartBrief(ctx, cart, { ...t, cartId });
    const skipped = report.skipped.map((sk) => `${sk.slug ?? 'item'} (${sk.message})`);
    return {
      content: [
        `Festa para ${quote.guests} pessoas na sacola (o que havia nela saiu).`,
        skipped.length ? `Não deu para incluir: ${skipped.join('; ')}.` : '',
        'É encomenda: combine a data com set_fulfillment (scheduled_for).',
        briefText(brief),
      ]
        .filter(Boolean)
        .join('\n'),
      data: { cart: brief as unknown as Json },
    };
  },
});
