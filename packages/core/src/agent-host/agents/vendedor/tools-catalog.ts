import { defineTool, s, ToolError } from '@vendua/agent-runtime';
import { getProductById } from '../../../modules/catalog.ts';
import { searchCatalog } from '../../../modules/catalog-search.ts';
import { quoteDeliveryTx } from '../../../modules/cart-ops.ts';
import { normalizeCep, viaCep } from '../../../modules/geo.ts';
import type { Sql } from '../../../platform/db.ts';
import { brl } from '../../../vendedor/cards.ts';
import { vendedorDeps } from '../../../vendedor/deps.ts';
import { findAnswers, fold, queueQuestion } from '../../../vendedor/knowledge.ts';
import { loadStoreSettings, storeStatus } from '../../../vendedor/threads.ts';
import { askForPin, core, pack, productIdOf, thread, type Ctx } from './shared.ts';

const DIETARY_LABEL: Record<string, string> = {
  sem_gluten: 'sem glúten',
  contem_gluten: 'contém glúten',
  sem_lactose: 'sem lactose',
  contem_lactose: 'contém lactose',
  vegano: 'vegano',
  vegetariano: 'vegetariano',
  contem_amendoim: 'contém amendoim',
  contem_castanhas: 'contém castanhas',
  contem_ovo: 'contém ovo',
  contem_frutos_do_mar: 'contém frutos do mar',
  apimentado: 'apimentado',
};

function statusWord(status: string, label?: string) {
  if (status === 'active') return 'disponível';
  return label ? `indisponível agora (${label})` : 'esgotado agora';
}

export const searchCatalogTool = defineTool<{ query: string }, Sql>({
  name: 'search_catalog',
  description:
    'Procura no cardápio da loja por nome, ingrediente ou categoria (ex.: "calabresa", "sem lactose", "refri 2 litros"). Devolve códigos de produto, preços e disponibilidade agora.',
  effect: 'read',
  input: s.object({ query: s.string({ min: 1, max: 100 }) }),
  run: async (ctx: Ctx, input) => {
    const hits = await core(() =>
      searchCatalog(ctx.tx, ctx.tenantId, input.query, { limit: 8, now: ctx.now }),
    );
    if (!hits.length) {
      return {
        data: { demand: { kind: 'unmet', term: fold(input.query).slice(0, 80) } },
        content: `Nada no cardápio para "${input.query}". Diga que a loja não tem; não ofereça outra coisa como se fosse a mesma.`,
      };
    }
    const lines = hits.map(({ product: p }) => {
      const id = `${p.slug}.price`;
      ctx.figure(id, {
        value: p.fromPriceCents ?? p.basePriceCents,
        text: p.fromPriceCents ? `a partir de ${brl(p.fromPriceCents)}` : brl(p.basePriceCents),
        kind: 'money',
      });
      ctx.figure(`${p.slug}.name`, { value: p.id, text: p.name, kind: 'product' });
      return `${p.slug} · {{${p.slug}.name}} · {{${id}}} · ${statusWord(p.status, p.availabilityLabel)}${p.needsChoices ? ' · tem opções (get_product)' : ''}`;
    });
    return { content: lines.join('\n') };
  },
});

export const getProductTool = defineTool<{ product: string }, Sql>({
  name: 'get_product',
  description:
    'Detalhes de um produto pelo código (slug do cardápio): opções com mínimo/máximo e preço de cada uma, combos, informações de alergênicos, disponibilidade agora. Use antes de montar um item com opções.',
  effect: 'read',
  input: s.object({ product: s.string({ min: 1, max: 80 }) }),
  run: async (ctx: Ctx, input) => {
    const id = await productIdOf(ctx, input.product);
    const p = await getProductById(ctx.tx, ctx.tenantId, id);
    if (!p) throw new ToolError('Produto não encontrado.');
    const base = `${p.slug}.price`;
    ctx.figure(base, { value: p.basePriceCents, text: brl(p.basePriceCents), kind: 'money' });
    ctx.figure(`${p.slug}.name`, { value: p.id, text: p.name, kind: 'product' });
    const out = [
      `${p.slug} · {{${p.slug}.name}} · base {{${base}}} · ${statusWord(p.status, p.availabilityLabel)}`,
    ];
    if (p.description) out.push(`Descrição (dados da loja): ${p.description.slice(0, 400)}`);
    const dietary = (p as unknown as { dietary?: string[] }).dietary ?? [];
    if (dietary.length) {
      ctx.figure(`${p.slug}.diet`, {
        value: dietary,
        text: dietary.map((d) => DIETARY_LABEL[d] ?? d).join(', '),
        kind: 'text',
      });
      out.push(`Alergênicos/dieta informados pela loja: {{${p.slug}.diet}}`);
    } else
      out.push(
        'Alergênicos/dieta: a loja não informou (não afirme nada; use ask_store se perguntarem).',
      );
    for (const g of p.modifierGroups) {
      const rule =
        g.pricingRule === 'average'
          ? ' · preço: média das escolhidas'
          : g.pricingRule === 'most_expensive'
            ? ' · preço: a mais cara'
            : '';
      out.push(
        `Grupo "${g.name}"${g.required ? ' (obrigatório)' : ''}: escolher ${g.minSelect}–${g.maxSelect}${rule}`,
      );
      for (const m of g.modifiers) {
        const a = ctx.alias('modifier', m.id);
        ctx.figure(`${a}.price`, {
          value: m.priceDeltaCents,
          text: m.priceDeltaCents ? `+ ${brl(m.priceDeltaCents)}` : 'sem custo',
          kind: 'money',
        });
        out.push(
          `  [${a}] ${m.name} {{${a}.price}}${m.maxQty > 1 ? ` (até ${m.maxQty})` : ''}${m.status !== 'active' ? ' · esgotado' : ''}`,
        );
      }
    }
    for (const slot of p.comboSlots) {
      const sa = ctx.alias('slot', slot.id);
      out.push(
        `Parte do combo [${sa}] "${slot.name}": escolher ${slot.minSelect}–${slot.maxSelect}`,
      );
      for (const it of slot.items) {
        const ia = ctx.alias('product', it.productId);
        ctx.figure(`${sa}.${ia}.price`, {
          value: it.priceDeltaCents,
          text: it.priceDeltaCents ? `+ ${brl(it.priceDeltaCents)}` : 'incluso',
          kind: 'money',
        });
        out.push(`  [${ia}] ${it.name} {{${sa}.${ia}.price}}`);
      }
    }
    return {
      content: out.join('\n'),
    };
  },
});

export const storeInfoTool = defineTool<Record<string, never>, Sql>({
  name: 'store_info',
  description:
    'Agora: loja aberta ou fechada, até que horas, quando abre, dias especiais, retirada, entrega, formas de pagamento e encomendas.',
  effect: 'read',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const p = pack(ctx);
    const settings = await loadStoreSettings(ctx.tx, ctx.tenantId);
    const st = storeStatus(settings, ctx.now);
    const tf = (iso: string) =>
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: p.timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    const out = [
      `Status agora: ${st.status === 'open' ? 'aberta' : st.status === 'paused' ? 'pausada' : 'fechada'}`,
    ];
    if (st.closesAt) {
      ctx.figure('loja.fecha', { value: st.closesAt, text: tf(st.closesAt), kind: 'time' });
      out.push('Fecha: {{loja.fecha}}');
    }
    if (st.resumesAt) {
      ctx.figure('loja.abre', { value: st.resumesAt, text: tf(st.resumesAt), kind: 'time' });
      out.push('Abre: {{loja.abre}}');
    }
    ctx.figure('loja.horario', { value: p.hours, text: p.hours.join('; '), kind: 'text' });
    out.push('Horário da semana: {{loja.horario}}');
    if (p.specialDays.length) {
      ctx.figure('loja.especiais', {
        value: p.specialDays,
        text: p.specialDays.join('; '),
        kind: 'text',
      });
      out.push('Dias especiais: {{loja.especiais}}');
    }
    if (p.status.message) out.push(`Recado da loja: ${p.status.message}`);
    ctx.figure('loja.preparo', {
      value: p.fulfilment.prepMinutes,
      text: `${p.fulfilment.prepMinutes} min`,
      kind: 'duration',
    });
    out.push(
      `Retirada: ${p.fulfilment.pickup ? `sim${p.fulfilment.pickupAddress ? ` (${p.fulfilment.pickupAddress})` : ''}, fica pronto em cerca de {{loja.preparo}}` : 'não'}`,
    );
    out.push(
      `Entrega: ${p.fulfilment.delivery ? `sim, áreas: ${p.fulfilment.zones.join(' | ')}` : 'não'}`,
    );
    if (p.minOrder) {
      ctx.figure('loja.minimo', { value: p.minOrder, text: p.minOrder, kind: 'money' });
      out.push('Pedido mínimo: {{loja.minimo}}');
    }
    out.push(
      `Pagamento: ${p.payments.map((m) => `${m.label}${m.note ? ` (${m.note})` : ''}`).join(', ')}`,
    );
    out.push(
      `Encomendas: ${p.encomendas.whileClosed ? 'aceitas mesmo com a loja fechada' : 'só com a loja aberta'}, até ${p.encomendas.maxDays} dias à frente`,
    );
    return { content: out.join('\n') };
  },
});

export const quoteDeliveryTool = defineTool<
  { neighborhood?: string | undefined; cep?: string | undefined; use_pin?: boolean | undefined },
  Sql
>({
  name: 'quote_delivery',
  description:
    'Taxa, prazo e pedido mínimo de entrega para um bairro, CEP ou a localização que o cliente mandou (use_pin). Diz se a loja não entrega lá.',
  effect: 'read',
  input: s.object({
    neighborhood: s.string({ max: 120 }).optional(),
    cep: s.string({ max: 12 }).optional(),
    use_pin: s.boolean().optional(),
  }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx);
    let lat: number | undefined;
    let lng: number | undefined;
    if (input.use_pin) {
      const [pin] = await ctx.tx<{ lat: number; lng: number }[]>`
        select (meta ->> 'lat')::float8 as lat, (meta ->> 'lng')::float8 as lng from shopper_messages
        where tenant_id = ${ctx.tenantId} and thread_id = ${t.id} and kind = 'location' and author = 'shopper'
        order by created_at desc limit 1`;
      if (!pin) throw new ToolError('O cliente não mandou localização nesta conversa.');
      lat = pin.lat;
      lng = pin.lng;
    }
    const cep = input.cep ? normalizeCep(input.cep) : null;
    if (!input.neighborhood && !cep && lat === undefined)
      throw new ToolError('Informe bairro, CEP ou use_pin.');
    if (input.cep && !cep)
      throw new ToolError('CEP inválido: são 8 números. Confirme com o cliente.');
    // zones are priced by bairro or by a pin: a CEP becomes its bairro first
    let neighborhood = input.neighborhood ?? null;
    if (!neighborhood && cep && lat === undefined) {
      const found = await (vendedorDeps().cepLookup ?? viaCep)(cep).catch(() => undefined);
      if (found === undefined)
        throw new ToolError('Não consegui consultar o CEP agora. Pergunte o bairro.');
      if (!found?.neighborhood)
        throw new ToolError(
          'CEP não encontrado ou sem bairro. Confirme o CEP ou pergunte o bairro.',
        );
      neighborhood = found.neighborhood;
    }
    const q = await core(() =>
      quoteDeliveryTx(
        ctx.tx,
        ctx.tenantId,
        {
          ...(neighborhood ? { neighborhood } : {}),
          ...(lat !== undefined ? { lat, lng: lng! } : {}),
        },
        { ...(t.cartId ? { cartId: t.cartId } : {}), route: null },
      ),
    );
    if (!q.eligible) {
      if (lat === undefined && pack(ctx).fulfilment.needsPin) return { content: askForPin(t) };
      const where = fold(neighborhood ?? cep ?? 'localização');
      return {
        data: { demand: { kind: 'out_of_zone', term: where.slice(0, 80) } },
        content: `A loja não entrega aí. ${pack(ctx).fulfilment.pickup ? 'Ofereça retirada na loja (store_info diz onde).' : 'A loja não tem retirada; explique com calma.'}`,
      };
    }
    ctx.figure('entrega.taxa', {
      value: q.feeCents,
      text: q.feeCents ? brl(q.feeCents) : 'grátis',
      kind: 'money',
    });
    ctx.figure('entrega.prazo', {
      value: [q.etaMin, q.etaMax],
      text: q.etaMin && q.etaMax ? `${q.etaMin}–${q.etaMax} min` : 'prazo da loja',
      kind: 'duration',
    });
    const out = [
      `Entrega: taxa {{entrega.taxa}}, prazo {{entrega.prazo}}${q.zoneName ? ` (área ${q.zoneName})` : ''}`,
    ];
    if (q.minOrderCents) {
      ctx.figure('entrega.minimo', {
        value: q.minOrderCents,
        text: brl(q.minOrderCents),
        kind: 'money',
      });
      out.push('Pedido mínimo para essa área: {{entrega.minimo}}');
    }
    if (q.freeDeliveryOverCents) {
      ctx.figure('entrega.gratis_acima', {
        value: q.freeDeliveryOverCents,
        text: brl(q.freeDeliveryOverCents),
        kind: 'money',
      });
      out.push('Entrega grátis acima de {{entrega.gratis_acima}}');
    }
    return { content: out.join('\n') };
  },
});

export const knowledgeTool = defineTool<{ question: string }, Sql>({
  name: 'knowledge',
  description:
    'Procura nas respostas que a própria loja escreveu (estacionamento, festas, políticas...). Use antes de dizer que não sabe.',
  effect: 'read',
  input: s.object({ question: s.string({ min: 2, max: 300 }) }),
  run: async (ctx: Ctx, input) => {
    const hits = await findAnswers(ctx.tx, ctx.tenantId, input.question);
    if (!hits.length)
      return { content: 'A loja não escreveu nada sobre isso. Se for importante, use ask_store.' };
    return {
      content: hits
        .map((h, i) => {
          ctx.figure(`resposta${i + 1}`, { value: h.id, text: h.answer, kind: 'text' });
          return `P: ${h.question}\nR: {{resposta${i + 1}}}`;
        })
        .join('\n'),
      data: { knowledgeIds: hits.map((h) => h.id) },
    };
  },
});

export const askStoreTool = defineTool<{ question: string }, Sql>({
  name: 'ask_store',
  description:
    'Pergunta à loja algo que você não sabe (ex.: se um produto tem lactose e a loja não informou). Diga ao cliente que vai confirmar com a loja.',
  effect: 'write',
  input: s.object({ question: s.string({ min: 3, max: 300 }) }),
  run: async (ctx: Ctx, input) => {
    const q = await queueQuestion(ctx.tx, ctx.tenantId, input.question, ctx.subject.id);
    await ctx.tx`update shopper_threads set waiting_since = coalesce(waiting_since, now()),
      owner_reason = ${'pergunta: ' + input.question.slice(0, 180)}, updated_at = now()
      where id = ${ctx.subject.id}`;
    return {
      content: `Pergunta enviada à loja (já perguntaram ${q.askedCount} vez(es)). Diga que vai confirmar e que a loja responde aqui.`,
    };
  },
});
