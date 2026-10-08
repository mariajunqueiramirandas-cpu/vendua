import { defineTool, s, ToolError } from '@vendua/agent-runtime';
import { isDate } from '../../../admin/context.ts';
import type { Sql } from '../../../platform/db.ts';
import {
  AVAILABILITY,
  COUPON_KINDS,
  PAUSE_UNTIL,
  proposeTx,
  type ActionKind,
  type CouponInput,
  type CouponUpdateInput,
  type OperationsInput,
  type PauseInput,
  type PriceInput,
  type ProductInput,
  type SpecialDayInput,
} from '../../../copilot/actions.ts';
import { refused, todayIn, who, type Ctx } from './shared.ts';

// Duá never changes the store: each of these writes a proposal the merchant confirms on its card
// (copilot_actions). The route the card replays already ran once, rolled back, so what can't be
// done is refused here, with the store's reason.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function propose(ctx: Ctx, kind: ActionKind, input: unknown) {
  const w = await who(ctx);
  try {
    const p = await proposeTx(ctx.tx, {
      tenant: w.tenant,
      merchant: w.merchant,
      turnId: ctx.turnId,
      kind,
      input,
    });
    const ref = `proposta.${p.id.slice(0, 8)}`;
    ctx.figure(ref, {
      value: p.id,
      text: `${p.title}: ${p.lines.map((l) => (l.from ? `${l.label} ${l.from} → ${l.to}` : `${l.label} ${l.to}`)).join('; ')}`,
      kind: 'text',
    });
    return {
      content: `Proposta pronta: um cartão "${p.title}" aparece na conversa com Confirmar e Agora não. Nada mudou ainda. Para resumir o cartão, cite {{${ref}}}.`,
      data: { action: p.id, kind },
    };
  } catch (e) {
    return refused(e);
  }
}

export const proposePauseTool = defineTool<PauseInput, Sql>({
  name: 'propose_pause',
  description:
    'Prepara a pausa da loja (para de aceitar pedidos). Use minutes (5 a 10080) para um tempo, ou until="today" (até o fim do dia) ou until="resume" (até a pessoa retomar). message: aviso opcional que os clientes veem.',
  effect: 'write',
  input: s.object({
    minutes: s.int({ min: 5, max: 10_080 }).optional(),
    until: s.enum(PAUSE_UNTIL).optional(),
    message: s.string({ min: 1, max: 200 }).optional(),
  }),
  run: (ctx: Ctx, input) => {
    if ((input.minutes === undefined) === (input.until === undefined))
      throw new ToolError('Informe minutes OU until, um dos dois.');
    return propose(ctx, 'store.pause', input);
  },
});

export const proposeResumeTool = defineTool<Record<string, never>, Sql>({
  name: 'propose_resume',
  description: 'Prepara a volta da loja a aceitar pedidos (encerra a pausa).',
  effect: 'write',
  input: s.object({}),
  run: (ctx: Ctx) => propose(ctx, 'store.resume', {}),
});

export const proposeOperationsTool = defineTool<OperationsInput, Sql>({
  name: 'propose_operations',
  description:
    'Prepara mudança no tempo de preparo (prepTimeMinutes, 1 a 600) e/ou no aviso de muitos pedidos (demand: "high" liga o aviso na loja, "normal" desliga).',
  effect: 'write',
  input: s.object({
    prepTimeMinutes: s.int({ min: 1, max: 600 }).optional(),
    demand: s.enum(['normal', 'high'] as const).optional(),
  }),
  run: (ctx: Ctx, input) => {
    if (input.prepTimeMinutes === undefined && input.demand === undefined)
      throw new ToolError('Diga o que mudar: prepTimeMinutes ou demand.');
    return propose(ctx, 'store.operations', input);
  },
});

export const proposeSpecialDayTool = defineTool<SpecialDayInput, Sql>({
  name: 'propose_special_day',
  description:
    'Prepara um dia especial: a loja fechada (closed=true) ou com outro horário (closed=false com open e close "HH:MM") numa data AAAA-MM-DD de hoje em diante. label: nome opcional ("Natal"). Substitui o que já estiver marcado nesse dia.',
  effect: 'write',
  input: s.object({
    date: s.string({ min: 10, max: 10 }),
    closed: s.boolean(),
    open: s.string({ min: 5, max: 5 }).optional(),
    close: s.string({ min: 5, max: 5 }).optional(),
    label: s.string({ min: 1, max: 60 }).optional(),
  }),
  run: async (ctx: Ctx, input) => {
    if (!isDate(input.date)) throw new ToolError('date é uma data real no formato AAAA-MM-DD.');
    const w = await who(ctx);
    if (input.date < todayIn(w.tz, ctx.now))
      throw new ToolError('Essa data já passou. Confirme o dia com a pessoa.');
    if (
      !input.closed &&
      !(input.open && input.close && HHMM.test(input.open) && HHMM.test(input.close))
    )
      throw new ToolError('Com closed=false, informe open e close (HH:MM).');
    const day: SpecialDayInput = { date: input.date, closed: input.closed };
    if (!input.closed) Object.assign(day, { open: input.open, close: input.close });
    if (input.label) day.label = input.label;
    return propose(ctx, 'store.special_day', day);
  },
});

export const proposeProductTool = defineTool<
  {
    product: string;
    priceCents?: number | undefined;
    availability?: ProductInput['availability'];
    stockQuantity?: number | undefined;
    untrackStock?: boolean | undefined;
  },
  Sql
>({
  name: 'propose_product_change',
  description:
    'Prepara mudança num produto pelo código curto do menu (p3): preço novo em centavos (priceCents), disponibilidade (available, sold_out_today = esgotado só hoje, sold_out, hidden = esconder do cardápio) e/ou estoque contado (stockQuantity; untrackStock=true para não controlar).',
  effect: 'write',
  input: s.object({
    product: s.string({ min: 1, max: 20 }),
    priceCents: s.int({ min: 0, max: 10_000_000 }).optional(),
    availability: s.enum(AVAILABILITY).optional(),
    stockQuantity: s.int({ min: 0, max: 1_000_000 }).optional(),
    untrackStock: s.boolean().optional(),
  }),
  run: (ctx: Ctx, input) => {
    const productId = ctx.resolve(input.product, 'product');
    const p: ProductInput = { productId };
    if (input.priceCents !== undefined) p.priceCents = input.priceCents;
    if (input.availability !== undefined) p.availability = input.availability;
    if (input.untrackStock) p.stockQuantity = null;
    else if (input.stockQuantity !== undefined) p.stockQuantity = input.stockQuantity;
    if (Object.keys(p).length === 1)
      throw new ToolError('Diga o que mudar: priceCents, availability ou stockQuantity.');
    return propose(ctx, 'product.update', p);
  },
});

export const proposePricesTool = defineTool<{ products: string[]; percent: number }, Sql>({
  name: 'propose_price_change',
  description:
    'Prepara um reajuste percentual de preço em vários produtos de uma vez (códigos curtos do menu). percent: -90 a 300, sem zero; a loja arredonda para 10 centavos.',
  effect: 'write',
  input: s.object({
    products: s.array(s.string({ min: 1, max: 20 }), { min: 1, max: 300 }),
    percent: s.int({ min: -90, max: 300 }),
  }),
  run: (ctx: Ctx, input) => {
    if (input.percent === 0) throw new ToolError('percent não pode ser zero.');
    const productIds = [...new Set(input.products.map((a) => ctx.resolve(a, 'product')))];
    const p: PriceInput = { productIds, percent: input.percent };
    return propose(ctx, 'products.price', p);
  },
});

const CODE = /^[A-Za-z0-9_-]{3,32}$/;

export const proposeCouponTool = defineTool<CouponInput, Sql>({
  name: 'propose_coupon',
  description:
    'Prepara um cupom novo. code: 3 a 32 letras/números; kind: percent (value 1–100), fixed (value em centavos) ou free_delivery (value 0). Opcionais: minSubtotalCents, maxDiscountCents, endsAt (ISO com fuso), maxRedemptions, perPhoneLimit, firstOrderOnly, label.',
  effect: 'write',
  input: s.object({
    code: s.string({ min: 3, max: 32 }),
    kind: s.enum(COUPON_KINDS),
    value: s.int({ min: 0, max: 10_000_000 }),
    label: s.string({ min: 1, max: 120 }).optional(),
    minSubtotalCents: s.int({ min: 0, max: 10_000_000 }).optional(),
    maxDiscountCents: s.int({ min: 1, max: 10_000_000 }).optional(),
    endsAt: s.string({ min: 10, max: 40 }).optional(),
    maxRedemptions: s.int({ min: 1, max: 1_000_000 }).optional(),
    perPhoneLimit: s.int({ min: 1, max: 1000 }).optional(),
    firstOrderOnly: s.boolean().optional(),
  }),
  run: (ctx: Ctx, input) => {
    if (!CODE.test(input.code)) throw new ToolError('code: só letras, números, _ e -.');
    if (input.endsAt && Number.isNaN(Date.parse(input.endsAt)))
      throw new ToolError('endsAt precisa ser uma data ISO.');
    return propose(ctx, 'coupon.create', { ...input, code: input.code.toUpperCase() });
  },
});

export const proposeCouponChangeTool = defineTool<
  {
    coupon: string;
    active?: boolean | undefined;
    endsAt?: string | undefined;
    noEnd?: boolean | undefined;
    maxRedemptions?: number | undefined;
  },
  Sql
>({
  name: 'propose_coupon_change',
  description:
    'Prepara mudança num cupom pelo código curto (c2): desativar/reativar (active), nova validade (endsAt ISO; noEnd=true tira a data) ou limite de usos (maxRedemptions).',
  effect: 'write',
  input: s.object({
    coupon: s.string({ min: 1, max: 20 }),
    active: s.boolean().optional(),
    endsAt: s.string({ min: 10, max: 40 }).optional(),
    noEnd: s.boolean().optional(),
    maxRedemptions: s.int({ min: 1, max: 1_000_000 }).optional(),
  }),
  run: (ctx: Ctx, input) => {
    const p: CouponUpdateInput = { couponId: ctx.resolve(input.coupon, 'coupon') };
    if (input.active !== undefined) p.active = input.active;
    if (input.noEnd) p.endsAt = null;
    else if (input.endsAt !== undefined) {
      if (Number.isNaN(Date.parse(input.endsAt)))
        throw new ToolError('endsAt precisa ser uma data ISO.');
      p.endsAt = input.endsAt;
    }
    if (input.maxRedemptions !== undefined) p.maxRedemptions = input.maxRedemptions;
    if (Object.keys(p).length === 1)
      throw new ToolError('Diga o que mudar: active, endsAt ou maxRedemptions.');
    return propose(ctx, 'coupon.update', p);
  },
});

export const PROPOSE_TOOLS = [
  proposePauseTool,
  proposeResumeTool,
  proposeOperationsTool,
  proposeSpecialDayTool,
  proposeProductTool,
  proposePricesTool,
  proposeCouponTool,
  proposeCouponChangeTool,
];
