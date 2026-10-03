import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import { addItem, type CartDelivery } from '../../../modules/cart.ts';
import {
  applyCouponTx,
  removeLineTx,
  setDeliveryTx,
  setLineQtyTx,
} from '../../../modules/cart-ops.ts';
import { importLines, orderLines } from '../../../modules/cart-share.ts';
import { getProductById } from '../../../modules/catalog.ts';
import { normalizeCep } from '../../../modules/geo.ts';
import { isPaymentMethod, type PaymentMethod } from '../../../modules/payment-adjustments.ts';
import type { Sql } from '../../../platform/db.ts';
import { brl } from '../../../vendedor/cards.ts';
import { fold } from '../../../vendedor/knowledge.ts';
import {
  briefText,
  cartBrief,
  core,
  ensureCart,
  pack,
  productIdOf,
  saveCheckout,
  thread,
  viewCart,
  type Ctx,
} from './shared.ts';

const opSchema = s.object({
  op: s.enum(['add', 'qty', 'remove']),
  product: s
    .string({ max: 80 })
    .optional()
    .describe('add: código do produto (slug do cardápio ou pN)'),
  qty: s
    .int({ min: 0, max: 99 })
    .optional()
    .describe('add: quantidade (padrão 1); qty: nova quantidade, 0 remove'),
  options: s
    .array(s.object({ id: s.string({ max: 12 }), qty: s.int({ min: 1, max: 20 }).optional() }), {
      max: 32,
    })
    .optional()
    .describe('add: opções escolhidas pelos ids [mN] de get_product'),
  combo: s
    .array(
      s.object({
        slot: s.string({ max: 12 }),
        product: s.string({ max: 12 }),
        qty: s.int({ min: 1, max: 20 }).optional(),
      }),
      { max: 32 },
    )
    .optional()
    .describe('add de combo: escolha por parte [sN] e item [pN] de get_product'),
  line: s.string({ max: 12 }).optional().describe('qty/remove: id da linha [lN] da sacola'),
});

type Op = {
  op: 'add' | 'qty' | 'remove';
  product?: string | undefined;
  qty?: number | undefined;
  options?: { id: string; qty?: number | undefined }[] | undefined;
  combo?: { slot: string; product: string; qty?: number | undefined }[] | undefined;
  line?: string | undefined;
};

export const cartEditTool = defineTool<{ ops: Op[] }, Sql>({
  name: 'cart_edit',
  description:
    'Monta a sacola: adicionar itens (com opções e combos), mudar quantidade ou remover linhas. Várias operações de uma vez ("2 X-Salada, um sem cebola, e uma coca"). Devolve a sacola calculada pela loja e o que falta.',
  effect: 'write',
  input: s.object({ ops: s.array(opSchema, { min: 1, max: 10 }) }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    const cartId = await ensureCart(ctx, t);
    const done: string[] = [];
    for (const [i, op] of input.ops.entries()) {
      const where = `operação ${i + 1}`;
      if (op.op === 'add') {
        if (!op.product) throw new ToolError(`${where}: falta o produto`);
        const productId = await productIdOf(ctx, op.product);
        const product = await getProductById(ctx.tx, ctx.tenantId, productId);
        if (!product) throw new ToolError(`${where}: produto não encontrado`);
        const qty = op.qty ?? 1;
        if (qty < 1) throw new ToolError(`${where}: quantidade mínima 1`);
        const modifiers = (op.options ?? []).map((o) => ({
          id: ctx.resolve(o.id, 'modifier'),
          qty: o.qty ?? 1,
        }));
        const comboSelections = (op.combo ?? []).map((c) => ({
          slotId: ctx.resolve(c.slot, 'slot'),
          productId: ctx.resolve(c.product, 'product'),
          qty: c.qty ?? 1,
        }));
        try {
          await addItem(
            ctx.tx,
            ctx.tenantId,
            cartId,
            { productId, qty, modifiers, comboSelections },
            getProductById,
          );
        } catch (e) {
          const groups = product.modifierGroups
            .filter((g) => g.required)
            .map((g) => `"${g.name}" (escolher ${Math.max(1, g.minSelect)}–${g.maxSelect})`);
          const msg = e instanceof Error ? e.message : String(e);
          throw new ToolError(
            `${where} (${product.name}): ${msg}${groups.length ? `. Obrigatórios: ${groups.join(', ')}. Pergunte ao cliente e use get_product para os ids.` : ''}`,
          );
        }
        done.push(`+${qty} ${product.name}`);
      } else {
        if (!op.line) throw new ToolError(`${where}: falta a linha [lN]`);
        const itemId = ctx.resolve(op.line, 'line');
        if (op.op === 'remove' || op.qty === 0)
          await core(() => removeLineTx(ctx.tx, ctx.tenantId, cartId, itemId));
        else {
          if (op.qty === undefined) throw new ToolError(`${where}: falta a quantidade`);
          await core(() => setLineQtyTx(ctx.tx, ctx.tenantId, cartId, itemId, op.qty!));
        }
        done.push(op.op === 'remove' ? `removida ${op.line}` : `${op.line} → ${op.qty}`);
      }
    }
    await ctx.tx`update shopper_threads set summary = null, stage = 'building', updated_at = now() where id = ${t.id}`;
    const cart = await viewCart(ctx, { ...t, cartId });
    const brief = cartBrief(ctx, cart, { ...t, cartId });
    return {
      content: `${done.join('; ')}\n${briefText(brief)}`,
      data: { cart: brief as unknown as Json },
    };
  },
});

export const reorderTool = defineTool<
  { order?: number | undefined; replace?: boolean | undefined },
  Sql
>({
  name: 'reorder',
  description:
    '"O de sempre": refaz um pedido anterior deste cliente com os preços de hoje (o último, ou pelo número). Diz o que mudou de preço ou não está disponível.',
  effect: 'write',
  input: s.object({
    order: s.int({ min: 1, max: 10_000_000 }).optional(),
    replace: s.boolean().optional().describe('troca o que já está na sacola'),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    if (!t.phone || t.phone.startsWith('+'))
      throw new ToolError('Sem o número do cliente não dá para achar pedidos anteriores.');
    const [o] = await ctx.tx<{ id: string; number: number }[]>`
      select id, number from orders
      where tenant_id = ${ctx.tenantId} and customer_phone = ${t.phone}
        and (${input.order ?? null}::int is null or number = ${input.order ?? null}::int)
      order by placed_at desc limit 1`;
    if (!o) throw new ToolError('Nenhum pedido anterior deste cliente com esse número.');
    const cartId = await ensureCart(ctx, t);
    if (input.replace)
      await ctx.tx`delete from cart_items where tenant_id = ${ctx.tenantId} and cart_id = ${cartId}`;
    const lines = await orderLines(ctx.tx, ctx.tenantId, o.id);
    const report = await core(() => importLines(ctx.tx, ctx.tenantId, cartId, lines));
    const was = await ctx.tx<{ name: string; unit: number }[]>`
      select name, unit_price_cents as unit from order_items where tenant_id = ${ctx.tenantId} and order_id = ${o.id}`;
    await ctx.tx`update shopper_threads set summary = null, stage = 'building', updated_at = now() where id = ${t.id}`;
    const cart = await viewCart(ctx, { ...t, cartId });
    const changed: string[] = [];
    for (const item of cart?.items ?? []) {
      const before = was.find((w) => fold(w.name) === fold(item.name));
      if (before && before.unit !== item.unitPriceCents) {
        const a = ctx.alias('line', item.id);
        ctx.figure(`${a}.antes`, { value: before.unit, text: brl(before.unit), kind: 'money' });
        ctx.figure(`${a}.agora`, {
          value: item.unitPriceCents,
          text: brl(item.unitPriceCents),
          kind: 'money',
        });
        changed.push(`[${a}] ${item.name}: era {{${a}.antes}}, hoje {{${a}.agora}}`);
      }
    }
    const brief = cartBrief(ctx, cart, { ...t, cartId });
    const skipped = report.skipped.map((sk) => `${sk.slug ?? 'item'} (${sk.message})`);
    return {
      content: [
        `Pedido #${o.number} refeito com os preços de hoje.`,
        changed.length ? `Mudou de preço: ${changed.join('; ')}` : 'Nenhum preço mudou.',
        skipped.length
          ? `Não deu para incluir: ${skipped.join('; ')} (ofereça substituto parecido ou a lista de espera).`
          : '',
        briefText(brief),
      ]
        .filter(Boolean)
        .join('\n'),
      data: { cart: brief as unknown as Json },
    };
  },
});

export const setFulfillmentTool = defineTool<
  {
    mode: 'pickup' | 'delivery';
    street?: string | undefined;
    number?: string | undefined;
    complement?: string | undefined;
    neighborhood?: string | undefined;
    reference?: string | undefined;
    cep?: string | undefined;
    use_pin?: boolean | undefined;
    saved_address?: number | undefined;
    scheduled_for?: string | undefined;
  },
  Sql
>({
  name: 'set_fulfillment',
  description:
    'Entrega ou retirada. Para entrega: rua e número com bairro, ou a localização enviada (use_pin), ou um endereço já usado pelo cliente (saved_address: 1, 2 ou 3, sempre confirmando antes). scheduled_for (AAAA-MM-DD) para encomendas.',
  effect: 'write',
  input: s.object({
    mode: s.enum(['pickup', 'delivery']),
    street: s.string({ max: 120 }).optional(),
    number: s.string({ max: 10 }).optional(),
    complement: s.string({ max: 80 }).optional(),
    neighborhood: s.string({ max: 120 }).optional(),
    reference: s.string({ max: 120 }).optional(),
    cep: s.string({ max: 12 }).optional(),
    use_pin: s.boolean().optional(),
    saved_address: s.int({ min: 1, max: 3 }).optional(),
    scheduled_for: s.string({ max: 10 }).optional(),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    const cartId = await ensureCart(ctx, t);
    let delivery: CartDelivery;
    if (input.mode === 'pickup') {
      if (!pack(ctx).fulfilment.pickup) throw new ToolError('Esta loja não tem retirada.');
      delivery = { mode: 'pickup' };
    } else {
      if (!pack(ctx).fulfilment.delivery) throw new ToolError('Esta loja não faz entrega.');
      delivery = { mode: 'delivery' };
      if (input.saved_address) {
        if (!t.phone) throw new ToolError('Sem endereços anteriores para este cliente.');
        const rows = await ctx.tx<{ delivery: Record<string, unknown> }[]>`
          select delivery from orders where tenant_id = ${ctx.tenantId} and customer_phone = ${t.phone}
            and delivery ->> 'mode' = 'delivery' order by placed_at desc limit 30`;
        const seen = new Set<string>();
        const distinct = rows.filter((r) => {
          const k = JSON.stringify([
            r.delivery.street,
            r.delivery.number,
            r.delivery.address,
            r.delivery.neighborhood,
          ]);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const d = distinct[input.saved_address - 1]?.delivery;
        if (!d) throw new ToolError('Esse endereço salvo não existe.');
        for (const k of [
          'street',
          'number',
          'complement',
          'neighborhood',
          'reference',
          'cep',
          'address',
        ] as const)
          if (typeof d[k] === 'string') (delivery as unknown as Record<string, unknown>)[k] = d[k];
        if (typeof d.lat === 'number' && typeof d.lng === 'number') {
          delivery.lat = d.lat;
          delivery.lng = d.lng;
        }
      } else {
        if (input.street) delivery.street = input.street;
        if (input.number) delivery.number = input.number;
        if (input.complement) delivery.complement = input.complement;
        if (input.neighborhood) delivery.neighborhood = input.neighborhood;
        if (input.reference) delivery.reference = input.reference;
        if (input.cep) {
          const cep = normalizeCep(input.cep);
          if (!cep) throw new ToolError('CEP inválido.');
          delivery.cep = cep;
        }
        if (input.use_pin) {
          const [pin] = await ctx.tx<{ lat: number; lng: number }[]>`
            select (meta ->> 'lat')::float8 as lat, (meta ->> 'lng')::float8 as lng from shopper_messages
            where tenant_id = ${ctx.tenantId} and thread_id = ${t.id} and kind = 'location' and author = 'shopper'
            order by created_at desc limit 1`;
          if (!pin) throw new ToolError('O cliente não mandou localização.');
          delivery.lat = pin.lat;
          delivery.lng = pin.lng;
        }
        if (!delivery.street && !delivery.neighborhood && delivery.lat == null)
          throw new ToolError(
            'Para entrega preciso de rua e número com bairro, ou da localização.',
          );
        if (delivery.street && !delivery.number) throw new ToolError('Falta o número da casa.');
      }
    }
    const cart = await core(() => setDeliveryTx(ctx.tx, ctx.tenantId, cartId, delivery, null));
    let scheduledFor = t.checkout.scheduledFor ?? null;
    if (input.scheduled_for !== undefined) {
      if (!cart.schedule.dates.includes(input.scheduled_for))
        throw new ToolError(
          `Data indisponível. Datas possíveis: ${cart.schedule.dates.slice(0, 10).join(', ') || 'nenhuma'}.`,
        );
      scheduledFor = input.scheduled_for;
    }
    const checkout = await saveCheckout(ctx, { ...t, cartId }, { scheduledFor });
    if (delivery.mode === 'delivery' && !cart.delivery?.zoneId)
      await ctx.tx`insert into vendedor_demand (tenant_id, kind, term)
        values (${ctx.tenantId}, 'out_of_zone', ${fold(delivery.neighborhood ?? delivery.cep ?? 'localização').slice(0, 80)})`;
    await ctx.tx`update shopper_threads set stage = 'building', updated_at = now() where id = ${t.id}`;
    const fresh = await viewCart(ctx, { ...t, cartId, checkout });
    const brief = cartBrief(ctx, fresh, { ...t, cartId, checkout });
    const d = fresh?.delivery;
    let note = delivery.mode === 'pickup' ? 'Retirada na loja.' : '';
    if (d?.mode === 'delivery') {
      if (!d.zoneId) note = 'Fora da área de entrega. Ofereça retirada.';
      else if (d.etaMin != null && d.etaMax != null) {
        ctx.figure('entrega.prazo', {
          value: [d.etaMin, d.etaMax],
          text: `${d.etaMin}–${d.etaMax} min`,
          kind: 'duration',
        });
        note = 'Entrega na área, prazo {{entrega.prazo}}, taxa {{cart.fee}}.';
      }
    }
    return { content: `${note}\n${briefText(brief)}`, data: { cart: brief as unknown as Json } };
  },
});

export const setPaymentTool = defineTool<
  { method: string; change_for_cents?: number | undefined },
  Sql
>({
  name: 'set_payment',
  description:
    'Forma de pagamento: pix, card_online (link do cartão), card_on_delivery, cash (dinheiro; troco em centavos: "troco para 100" = 10000) ou meal_voucher. Só as que a loja aceita.',
  effect: 'write',
  input: s.object({
    method: s.enum(['pix', 'card_online', 'card_on_delivery', 'cash', 'meal_voucher']),
    change_for_cents: s.int({ min: 0, max: 1_000_000 }).optional(),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    if (!isPaymentMethod(input.method)) throw new ToolError('Forma de pagamento desconhecida.');
    const method = input.method as PaymentMethod;
    const p = pack(ctx);
    if (!p.payments.some((m) => m.id === method))
      throw new ToolError(
        `A loja não aceita essa forma. Aceita: ${p.payments.map((m) => m.label).join(', ')}.`,
      );
    const cart = await viewCart(ctx, t);
    const total = cart?.totals.totalCents ?? 0;
    for (const g of p.guards) {
      if (g.kind === 'cash_max' && method === 'cash' && total > g.cents) {
        ctx.figure('regra.dinheiro_max', { value: g.cents, text: brl(g.cents), kind: 'money' });
        throw new ToolError(
          'Regra da loja: dinheiro só até {{regra.dinheiro_max}}. Ofereça outra forma.',
        );
      }
      if (g.kind === 'pix_only_above' && method !== 'pix' && total > g.cents) {
        ctx.figure('regra.pix_acima', { value: g.cents, text: brl(g.cents), kind: 'money' });
        throw new ToolError('Regra da loja: acima de {{regra.pix_acima}} só Pix.');
      }
    }
    const cancelled =
      (ctx.state.context.subject as { customer?: { cancelledRecently?: number } | null } | null)
        ?.customer?.cancelledRecently ?? 0;
    const limit = p.agent.pixOnlyAfterCancels;
    if (limit && cancelled >= limit && method !== 'pix')
      throw new ToolError('Para este cliente a loja pede pagamento por Pix.');
    let changeForCents: number | null = null;
    if (method === 'cash' && input.change_for_cents) {
      if (input.change_for_cents < total) {
        throw new ToolError(
          'O troco precisa ser para um valor igual ou maior que o total ({{cart.total}}).',
        );
      }
      changeForCents = input.change_for_cents;
    }
    const checkout = await saveCheckout(ctx, t, { payment: { method, changeForCents } });
    const fresh = await viewCart(ctx, { ...t, checkout });
    const brief = cartBrief(ctx, fresh, { ...t, checkout });
    if (changeForCents)
      ctx.figure('pagamento.troco', {
        value: changeForCents,
        text: brl(changeForCents),
        kind: 'money',
      });
    return {
      content: `Pagamento: ${p.payments.find((m) => m.id === method)!.label}${changeForCents ? ', troco para {{pagamento.troco}}' : ''}.\n${briefText(brief)}`,
      data: { cart: brief as unknown as Json },
    };
  },
});

export const setCustomerTool = defineTool<
  { name?: string | undefined; phone?: string | undefined; notes?: string | undefined },
  Sql
>({
  name: 'set_customer',
  description:
    'Nome para o pedido (primeiro nome basta), observações do pedido (ex.: "sem cebola no X-Salada", "interfone 12") e, só se o WhatsApp não mostrou o número, um telefone de contato.',
  effect: 'write',
  input: s.object({
    name: s.string({ min: 2, max: 60 }).optional(),
    phone: s.string({ max: 20 }).optional(),
    notes: s.string({ max: 300 }).optional(),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    const patch: Record<string, unknown> = {};
    if (input.name) patch.name = input.name.trim();
    if (input.notes !== undefined) patch.notes = input.notes.trim() || null;
    if (input.phone) {
      if (t.phone) throw new ToolError('O número já é o do WhatsApp deste cliente.');
      const digits = input.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (!/^\d{10,11}$/.test(digits)) throw new ToolError('Telefone com DDD, 10 ou 11 dígitos.');
      patch.phone = digits;
    }
    const checkout = await saveCheckout(ctx, t, patch);
    const cart = await viewCart(ctx, { ...t, checkout });
    const brief = cartBrief(ctx, cart, { ...t, checkout });
    return { content: `Anotado.\n${briefText(brief)}`, data: { cart: brief as unknown as Json } };
  },
});

export const applyCouponTool = defineTool<{ code: string }, Sql>({
  name: 'apply_coupon',
  description:
    'Aplica um cupom que o cliente informou. A loja valida; você não promete desconto antes.',
  effect: 'money',
  input: s.object({ code: s.string({ min: 3, max: 32 }) }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx, { forUpdate: true });
    const cartId = await ensureCart(ctx, t);
    // a WhatsApp message proves the phone (sales-agent.md §4.7); the test chat proves nothing
    const proven = t.channel === 'whatsapp' && t.phone && !t.phone.startsWith('+') ? t.phone : null;
    await core(() => applyCouponTx(ctx.tx, ctx.tenantId, cartId, input.code, t.phone, proven));
    await ctx.tx`update shopper_threads set summary = null, updated_at = now() where id = ${t.id}`;
    const cart = await viewCart(ctx, { ...t, cartId });
    const brief = cartBrief(ctx, cart, { ...t, cartId });
    return {
      content: `${cart?.coupon?.applies ? 'Cupom aplicado: desconto {{cart.discount}}.' : `Cupom guardado, mas ainda não vale (${cart?.coupon?.reason ?? 'condição'}).`}\n${briefText(brief)}`,
      data: { cart: brief as unknown as Json },
    };
  },
});
