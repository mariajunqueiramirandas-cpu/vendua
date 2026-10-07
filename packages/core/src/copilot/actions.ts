import { roleAtLeast, type Merchant, type Role } from '../admin/context.ts';
import { routeRole, runRoute, type Replay } from '../admin/handlers.ts';
import { emitAdminTx } from '../admin/live.ts';
import { storeTz } from '../admin/routes-orders.ts';
import { loadSettings, statusOf } from '../admin/routes-store.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { brl } from '../vendedor/cards.ts';

// Duá Copilot's proposals (ADR 0034). Each kind replays one named admin route: proposing runs it
// in a savepoint that is always rolled back (the route's own validation decides what's possible,
// and the card shows the route's own result), confirming runs it for real in the confirm
// request's claim. Nothing here writes a store setting itself.

export const ACTION_KINDS = [
  'store.pause',
  'store.resume',
  'store.operations',
  'store.special_day',
  'product.update',
  'products.price',
  'coupon.create',
  'coupon.update',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface Line {
  label: string;
  from: string | null;
  to: string;
}

export type ActionStatus = 'proposed' | 'applied' | 'declined' | 'expired' | 'failed';

/** What a proposal's card shows (GET /admin/v1/copilot). */
export interface ActionView {
  id: string;
  kind: ActionKind;
  title: string;
  lines: Line[];
  money: boolean;
  status: ActionStatus;
  error: string | null;
  done: string | null;
  link: string | null;
  canDecide: boolean;
  at: string;
  decidedAt: string | null;
  expiresAt: string;
}

export const PAUSE_UNTIL = ['today', 'resume'] as const;
export const AVAILABILITY = ['available', 'sold_out_today', 'sold_out', 'hidden'] as const;
export const COUPON_KINDS = ['percent', 'fixed', 'free_delivery'] as const;

export interface PauseInput {
  minutes?: number | undefined;
  until?: (typeof PAUSE_UNTIL)[number] | undefined;
  message?: string | undefined;
}
export interface OperationsInput {
  prepTimeMinutes?: number | undefined;
  demand?: 'normal' | 'high' | undefined;
}
export interface SpecialDayInput {
  date: string;
  closed: boolean;
  open?: string | undefined;
  close?: string | undefined;
  label?: string | undefined;
}
export interface ProductInput {
  productId: string;
  priceCents?: number | undefined;
  availability?: (typeof AVAILABILITY)[number] | undefined;
  stockQuantity?: number | null | undefined;
}
export interface PriceInput {
  productIds: string[];
  percent: number;
}
export interface CouponInput {
  code: string;
  kind: (typeof COUPON_KINDS)[number];
  value: number;
  label?: string | undefined;
  minSubtotalCents?: number | undefined;
  maxDiscountCents?: number | undefined;
  endsAt?: string | undefined;
  maxRedemptions?: number | undefined;
  perPhoneLimit?: number | undefined;
  firstOrderOnly?: boolean | undefined;
}
export interface CouponUpdateInput {
  couponId: string;
  active?: boolean | undefined;
  endsAt?: string | null | undefined;
  maxRedemptions?: number | null | undefined;
}

interface Ctx {
  tz: string;
  /** the replayed route's response body */
  result: unknown;
}

interface KindDef<I, S> {
  route: string;
  money: (i: I) => boolean;
  /** built at proposal and again at confirm, from what is there then */
  replay: (tx: Sql, tenantId: string, i: I) => Promise<Replay>;
  snapshot: (tx: Sql, tenantId: string, i: I) => Promise<S>;
  title: (i: I, before: S) => string;
  lines: (before: S, after: S, i: I, c: Ctx) => Line[];
  done: (after: S, i: I, c: Ctx) => string;
  link: (i: I) => string | null;
  /**
   * The part of the state the card shows as "from". Confirming re-reads it and refuses on any
   * change, so a tap never applies to values nobody saw (a price edited meanwhile, a sale that
   * drew stock). Absent: the change doesn't depend on what was there.
   */
  basis?: (before: S, i: I) => unknown;
}

// ── formatting (pt-BR, the store's clock) ───────────────────────────────────

function when(d: Date, tz: string, now = new Date()): string {
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: tz });
  const hm = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (day(d) === day(now)) return `hoje às ${hm}`;
  if (day(d) === day(tomorrow)) return `amanhã às ${hm}`;
  const dm = d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' });
  return `${dm} às ${hm}`;
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long' });
  const dm = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
  return `${dm} (${wd})`;
}

function minutesWord(n: number): string {
  if (n % 60 === 0) return n === 60 ? '1 hora' : `${n / 60} horas`;
  if (n > 60) return `${Math.floor(n / 60)} h ${n % 60} min`;
  return `${n} minutos`;
}

const STATUS_WORD: Record<string, string> = {
  open: 'Aberta, aceitando pedidos',
  closed: 'Fechada (fora do horário)',
  paused: 'Pausada',
};

const AVAILABILITY_WORD: Record<string, string> = {
  available: 'Disponível',
  sold_out_today: 'Esgotado hoje',
  sold_out: 'Esgotado',
  hidden: 'Escondido do cardápio',
};

function couponWord(kind: string, value: number): string {
  if (kind === 'percent') return `${value}% de desconto`;
  if (kind === 'free_delivery') return 'Entrega grátis';
  return `${brl(value)} de desconto`;
}

// ── snapshots: the state a card compares, read the same way before and after ──

interface StoreSnap {
  status: string;
  resumesAt: Date | null;
  prepTimeMinutes: number;
  demand: string;
  specialDays: SpecialDayInput[];
}

async function storeSnap(tx: Sql, tenantId: string): Promise<StoreSnap> {
  const s = await loadSettings(tx, tenantId);
  const st = statusOf(s);
  return {
    status: st.status,
    resumesAt: st.resumesAt ? new Date(st.resumesAt) : null,
    prepTimeMinutes: s.prep_time_minutes,
    demand: s.demand_level ?? 'normal',
    specialDays: (s.special_days ?? []) as SpecialDayInput[],
  };
}

interface ProductSnap {
  name: string;
  priceCents: number;
  availability: string;
  stockQuantity: number | null;
}

async function productSnap(tx: Sql, tenantId: string, id: string): Promise<ProductSnap | null> {
  const [p] = await tx<
    {
      name: string;
      price_cents: number;
      status: string;
      sold_out_until: Date | null;
      stock_quantity: number | null;
    }[]
  >`select name, base_price_cents as price_cents, status, sold_out_until, stock_quantity from products
    where tenant_id = ${tenantId} and id = ${id}`;
  if (!p) return null;
  const availability =
    p.status === 'archived'
      ? 'hidden'
      : p.status === 'sold_out'
        ? p.sold_out_until
          ? 'sold_out_today'
          : 'sold_out'
        : 'available';
  return {
    name: p.name,
    priceCents: p.price_cents,
    availability,
    stockQuantity: p.stock_quantity,
  };
}

interface CouponSnap {
  code: string;
  active: boolean;
  endsAt: Date | null;
  maxRedemptions: number | null;
}

async function couponSnap(tx: Sql, tenantId: string, id: string): Promise<CouponSnap | null> {
  const [c] = await tx<
    { code: string; active: boolean; ends_at: Date | null; max_redemptions: number | null }[]
  >`select code, active, ends_at, max_redemptions from coupons
    where tenant_id = ${tenantId} and id = ${id} and source <> 'loyalty'`;
  return c
    ? { code: c.code, active: c.active, endsAt: c.ends_at, maxRedemptions: c.max_redemptions }
    : null;
}

const gone = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);

// ── the kinds ───────────────────────────────────────────────────────────────

const pause: KindDef<PauseInput, StoreSnap> = {
  route: 'store.pause',
  money: () => false,
  replay: async (_tx, _t, i) => ({
    body: {
      ...(i.minutes !== undefined
        ? { for: 'minutes', minutes: i.minutes }
        : { for: i.until === 'today' ? 'today' : 'indefinite' }),
      ...(i.message !== undefined ? { message: i.message } : {}),
    },
  }),
  snapshot: (tx, t) => storeSnap(tx, t),
  title: () => 'Pausar a loja',
  lines: (before, _after, i) => [
    { label: 'Loja', from: STATUS_WORD[before.status] ?? before.status, to: 'Pausada' },
    {
      label: 'Volta a aceitar pedidos',
      from: null,
      to:
        i.minutes !== undefined
          ? `${minutesWord(i.minutes)} depois de confirmar`
          : i.until === 'today'
            ? 'amanhã, no horário normal'
            : 'quando você retomar',
    },
    ...(i.message ? [{ label: 'Aviso para os clientes', from: null, to: i.message }] : []),
  ],
  done: (after, _i, c) =>
    after.resumesAt
      ? `Loja pausada até ${when(after.resumesAt, c.tz)}`
      : 'Loja pausada até você retomar',
  link: () => '/',
};

const resume: KindDef<Record<string, never>, StoreSnap> = {
  route: 'store.resume',
  money: () => false,
  replay: async () => ({ body: {} }),
  snapshot: (tx, t) => storeSnap(tx, t),
  title: () => 'Voltar a aceitar pedidos',
  lines: (before, after) => [
    {
      label: 'Loja',
      from: STATUS_WORD[before.status] ?? before.status,
      to: STATUS_WORD[after.status] ?? after.status,
    },
  ],
  done: (after) =>
    after.status === 'open'
      ? 'A loja voltou a aceitar pedidos'
      : 'Pausa encerrada: a loja segue o horário de funcionamento',
  link: () => '/',
};

const DEMAND_WORD: Record<string, string> = {
  normal: 'Normal',
  high: 'Muitos pedidos (aviso na loja)',
};

const operations: KindDef<OperationsInput, StoreSnap> = {
  route: 'store.patch',
  money: () => false,
  replay: async (_tx, _t, i) => ({
    body: {
      operations: {
        ...(i.prepTimeMinutes !== undefined ? { prepTimeMinutes: i.prepTimeMinutes } : {}),
        ...(i.demand !== undefined ? { demand: i.demand } : {}),
      },
    },
  }),
  snapshot: (tx, t) => storeSnap(tx, t),
  title: (i) =>
    i.prepTimeMinutes === undefined
      ? i.demand === 'high'
        ? 'Avisar que há muitos pedidos'
        : 'Tirar o aviso de muitos pedidos'
      : 'Mudar o tempo de preparo',
  lines: (before, after, i) => [
    ...(i.prepTimeMinutes !== undefined
      ? [
          {
            label: 'Tempo de preparo',
            from: `${before.prepTimeMinutes} min`,
            to: `${after.prepTimeMinutes} min`,
          },
        ]
      : []),
    ...(i.demand !== undefined
      ? [
          {
            label: 'Movimento',
            from: DEMAND_WORD[before.demand] ?? before.demand,
            to: DEMAND_WORD[after.demand] ?? after.demand,
          },
        ]
      : []),
  ],
  done: (after, i) =>
    i.prepTimeMinutes !== undefined
      ? `Tempo de preparo agora é ${after.prepTimeMinutes} min`
      : after.demand === 'high'
        ? 'A loja avisa que há muitos pedidos'
        : 'Aviso de muitos pedidos tirado',
  link: () => '/loja',
  basis: (b, i) => ({
    ...(i.prepTimeMinutes !== undefined ? { prepTimeMinutes: b.prepTimeMinutes } : {}),
    ...(i.demand !== undefined ? { demand: b.demand } : {}),
  }),
};

function dayWord(d: SpecialDayInput | undefined): string {
  if (!d) return 'Horário normal';
  return d.closed ? 'Fechada' : `${d.open}–${d.close}`;
}

const specialDay: KindDef<SpecialDayInput, StoreSnap> = {
  route: 'store.patch',
  money: () => false,
  // the day merges into the list as it is when the request runs, never a stale copy
  replay: async (tx, t, i) => {
    // the list is read and written back whole: hold the row so a concurrent edit waits
    await tx`select 1 from store_settings where tenant_id = ${t} for update`;
    const { specialDays } = await storeSnap(tx, t);
    const day: SpecialDayInput = { date: i.date, closed: i.closed };
    if (!i.closed) Object.assign(day, { open: i.open, close: i.close });
    if (i.label) day.label = i.label;
    return { body: { specialDays: [...specialDays.filter((d) => d.date !== i.date), day] } };
  },
  snapshot: (tx, t) => storeSnap(tx, t),
  title: (i) => (i.closed ? 'Fechar num dia especial' : 'Horário especial num dia'),
  lines: (before, after, i) => [
    {
      label: 'Dia',
      from: null,
      to: i.label ? `${dayLabel(i.date)} · ${i.label}` : dayLabel(i.date),
    },
    {
      label: 'Funcionamento',
      from: dayWord(before.specialDays.find((d) => d.date === i.date)),
      to: dayWord(after.specialDays.find((d) => d.date === i.date)),
    },
  ],
  done: (_after, i) =>
    i.closed
      ? `A loja fica fechada em ${dayLabel(i.date)}`
      : `Horário especial em ${dayLabel(i.date)}`,
  link: () => '/loja',
  basis: (b, i) => b.specialDays.find((d) => d.date === i.date) ?? null,
};

function stockWord(n: number | null): string {
  return n === null ? 'Sem controle' : `${n} un.`;
}

const product: KindDef<ProductInput, ProductSnap | null> = {
  route: 'product.patch',
  money: (i) => i.priceCents !== undefined,
  replay: async (_tx, _t, i) => ({
    params: { id: i.productId },
    body: {
      ...(i.priceCents !== undefined ? { priceCents: i.priceCents } : {}),
      ...(i.availability !== undefined ? { availability: i.availability } : {}),
      ...(i.stockQuantity !== undefined ? { stockQuantity: i.stockQuantity } : {}),
    },
  }),
  snapshot: (tx, t, i) => productSnap(tx, t, i.productId),
  title: (_i, before) => (before ? `Mudar ${before.name}` : 'Mudar um produto'),
  lines: (before, after, i) => {
    if (!before || !after) throw gone('product');
    return [
      ...(i.priceCents !== undefined
        ? [{ label: 'Preço', from: brl(before.priceCents), to: brl(after.priceCents) }]
        : []),
      ...(i.availability !== undefined
        ? [
            {
              label: 'Disponibilidade',
              from: AVAILABILITY_WORD[before.availability] ?? before.availability,
              to: AVAILABILITY_WORD[after.availability] ?? after.availability,
            },
          ]
        : []),
      ...(i.stockQuantity !== undefined
        ? [
            {
              label: 'Estoque',
              from: stockWord(before.stockQuantity),
              to: stockWord(after.stockQuantity),
            },
          ]
        : []),
    ];
  },
  done: (after) => (after ? `${after.name} atualizado` : 'Produto atualizado'),
  link: (i) => `/cardapio/produto/${i.productId}`,
  basis: (b, i) =>
    b && {
      ...(i.priceCents !== undefined ? { priceCents: b.priceCents } : {}),
      ...(i.availability !== undefined ? { availability: b.availability } : {}),
      ...(i.stockQuantity !== undefined ? { stockQuantity: b.stockQuantity } : {}),
    },
};

const MAX_PRICE_LINES = 12;

type PriceSnap = { id: string; name: string; priceCents: number }[];

const prices: KindDef<PriceInput, PriceSnap> = {
  route: 'products.bulk',
  money: () => true,
  replay: async (_tx, _t, i) => ({
    body: { ids: i.productIds, action: 'price_percent', percent: i.percent },
  }),
  snapshot: async (tx, t, i) =>
    (
      await tx<{ id: string; name: string; price_cents: number }[]>`
      select id, name, base_price_cents as price_cents from products
      where tenant_id = ${t} and id = any(${i.productIds}::uuid[]) order by name`
    ).map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents })),
  title: (i) =>
    `${i.percent > 0 ? 'Aumentar' : 'Baixar'} ${Math.abs(i.percent)}% o preço de ${i.productIds.length} ${i.productIds.length === 1 ? 'produto' : 'produtos'}`,
  lines: (before, after) => {
    if (!before.length) throw gone('products');
    const next = new Map(after.map((p) => [p.id, p.priceCents]));
    const lines: Line[] = before.slice(0, MAX_PRICE_LINES).map((p) => ({
      label: p.name,
      from: brl(p.priceCents),
      to: brl(next.get(p.id) ?? p.priceCents),
    }));
    if (before.length > MAX_PRICE_LINES)
      lines.push({
        label: `e mais ${before.length - MAX_PRICE_LINES}`,
        from: null,
        to: 'o mesmo ajuste',
      });
    return lines;
  },
  done: (_after, i) =>
    `Preço de ${i.productIds.length} ${i.productIds.length === 1 ? 'produto' : 'produtos'} ${i.percent > 0 ? 'aumentado' : 'reduzido'}`,
  link: () => '/cardapio',
  basis: (b) => b.map((p) => [p.id, p.priceCents]),
};

const couponCreate: KindDef<CouponInput, null> = {
  route: 'coupon.create',
  money: () => true,
  replay: async (_tx, _t, i) => ({ body: { ...i } }),
  snapshot: async () => null,
  title: () => 'Criar um cupom',
  lines: (_b, _a, i, c) => {
    const r = c.result as { code?: string } | null;
    const lines: Line[] = [
      { label: 'Código', from: null, to: r?.code ?? i.code.toUpperCase() },
      { label: 'Desconto', from: null, to: couponWord(i.kind, i.value) },
    ];
    if (i.minSubtotalCents)
      lines.push({ label: 'Pedido mínimo', from: null, to: brl(i.minSubtotalCents) });
    if (i.maxDiscountCents)
      lines.push({ label: 'Desconto máximo', from: null, to: brl(i.maxDiscountCents) });
    lines.push({
      label: 'Válido até',
      from: null,
      to: i.endsAt ? when(new Date(i.endsAt), c.tz) : 'sem data para acabar',
    });
    if (i.maxRedemptions)
      lines.push({ label: 'Limite de usos', from: null, to: `${i.maxRedemptions} pedidos` });
    if (i.perPhoneLimit)
      lines.push({ label: 'Por cliente', from: null, to: `${i.perPhoneLimit} vez(es)` });
    if (i.firstOrderOnly)
      lines.push({ label: 'Quem pode usar', from: null, to: 'Só no 1º pedido' });
    return lines;
  },
  done: (_a, i) => `Cupom ${i.code.toUpperCase()} criado`,
  link: () => '/marketing',
};

const couponUpdate: KindDef<CouponUpdateInput, CouponSnap | null> = {
  route: 'coupon.patch',
  money: (i) => i.active !== false,
  replay: async (_tx, _t, i) => ({
    params: { id: i.couponId },
    body: {
      ...(i.active !== undefined ? { active: i.active } : {}),
      ...(i.endsAt !== undefined ? { endsAt: i.endsAt } : {}),
      ...(i.maxRedemptions !== undefined ? { maxRedemptions: i.maxRedemptions } : {}),
    },
  }),
  snapshot: (tx, t, i) => couponSnap(tx, t, i.couponId),
  title: (i, before) =>
    i.active === false
      ? `Desativar o cupom ${before?.code ?? ''}`.trim()
      : `Mudar o cupom ${before?.code ?? ''}`.trim(),
  lines: (before, after, i, c) => {
    if (!before || !after) throw gone('coupon');
    const lines: Line[] = [];
    if (i.active !== undefined)
      lines.push({
        label: 'Situação',
        from: before.active ? 'Ativo' : 'Desativado',
        to: after.active ? 'Ativo' : 'Desativado',
      });
    if (i.endsAt !== undefined)
      lines.push({
        label: 'Válido até',
        from: before.endsAt ? when(before.endsAt, c.tz) : 'sem data',
        to: after.endsAt ? when(after.endsAt, c.tz) : 'sem data',
      });
    if (i.maxRedemptions !== undefined)
      lines.push({
        label: 'Limite de usos',
        from: before.maxRedemptions === null ? 'sem limite' : String(before.maxRedemptions),
        to: after.maxRedemptions === null ? 'sem limite' : String(after.maxRedemptions),
      });
    return lines;
  },
  done: (after) =>
    after
      ? `Cupom ${after.code} ${after.active ? 'atualizado' : 'desativado'}`
      : 'Cupom atualizado',
  link: () => '/marketing',
  basis: (b, i) =>
    b && {
      ...(i.active !== undefined ? { active: b.active } : {}),
      ...(i.endsAt !== undefined ? { endsAt: b.endsAt?.toISOString() ?? null } : {}),
      ...(i.maxRedemptions !== undefined ? { maxRedemptions: b.maxRedemptions } : {}),
    },
};

// the map is the registry the tools and the confirm route share
const KINDS: Record<ActionKind, KindDef<never, unknown>> = {
  'store.pause': pause as KindDef<never, unknown>,
  'store.resume': resume as KindDef<never, unknown>,
  'store.operations': operations as KindDef<never, unknown>,
  'store.special_day': specialDay as KindDef<never, unknown>,
  'product.update': product as KindDef<never, unknown>,
  'products.price': prices as KindDef<never, unknown>,
  'coupon.create': couponCreate as KindDef<never, unknown>,
  'coupon.update': couponUpdate as KindDef<never, unknown>,
};

type Savepointable = { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };
const DRY_RUN = Symbol('dry-run');

/** Runs `fn` in a savepoint that is always rolled back; what it returned survives. */
async function dryRun<T>(tx: Sql, fn: (sp: Sql) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await (tx as unknown as Savepointable).savepoint(async (sp) => {
      out = await fn(sp);
      throw DRY_RUN;
    });
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  return out as T;
}

/** The role confirming a kind needs: its route's. */
export function minRole(kind: ActionKind): Role {
  const role = routeRole(KINDS[kind].route);
  if (!role) throw new Error(`admin route ${KINDS[kind].route} is not mounted`);
  return role;
}

export interface Proposed {
  id: string;
  title: string;
  lines: Line[];
}

/**
 * Proposes a change for `m` to confirm: the route runs once in a rolled-back savepoint, so a
 * change the store would refuse is refused now (the route's HttpError reaches the caller), and
 * the card's lines are what the route actually produced.
 */
export async function proposeTx(
  tx: Sql,
  p: { tenant: Tenant; merchant: Merchant; turnId: string; kind: ActionKind; input: unknown },
): Promise<Proposed> {
  const def = KINDS[p.kind] as KindDef<unknown, unknown>;
  const role = minRole(p.kind);
  if (!roleAtLeast(p.merchant.role, role))
    throw new HttpError(403, 'FORBIDDEN', 'your role cannot do this', { need: role });
  const t = p.tenant.id;
  const before = await def.snapshot(tx, t, p.input);
  const { after, result } = await dryRun(tx, async (sp) => {
    const out = await runRoute(
      sp,
      def.route,
      p.tenant,
      p.merchant,
      await def.replay(sp, t, p.input),
    );
    return {
      after: await def.snapshot(sp, t, p.input),
      result: (out as { body?: unknown } | null)?.body ?? null,
    };
  });
  const c: Ctx = { tz: await storeTz(tx, t), result };
  const title = def.title(p.input, before).slice(0, 120);
  const lines = def.lines(before, after, p.input, c).map((l) => ({
    label: l.label.slice(0, 80),
    from: l.from?.slice(0, 120) ?? null,
    to: l.to.slice(0, 200),
  }));
  const link = def.link(p.input);
  const [row] = await tx<{ id: string }[]>`
    insert into copilot_actions (tenant_id, user_id, turn_id, kind, input, title, lines, link, basis, money, min_role)
    values (${t}, ${p.merchant.userId}, ${p.turnId}, ${p.kind}, ${tx.json(p.input as never)}, ${title},
            ${tx.json(lines as never)}, ${link}, ${basisJson(tx, def, before, p.input)},
            ${def.money(p.input)}, ${role})
    returning id`;
  return { id: row!.id, title, lines };
}

/** Key order and Dates out of the way: what jsonb gives back compares equal to what went in. */
function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  return v ?? null;
}

function basisJson(tx: Sql, def: KindDef<unknown, unknown>, before: unknown, input: unknown) {
  return def.basis ? tx.json(canon(def.basis(before, input)) as never) : null;
}

const DRIFTED =
  'Isso mudou desde que o Duá preparou o cartão. Peça de novo para ver os valores de agora.';

/** The pt-BR the card shows when Core refused a confirmed change. */
export function refusal(e: HttpError): string {
  switch (e.code) {
    case 'BILLING_HOLD':
      return 'O plano da loja está com pagamento em aberto: pausas com hora para voltar esperam o pagamento.';
    case 'COUPON_EXISTS':
      return 'Já existe um cupom com esse código.';
    case 'NOT_FOUND':
    case 'PRODUCT_NOT_FOUND':
    case 'COUPON_NOT_FOUND':
      return 'Isso não existe mais na loja.';
    case 'FORBIDDEN':
      return 'Seu papel na equipe não permite essa mudança.';
    case 'PLAN_REQUIRED':
      return 'O plano da loja não inclui isso.';
    default:
      return 'A loja recusou essa mudança: algo mudou desde a proposta. Peça de novo ao Duá.';
  }
}

interface ActionRow {
  id: string;
  user_id: string;
  kind: ActionKind;
  input: unknown;
  status: ActionStatus;
  min_role: Role;
  expires_at: Date;
  basis: unknown;
}

/**
 * The merchant's tap on a card, or their "SIM" by WhatsApp (`via`). Confirming re-runs the route as `m` (the audit row names them,
 * "pelo Duá") inside the caller's claimed transaction; a refusal is recorded on the card rather
 * than thrown, so the claim stores it. A card already decided is left as it is.
 */
export async function decideTx(
  tx: Sql,
  t: Tenant,
  m: Merchant,
  actionId: string,
  decision: 'confirm' | 'decline',
  o: { via?: 'whatsapp' } = {},
): Promise<void> {
  const [a] = await tx<ActionRow[]>`
    select id, user_id, kind, input, status, min_role, expires_at, basis from copilot_actions
    where tenant_id = ${t.id} and id = ${actionId} and user_id = ${m.userId}
    for update`;
  if (!a) throw new HttpError(404, 'ACTION_NOT_FOUND', 'no such proposal');
  if (a.status !== 'proposed') return;
  const settle = async (
    status: ActionStatus,
    extra: { error?: string | null; done?: string | null } = {},
  ) => {
    await tx`update copilot_actions set status = ${status}, error = ${extra.error ?? null},
      done = ${extra.done ?? null}, decided_at = now(), decided_by = ${m.userId}
      where id = ${a.id}`;
    await emitAdminTx(tx, t.id, 'copilot', m.userId);
  };
  if (decision === 'decline') return settle('declined');
  if (a.expires_at.getTime() <= Date.now()) return settle('expired');
  if (!roleAtLeast(m.role, a.min_role))
    throw new HttpError(403, 'FORBIDDEN', 'your role cannot do this', { need: a.min_role });

  const def = KINDS[a.kind] as KindDef<unknown, unknown>;
  if (def.basis) {
    const now = canon(def.basis(await def.snapshot(tx, t.id, a.input), a.input));
    if (JSON.stringify(now) !== JSON.stringify(canon(a.basis)))
      return settle('failed', { error: DRIFTED });
  }
  // the audit row says which door the yes came through
  const by: Merchant = {
    ...m,
    name: `${m.name} pelo Duá${o.via === 'whatsapp' ? ' (WhatsApp)' : ''}`.slice(0, 120),
  };
  try {
    const { after, result } = await (tx as unknown as Savepointable).savepoint(async (sp) => {
      const out = await runRoute(sp, def.route, t, by, await def.replay(sp, t.id, a.input));
      return {
        after: await def.snapshot(sp, t.id, a.input),
        result: (out as { body?: unknown } | null)?.body ?? null,
      };
    });
    const done = def.done(after, a.input, { tz: await storeTz(tx, t.id), result });
    return settle('applied', { done: done.slice(0, 300) });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status >= 500) throw e;
    return settle('failed', { error: refusal(e) });
  }
}
