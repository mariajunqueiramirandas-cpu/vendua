import {
  defineAgent,
  defineStatechart,
  defineTool,
  noHumanClaim,
  redactContacts,
  s,
  style,
  type Json,
} from '@vendua/agent-runtime';
import { loadCartView } from '../../../modules/cart.ts';
import type { Sql } from '../../../platform/db.ts';
import { lineText } from '../../../vendedor/cards.ts';
import { buildPack, customerCard, type SubjectContext } from '../../../vendedor/pack.ts';
import { loadAgent } from '../../../vendedor/settings.ts';
import {
  AGENT_ID,
  SUBJECT_KIND,
  loadStoreSettings,
  loadThread,
  storeStatus,
  threadFloor,
} from '../../../vendedor/threads.ts';
import { applyCustom, fenceInput, finished, INITIAL, INPUT_KINDS, toInput } from './fold.ts';
import { VENDEDOR_GUARDS } from './guards.ts';
import { CUSTOMER_BLOCK, RULES_BLOCK, STORE_BLOCK, volatile } from './prompt.ts';
import { briefText, cartBrief, pack, thread, viewCart, type Ctx } from './shared.ts';
import {
  getProductTool,
  knowledgeTool,
  quoteDeliveryTool,
  searchCatalogTool,
  storeInfoTool,
  askStoreTool,
} from './tools-catalog.ts';
import {
  applyCouponTool,
  cartEditTool,
  reorderTool,
  setCustomerTool,
  setFulfillmentTool,
  setPaymentTool,
} from './tools-cart.ts';
import {
  forgetTool,
  handoffTool,
  joinWaitlistTool,
  muteMeTool,
  offerIncentiveTool,
  offerSuggestionTool,
  rememberTool,
  suggestTool,
} from './tools-conversation.ts';
import {
  myOrdersTool,
  orderStatusTool,
  placeOrderTool,
  sendCardTool,
  sendLinkTool,
  sendPixTool,
  sendSummaryTool,
} from './tools-order.ts';

const viewCartTool = defineTool<Record<string, never>, Sql>({
  name: 'view_cart',
  description: 'A sacola como a loja calcula agora: linhas [lN], totais e o que falta.',
  effect: 'read',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx);
    const brief = cartBrief(ctx, await viewCart(ctx, t), t);
    return { content: briefText(brief), data: { cart: brief as unknown as Json } };
  },
});

const CART_CHANGES = [
  'cart_edit',
  'reorder',
  'set_fulfillment',
  'set_payment',
  'set_customer',
  'apply_coupon',
  'offer_incentive',
];
const toBuilding = Object.fromEntries(CART_CHANGES.map((t) => [`tool:${t}`, 'building']));

export const statechart = defineStatechart({
  initial: 'browsing',
  states: {
    browsing: {
      tools: '*',
      hint: 'conversando, sem sacola',
      on: { 'tool:cart_edit': 'building', 'tool:reorder': 'building' },
    },
    building: {
      tools: '*',
      hint: 'montando o pedido: siga o FALTA',
      on: {
        'tool:send_summary': {
          to: 'confirming',
          when: (_s, p) => !!(p as { summary?: string } | null)?.summary,
        },
      },
    },
    confirming: {
      tools: '*',
      hint: 'o resumo foi enviado: espere o sim e chame place_order',
      on: {
        ...toBuilding,
        'tool:place_order': {
          to: 'ordered',
          when: (_s, p) => !!(p as { order?: unknown } | null)?.order,
        },
      },
    },
    ordered: {
      tools: '*',
      hint: 'pedido feito: pagamento, status, dúvidas',
      on: { 'tool:cart_edit': 'building', 'tool:reorder': 'building' },
    },
  },
});

async function subjectContext(
  tx: Sql,
  tenantId: string,
  threadId: string,
): Promise<SubjectContext & { cart: Json | null }> {
  const now = new Date();
  const t = await loadThread(tx, tenantId, threadId);
  if (!t) throw new Error(`no thread ${threadId}`);
  const agent = await loadAgent(tx, tenantId);
  const f = threadFloor(t, agent, storeStatus(await loadStoreSettings(tx, tenantId), now), now);
  let cart: Json | null = null;
  if (t.cartId) {
    const view = await loadCartView(tx, tenantId, t.cartId, now);
    // lines only: the figures and the [lN] ids come from view_cart or the cart tools
    if (view.status === 'open' && view.items.length)
      cart = {
        lines: view.items.map((i) => ({ alias: '', text: lineText(i), total: '' })),
        total: null,
        missing: ['use view_cart para valores e o que falta'],
        hints: [],
        empty: false,
      };
  }
  let order: SubjectContext['order'] = null;
  if (t.orderId) {
    const [o] = await tx<
      { number: number; state: string }[]
    >`select number, state from orders where id = ${t.orderId}`;
    if (o) order = { number: o.number, state: o.state };
  }
  return {
    threadId: t.id,
    channel: t.channel,
    test: t.channel === 'test',
    stage: t.stage,
    floor: f.floor,
    floorUntil: f.until?.toISOString() ?? null,
    ownerReason: t.ownerReason,
    knownPhone: !!t.phone,
    profileName: t.profileName,
    customer: t.channel === 'whatsapp' ? await customerCard(tx, tenantId, t.phone) : null,
    order: order ? ({ id: t.orderId, ...order } as unknown as SubjectContext['order']) : null,
    language: t.language,
    cart,
  };
}

export const vendedor = defineAgent<Sql>({
  id: AGENT_ID,
  subject: SUBJECT_KIND,
  lane: 'interactive',
  transport: 'vendedor',
  models: {
    default: 'fast',
    // a second try after a block, or a long order, gets the stronger model
    escalate: [{ when: (st) => st.guardBlocks > 0, to: 'strong' }],
    maxTokens: 900,
    temperature: 0.3,
  },
  instructions: [RULES_BLOCK, STORE_BLOCK, CUSTOMER_BLOCK],
  tools: [
    searchCatalogTool,
    getProductTool,
    storeInfoTool,
    quoteDeliveryTool,
    knowledgeTool,
    askStoreTool,
    viewCartTool,
    cartEditTool,
    reorderTool,
    setFulfillmentTool,
    setPaymentTool,
    setCustomerTool,
    applyCouponTool,
    sendSummaryTool,
    placeOrderTool,
    sendPixTool,
    myOrdersTool,
    orderStatusTool,
    sendLinkTool,
    sendCardTool,
    handoffTool,
    rememberTool,
    forgetTool,
    muteMeTool,
    joinWaitlistTool,
    suggestTool,
    offerSuggestionTool,
    offerIncentiveTool,
  ],
  statechart,
  guards: {
    input: [fenceInput, redactContacts],
    output: [noHumanClaim, ...VENDEDOR_GUARDS, style({ maxChars: 700, maxQuestions: 2 })],
  },
  mailbox: {
    quiet: { minMs: 2_500, maxMs: 20_000, extendWhile: 'presence.typing' },
    preempt: true,
    inputKinds: INPUT_KINDS,
  },
  budgets: {
    stepsPerTurn: 10,
    tokensPerTurn: 90_000,
    costPerTurnUsd: 0.25,
    tenantDaily: 'vendedor',
  },
  finish: finished,
  toInput,
  load: {
    tenant: async ({ tx, tenantId }) =>
      (await buildPack(tx, tenantId, new Date())) as unknown as Json,
    subject: async ({ tx, tenantId, subject }) =>
      (await subjectContext(tx, tenantId, subject.id)) as unknown as Json,
  },
  volatile,
  fold: { initial: INITIAL as unknown as Json, apply: applyCustom },
  memory: {
    keys: [
      { key: 'nome' },
      { key: 'idioma' },
      { key: 'preferencia.*', minConfidence: 0.7 },
      { key: 'endereco_nota.*', minConfidence: 0.7 },
      { key: 'alergia.*', sensitive: true },
      { key: 'restricao.*', sensitive: true },
    ],
  },
  consolidate: {
    afterIdleMs: 30 * 60_000,
    instructions:
      'Proponha só o que o cliente disse claramente sobre como gosta de pedir (ex.: "sem cebola no X-Salada", "massa bem assada", nome, idioma). Alergia ou restrição só se ele concordou explicitamente em você lembrar. Nada sobre outras pessoas.',
  },
  degrade: async (ctx) => {
    const p = pack(ctx as Ctx);
    await ctx.tx`update shopper_threads set waiting_since = coalesce(waiting_since, now()),
      owner_reason = coalesce(owner_reason, 'instabilidade'), updated_at = now() where id = ${ctx.subject.id}`;
    return {
      text: `Desculpe, tive um problema para responder agora. Já avisei a loja, que continua por aqui.${p?.url ? ` Se preferir, o cardápio está em ${p.url}` : ''}`,
    };
  },
  maxAttempts: 3,
  evals: 'packages/core/test/vendedor-evals.test.ts',
});
