import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { parseItemNote, priceLine, type CartItemIn, type LinePrice } from '../cart.ts';
import { getProductsById, type ProductDetail } from '../catalog.ts';

// The counter keeps only what was picked; every cent is priced here, with the storefront's own
// line pricing, from the live products (ADR 0035).

export const PDV_METHODS = ['cash', 'pix', 'credit', 'debit', 'voucher'] as const;
export type PdvMethod = (typeof PDV_METHODS)[number];

export const MAX_LINES = 100;
export const MAX_PAYMENTS = 10;
/** R$ 1.000.000: no counter sale or payment above it */
export const MAX_CENTS = 100_000_000;
export const MAX_DISCOUNT_BPS = 10_000;

export interface PdvDiscount {
  kind: 'fixed' | 'percent';
  value: number;
  reason: string;
}

export interface PdvPaymentIn {
  method: PdvMethod;
  amountCents: number;
  tenderedCents: number | null;
}

export interface PricedPdvLine {
  productId: string;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  price: LinePrice;
  note: string | null;
}

export interface PdvQuote {
  lines: {
    productId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    modifiers: { name: string; qty: number; priceDeltaCents: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    note: string | null;
  }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

const bad = (code: string, message: string, details: Record<string, unknown>) =>
  new HttpError(422, code, message, details);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The picked lines, shape-checked; prices and options are checked against the products later. */
export function parseLines(v: unknown): CartItemIn[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LINES)
    throw bad('BAD_REQUEST', `lines must hold 1–${MAX_LINES} items`, { field: 'lines' });
  return v.map((raw, line) => {
    if (!isObj(raw)) throw bad('BAD_REQUEST', 'a line must be an object', { field: 'lines', line });
    if (typeof raw.productId !== 'string' || !UUID.test(raw.productId))
      throw bad('BAD_REQUEST', 'productId must be a uuid', { field: 'productId', line });
    if (!Number.isInteger(raw.qty) || (raw.qty as number) < 1 || (raw.qty as number) > 99)
      throw bad('INVALID_QTY', 'qty must be an integer between 1 and 99', { field: 'qty', line });
    const modifiers = raw.modifiers ?? [];
    if (!Array.isArray(modifiers) || modifiers.length > 64)
      throw bad('INVALID_MODIFIER', 'modifiers must be a list (at most 64)', { line });
    const combo = raw.comboSelections ?? [];
    if (!Array.isArray(combo) || combo.length > 64)
      throw bad('INVALID_COMBO', 'comboSelections must be a list (at most 64)', { line });
    let note: string;
    try {
      note = parseItemNote(raw.note);
    } catch (err) {
      throw withLine(err, line);
    }
    return {
      productId: raw.productId.toLowerCase(),
      qty: raw.qty as number,
      modifiers: modifiers as NonNullable<CartItemIn['modifiers']>,
      comboSelections: combo as NonNullable<CartItemIn['comboSelections']>,
      note,
    };
  });
}

function withLine(err: unknown, line: number): unknown {
  return err instanceof HttpError
    ? new HttpError(err.status, err.code, err.message, { ...err.details, line })
    : err;
}

export function parseDiscount(v: unknown): PdvDiscount | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw bad('BAD_REQUEST', 'discount must be an object', { field: 'discount' });
  const kind = v.kind;
  if (kind !== 'fixed' && kind !== 'percent')
    throw bad('BAD_REQUEST', 'discount.kind must be fixed or percent', { field: 'discount.kind' });
  const max = kind === 'fixed' ? MAX_CENTS : MAX_DISCOUNT_BPS;
  if (!Number.isInteger(v.value) || (v.value as number) < 1 || (v.value as number) > max)
    throw bad('BAD_REQUEST', `discount.value must be an integer 1–${max}`, {
      field: 'discount.value',
    });
  const reason = typeof v.reason === 'string' ? v.reason.replace(/\s+/g, ' ').trim() : '';
  if (reason.length < 1 || reason.length > 140)
    throw bad('BAD_REQUEST', 'discount.reason must have 1–140 characters', {
      field: 'discount.reason',
    });
  return { kind, value: v.value as number, reason };
}

/** Never more than what it discounts. Percent rounds half up, in the store's favour at .5 cents. */
export function discountCents(d: PdvDiscount | null, subtotal: number): number {
  if (!d || subtotal <= 0) return 0;
  const raw = d.kind === 'fixed' ? d.value : Math.round((subtotal * d.value) / 10_000);
  return Math.min(subtotal, raw);
}

export function serviceCents(bps: number, base: number): number {
  return base <= 0 || bps <= 0 ? 0 : Math.round((base * bps) / 10_000);
}

/** `ways` shares of `cents`, the first ones carrying the leftover cents. */
export function splitShares(cents: number, ways: number): number[] {
  if (cents <= 0) return Array.from({ length: ways }, () => 0);
  const base = Math.floor(cents / ways);
  const extra = cents - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < extra ? 1 : 0));
}

export function parsePayment(v: unknown, field = 'payment'): PdvPaymentIn {
  if (!isObj(v)) throw bad('INVALID_PAYMENT', 'a payment must be an object', { field });
  const method = v.method;
  if (typeof method !== 'string' || !(PDV_METHODS as readonly string[]).includes(method))
    throw bad('INVALID_PAYMENT', `method must be one of ${PDV_METHODS.join(', ')}`, {
      field: `${field}.method`,
    });
  const amount = v.amountCents;
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > MAX_CENTS)
    throw bad('INVALID_PAYMENT', `amountCents must be an integer 1–${MAX_CENTS}`, {
      field: `${field}.amountCents`,
    });
  let tendered: number | null = null;
  if (v.tenderedCents !== undefined && v.tenderedCents !== null) {
    if (method !== 'cash')
      throw bad('INVALID_PAYMENT', 'only cash takes tenderedCents', {
        field: `${field}.tenderedCents`,
      });
    const t = v.tenderedCents;
    if (!Number.isInteger(t) || (t as number) < (amount as number) || (t as number) > MAX_CENTS)
      throw bad('INVALID_PAYMENT', 'tenderedCents must cover the amount', {
        field: `${field}.tenderedCents`,
        minCents: amount,
      });
    tendered = t as number;
  }
  return { method: method as PdvMethod, amountCents: amount as number, tenderedCents: tendered };
}

export function parsePayments(v: unknown): PdvPaymentIn[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_PAYMENTS)
    throw bad('INVALID_PAYMENT', `payments must hold 1–${MAX_PAYMENTS} entries`, {
      field: 'payments',
    });
  return v.map((p, i) => parsePayment(p, `payments[${i}]`));
}

export const changeOf = (p: PdvPaymentIn) =>
  p.tenderedCents === null ? 0 : p.tenderedCents - p.amountCents;

/**
 * Prices the lines against the live products. With `forUpdate` the product rows are locked (a
 * sale); the quote reads them plain. A product gone, sold out or off its schedule is refused.
 */
export async function priceLines(
  tx: Sql,
  tenantId: string,
  lines: CartItemIn[],
  opts: { forUpdate?: boolean; tz: string },
): Promise<PricedPdvLine[]> {
  const products = await getProductsById(
    tx,
    tenantId,
    lines.map((l) => l.productId),
    opts,
  );
  return lines.map((l, line) => {
    const p: ProductDetail | undefined = products.get(l.productId);
    if (!p)
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found', {
        line,
        productId: l.productId,
      });
    if (p.status !== 'active')
      throw new HttpError(409, 'SOLD_OUT', `"${p.name}" is not available`, {
        line,
        productId: p.id,
      });
    let price: LinePrice;
    try {
      price = priceLine(p, l);
    } catch (err) {
      throw withLine(err, line);
    }
    return {
      productId: p.id,
      slug: p.slug,
      name: p.name,
      qty: l.qty,
      unitPriceCents: price.unitPriceCents,
      lineTotalCents: price.unitPriceCents * l.qty,
      price,
      note: l.note || null,
    };
  });
}

export function quoteOf(lines: PricedPdvLine[], discount: PdvDiscount | null): PdvQuote {
  const subtotal = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  if (subtotal > MAX_CENTS)
    throw bad('BAD_REQUEST', 'the sale is above the counter limit', { maxCents: MAX_CENTS });
  const off = discountCents(discount, subtotal);
  return {
    lines: lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
      modifiers: l.price.snapshot.map((m) => ({
        name: m.name,
        qty: m.qty ?? 1,
        priceDeltaCents: m.priceDeltaCents,
      })),
      combo: l.price.picks.map((c) => ({ slotName: c.slotName, name: c.name, qty: c.qty })),
      note: l.note,
    })),
    subtotalCents: subtotal,
    discountCents: off,
    totalCents: subtotal - off,
  };
}
