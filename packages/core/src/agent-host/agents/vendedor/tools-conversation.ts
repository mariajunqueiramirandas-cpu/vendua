import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import { subscribeNotifyTx } from '../../../modules/storefront-platform.ts';
import type { Sql } from '../../../platform/db.ts';
import { brl } from '../../../vendedor/cards.ts';
import { grantIncentiveTx } from '../../../vendedor/incentives.ts';
import { loadAgent } from '../../../vendedor/settings.ts';
import { suggestFor } from '../../../vendedor/suggest.ts';
import { custom } from './fold.ts';
import { handoffTx, HANDOFF_REASONS } from './handoff.ts';
import { briefText, cartBrief, pack, productIdOf, thread, viewCart, type Ctx } from './shared.ts';
import { phoneKeys } from '../../../store-whatsapp/text.ts';

export const handoffTool = defineTool<
  { reason: (typeof HANDOFF_REASONS)[number]; summary: string },
  Sql
>({
  name: 'handoff',
  description:
    'Passa a conversa para uma pessoa da loja: reclamação, atraso, alergia que a loja não informou, pagamento contestado, pedido fora do comum ou quando o cliente pede. Depois responda UMA vez dizendo que a loja vai responder.',
  effect: 'write',
  input: s.object({
    reason: s.enum(HANDOFF_REASONS),
    summary: s.string({ min: 3, max: 200 }).describe('uma linha para a loja: o que o cliente quer'),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    const data = await handoffTx(ctx, t, input.reason, input.summary);
    const p = pack(ctx);
    const closed = p.status.status !== 'open';
    return {
      content: `Passado para a loja. Responda uma vez que alguém da loja vai continuar${closed ? ' quando a loja abrir (use store_info para dizer quando)' : ' em instantes'}; depois disso você não responde mais esta conversa.`,
      data: data as unknown as Json,
    };
  },
});

const MEMORY_KEYS = [
  'nome',
  'idioma',
  'preferencia',
  'endereco_nota',
  'alergia',
  'restricao',
] as const;

export const rememberTool = defineTool<
  { key: (typeof MEMORY_KEYS)[number]; value: string; consent?: boolean | undefined },
  Sql
>({
  name: 'remember',
  description:
    'Guarda algo do cliente para os próximos pedidos: nome, idioma, preferência ("massa bem assada", "sem cebola no X-Salada"), nota de endereço. Alergia e restrição só depois de perguntar "Quer que eu lembre disso nos próximos pedidos?" e ouvir sim (consent: true).',
  effect: 'write',
  input: s.object({
    key: s.enum(MEMORY_KEYS),
    value: s.string({ min: 1, max: 200 }),
    consent: s.boolean().optional(),
  }),
  run: (ctx: Ctx, input) => {
    const sensitive = input.key === 'alergia' || input.key === 'restricao';
    if (sensitive && !input.consent)
      throw new ToolError(
        'Alergia e restrição só com o sim do cliente: pergunte antes se ele quer que você lembre.',
      );
    const key =
      input.key === 'preferencia' || input.key === 'endereco_nota' || sensitive
        ? `${input.key}.${input.value
            .toLowerCase()
            .replace(/[^a-z0-9à-ú]+/g, '_')
            .slice(0, 30)}`
        : input.key;
    ctx.proposeMemory({ key, value: input.value, confidence: 1, consent: input.consent ?? false });
    return { content: 'Anotado para os próximos pedidos.' };
  },
});

export const forgetTool = defineTool<{ key: string }, Sql>({
  name: 'forget_fact',
  description:
    'Esquece algo que você guardou do cliente quando ele pede ("esquece minha alergia"). Use a chave mostrada em "O que se sabe".',
  effect: 'write',
  input: s.object({ key: s.string({ min: 1, max: 80 }) }),
  run: (ctx: Ctx, input) => {
    const keys = ctx.state.memory.map((m) => m.key);
    const hits = keys.filter((k) => k === input.key || k.startsWith(`${input.key}.`));
    if (!hits.length) return { content: 'Nada guardado com essa chave.' };
    for (const k of hits) ctx.forgetMemory(k);
    return { content: 'Esquecido.' };
  },
});

export const muteMeTool = defineTool<Record<string, never>, Sql>({
  name: 'stop_replying',
  description:
    'O cliente pediu para você parar de responder ("pare de me responder"). Você para nesta conversa; a loja ainda pode falar com ele.',
  effect: 'write',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    await ctx.tx`update shopper_threads set owner = 'muted', owner_reason = 'o cliente pediu',
      updated_at = now() where id = ${ctx.subject.id}`;
    return {
      content: 'Ok. Responda uma última vez, curto, que a loja continua à disposição por aqui.',
    };
  },
});

export const joinWaitlistTool = defineTool<{ product: string }, Sql>({
  name: 'join_waitlist',
  description:
    'Coloca o cliente na lista de espera de um produto esgotado; ele recebe um aviso aqui quando voltar.',
  effect: 'write',
  input: s.object({ product: s.string({ min: 1, max: 80 }) }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx);
    if (!t.phone || t.phone.startsWith('+'))
      throw new ToolError('Sem o número do cliente não dá para avisar.');
    const productId = await productIdOf(ctx, input.product);
    await subscribeNotifyTx(ctx.tx, ctx.tenantId, {
      subject: 'product',
      productId,
      phone: t.phone,
    });
    return { content: 'Na lista de espera. Diga que você avisa aqui quando voltar.' };
  },
});

export const suggestTool = defineTool<Record<string, never>, Sql>({
  name: 'suggest',
  description:
    'Sugestões calculadas pela loja para esta sacola (o que costuma ir junto, combo mais barato, o de costume do cliente). Ofereça no máximo UMA por pedido, depois dos itens principais e antes do resumo; nunca numa reclamação ou depois de um "só isso".',
  effect: 'read',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const c = custom(ctx.state);
    if (!pack(ctx).agent.capabilities.suggest) return { content: 'A loja não quer sugestões.' };
    if (c.suggestion.offered)
      return { content: 'Você já sugeriu algo neste pedido. Não sugira de novo.' };
    const t = await thread(ctx);
    const cart = await viewCart(ctx, t);
    if (!cart?.items.length) return { content: 'Sacola vazia: nada a sugerir ainda.' };
    const agent = await loadAgent(ctx.tx, ctx.tenantId);
    const list = await suggestFor(ctx.tx, ctx.tenantId, cart, {
      phone: t.phone,
      settings: agent.settings,
      declined: c.suggestion.declined,
    });
    if (!list.length) return { content: 'Nenhuma sugestão boa agora. Siga para o resumo.' };
    return {
      content: list
        .map((sg) => {
          const a = ctx.alias('product', sg.productId);
          ctx.figure(`${a}.name`, { value: sg.productId, text: sg.name, kind: 'product' });
          ctx.figure(`${a}.price`, {
            value: sg.priceCents,
            text: brl(sg.priceCents),
            kind: 'money',
          });
          ctx.figure(`${a}.motivo`, { value: sg.source, text: sg.reason, kind: 'text' });
          if (sg.savingCents)
            ctx.figure(`${a}.economia`, {
              value: sg.savingCents,
              text: brl(sg.savingCents),
              kind: 'money',
            });
          return `[${a}] {{${a}.name}} {{${a}.price}} · por quê: {{${a}.motivo}}${sg.savingCents ? ` · economia {{${a}.economia}}` : ''} (${sg.source})`;
        })
        .join('\n')
        .concat('\nSe oferecer, chame offer_suggestion com o id antes de responder.'),
      data: { suggestions: list.map((x) => x.productId) },
    };
  },
});

export const offerSuggestionTool = defineTool<
  { product: string; outcome?: 'offered' | 'declined' | undefined },
  Sql
>({
  name: 'offer_suggestion',
  description:
    'Registra a sugestão que você vai oferecer (outcome offered), ou que o cliente recusou (declined). Uma por pedido.',
  effect: 'write',
  input: s.object({
    product: s.string({ min: 1, max: 12 }),
    outcome: s.enum(['offered', 'declined']).optional(),
  }),
  run: async (ctx: Ctx, input) => {
    const productId = ctx.resolve(input.product, 'product');
    const c = custom(ctx.state);
    const outcome = input.outcome ?? 'offered';
    if (outcome === 'offered') {
      if (c.suggestion.offered) throw new ToolError('Já houve uma sugestão neste pedido.');
      const reason = ctx.state.ledger[`${input.product}.motivo`];
      const price = ctx.state.ledger[`${input.product}.price`];
      await ctx.tx`
        insert into suggestion_events (tenant_id, thread_id, product_id, source, reason, price_cents)
        values (${ctx.tenantId}, ${ctx.subject.id}, ${productId},
                ${String(reason?.value ?? 'basket')}, ${(reason?.text ?? 'sugestão').slice(0, 300)},
                ${typeof price?.value === 'number' ? price.value : null})`;
      return {
        content: 'Sugestão registrada; ofereça em uma frase, sem insistir.',
        data: { suggested: productId },
      };
    }
    await ctx.tx`
      update suggestion_events set outcome = 'declined', decided_at = now()
      where tenant_id = ${ctx.tenantId} and thread_id = ${ctx.subject.id} and product_id = ${productId} and outcome = 'offered'`;
    return { content: 'Ok, não ofereça de novo.', data: { declined: productId } };
  },
});

type Grant = Awaited<ReturnType<typeof grantIncentiveTx>>;
type Savepointable = { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };

class Rehearsed extends Error {
  constructor(readonly grant: Grant) {
    super('rehearsal');
  }
}

export const offerIncentiveTool = defineTool<
  { reason: 'recovery' | 'first_order' | 'hesitation' },
  Sql
>({
  name: 'offer_incentive',
  description:
    'Pede à loja um cupom do orçamento que ela mesma definiu (motivo: recovery para sacola parada, first_order para primeiro pedido, hesitation quando o cliente hesita pelo preço). A loja decide; sem política, não há cupom.',
  effect: 'money',
  input: s.object({ reason: s.enum(['recovery', 'first_order', 'hesitation']) }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    if (t.channel === 'test')
      return { content: 'Conversa de teste: a loja não concede cupons aqui.' };
    const cart = await viewCart(ctx, t);
    if (!cart?.items.length) throw new ToolError('Sacola vazia.');
    if (input.reason === 'first_order') {
      const [o] = await ctx.tx<{ n: number }[]>`
        select count(*)::int as n from orders where tenant_id = ${ctx.tenantId} and customer_phone = any(${phoneKeys(t.phone)})`;
      if ((o?.n ?? 0) > 0) return { content: 'Não é o primeiro pedido deste cliente: sem cupom.' };
    }
    const agent = await loadAgent(ctx.tx, ctx.tenantId);
    const proven = t.channel === 'whatsapp' && t.phone && !t.phone.startsWith('+') ? t.phone : null;
    const grant = (tx: Sql) =>
      grantIncentiveTx(tx, ctx.tenantId, {
        threadId: t.id,
        phone: proven,
        reason: input.reason,
        cart,
        settings: agent.settings,
        guards: pack(ctx).guards,
        now: ctx.now,
      });
    if ((ctx.state.context.subject as { floor?: string } | null)?.floor === 'rehearsal') {
      // Ensaio only drafts: the grant runs and rolls back, so no coupon exists and no budget is spent
      const w = await (ctx.tx as unknown as Savepointable)
        .savepoint(async (sp) => {
          throw new Rehearsed(await grant(sp));
        })
        .catch((e: unknown) => {
          if (e instanceof Rehearsed) return e.grant;
          throw e;
        });
      if (!w.ok) return { content: `Sem cupom agora (${w.reason}). Não mencione desconto.` };
      ctx.figure('cupom.valor', { value: w.valueCents, text: brl(w.valueCents), kind: 'money' });
      return {
        content:
          'Ensaio: a loja concederia um cupom de até {{cupom.valor}}, mas nada foi criado nem aplicado. Escreva como ofereceria.',
        data: { incentive: null },
      };
    }
    const g = await grant(ctx.tx);
    if (!g.ok) return { content: `Sem cupom agora (${g.reason}). Não mencione desconto.` };
    const { applyCouponTx } = await import('../../../modules/cart-ops.ts');
    await applyCouponTx(ctx.tx, ctx.tenantId, t.cartId!, g.code, proven, proven);
    await ctx.tx`update shopper_threads set summary = null, updated_at = now() where id = ${t.id}`;
    const fresh = await viewCart(ctx, t);
    const brief = cartBrief(ctx, fresh, t);
    ctx.figure('cupom.codigo', { value: g.code, text: g.code, kind: 'text' });
    ctx.figure('cupom.valor', { value: g.valueCents, text: brl(g.valueCents), kind: 'money' });
    return {
      content: `A loja concedeu o cupom {{cupom.codigo}} (até {{cupom.valor}}), já aplicado.\n${briefText(brief)}`,
      data: { cart: brief as unknown as Json, incentive: g.code },
    };
  },
});
