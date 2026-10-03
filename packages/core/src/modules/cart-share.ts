import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import { insertLine } from './cart.ts';
import { getProductById } from './catalog.ts';
import { parseSelections, type ComboSelection } from './combos.ts';

// Cross-device cart recovery (roadmap 2c): `importCart(items)` merges lines into
// the session cart, a share code snapshots a cart for a `?cart=CODE` link, and
// "pedir de novo" replays a past order. All three go through the same add path
// (price freeze, stock, kit validation); lines that can't be added are reported,
// never silently dropped.

export interface ImportLine {
  productId?: string;
  slug?: string;
  qty: number;
  modifierIds?: string[];
  /** options taken more than once; ids listed only in modifierIds are one unit */
  modifiers?: { id: string; qty: number }[];
  comboSelections?: ComboSelection[];
}

export interface ImportReport {
  added: number;
  skipped: { productId: string | null; slug: string | null; code: string; message: string }[];
}

const SHARE_DAYS = 14;
const MAX_LINES = 40;

export function parseImportLines(v: unknown): ImportLine[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LINES)
    throw new HttpError(422, 'INVALID_IMPORT', `items must be an array of 1–${MAX_LINES}`);
  return v.map((raw) => {
    const r = raw as Record<string, unknown>;
    const productId = typeof r?.productId === 'string' ? r.productId : undefined;
    const slug = typeof r?.slug === 'string' ? r.slug : undefined;
    if (productId !== undefined && !UUID_RE.test(productId))
      throw new HttpError(422, 'INVALID_IMPORT', 'productId must be a uuid');
    if (slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug))
      throw new HttpError(422, 'INVALID_IMPORT', 'slug is malformed');
    if (!productId && !slug)
      throw new HttpError(422, 'INVALID_IMPORT', 'productId or slug required');
    const qty = r.qty === undefined ? 1 : Number(r.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99)
      throw new HttpError(422, 'INVALID_IMPORT', 'qty must be 1–99');
    const modifierIds = Array.isArray(r.modifierIds)
      ? r.modifierIds
          .slice(0, 32)
          .filter((m): m is string => typeof m === 'string' && UUID_RE.test(m))
      : [];
    const modifiers = Array.isArray(r.modifiers)
      ? r.modifiers.slice(0, 32).flatMap((m) => {
          const o = m as Record<string, unknown> | null;
          if (typeof o?.id !== 'string' || !UUID_RE.test(o.id)) return [];
          const n = o.qty === undefined ? 1 : Number(o.qty);
          if (!Number.isInteger(n) || n < 1 || n > 20)
            throw new HttpError(422, 'INVALID_IMPORT', 'option qty must be 1–20');
          return [{ id: o.id, qty: n }];
        })
      : [];
    return {
      ...(productId ? { productId } : {}),
      ...(slug ? { slug } : {}),
      qty,
      modifierIds,
      ...(modifiers.length ? { modifiers } : {}),
      comboSelections: parseSelections(r.comboSelections),
    };
  });
}

export async function importLines(
  tx: Sql,
  tenantId: string,
  cartId: string,
  lines: ImportLine[],
): Promise<ImportReport> {
  const report: ImportReport = { added: 0, skipped: [] };
  for (const line of lines) {
    let productId = line.productId ?? null;
    if (!productId && line.slug) {
      productId =
        (
          await tx<{ id: string }[]>`
            select id from products where tenant_id = ${tenantId} and slug = ${line.slug} and status <> 'archived'
          `
        )[0]?.id ?? null;
    }
    if (!productId) {
      report.skipped.push({
        productId: null,
        slug: line.slug ?? null,
        code: 'PRODUCT_NOT_FOUND',
        message: 'product not found',
      });
      continue;
    }
    // savepoint: a failed line (e.g. qty CHECK) must not abort the whole import tx
    try {
      await (
        tx as unknown as { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> }
      ).savepoint((sp) =>
        insertLine(
          sp,
          tenantId,
          cartId,
          {
            productId: productId!,
            qty: line.qty,
            modifierIds: line.modifierIds ?? [],
            modifiers: line.modifiers ?? [],
            comboSelections: line.comboSelections ?? [],
          },
          getProductById,
        ),
      );
      report.added++;
    } catch (err) {
      const e = err as HttpError;
      if (!(e instanceof HttpError)) throw err;
      report.skipped.push({
        productId,
        slug: line.slug ?? null,
        code: e.code,
        message: e.message,
      });
    }
  }
  return report;
}

function shareCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

async function snapshotLines(tx: Sql, tenantId: string, cartId: string): Promise<ImportLine[]> {
  const items = await tx<
    {
      product_id: string;
      slug: string;
      qty: number;
      modifier_ids: string[];
      modifier_qty: Record<string, number>;
      combo_selections: ComboSelection[];
    }[]
  >`
    select ci.product_id, p.slug, ci.qty, ci.modifier_ids, ci.modifier_qty, ci.combo_selections
    from cart_items ci join products p on p.id = ci.product_id
    where ci.tenant_id = ${tenantId} and ci.cart_id = ${cartId} order by ci.created_at
  `;
  if (items.length === 0) throw new HttpError(422, 'EMPTY_CART', 'cart is empty');
  return items.map((i) => ({
    productId: i.product_id,
    slug: i.slug,
    qty: i.qty,
    modifierIds: i.modifier_ids,
    ...qtyLines(Object.entries(i.modifier_qty ?? {}).map(([id, qty]) => ({ id, qty }))),
    comboSelections: i.combo_selections,
  }));
}

export async function createShare(
  tx: Sql,
  tenantId: string,
  cartId: string,
): Promise<{ code: string; expiresAt: string }> {
  const lines = await snapshotLines(tx, tenantId, cartId);
  const code = shareCode();
  const rows = await tx<{ expires_at: Date }[]>`
    insert into cart_shares (tenant_id, code, items, expires_at)
    values (${tenantId}, ${code}, ${tx.json(lines as never)}, now() + make_interval(days => ${SHARE_DAYS}))
    returning expires_at
  `;
  await tx`delete from cart_shares where tenant_id = ${tenantId} and expires_at < now()`;
  return { code, expiresAt: new Date(rows[0]!.expires_at).toISOString() };
}

/** A sacola link: the cart a conversation built, opened once on the shopper's own device (the
 *  storefront's `?cart=CODE`), short-lived, and remembered on the thread that sent it. */
export async function createSacolaLinkTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  threadId: string | null,
  ttlMinutes = 60,
): Promise<{ code: string; expiresAt: string }> {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 24 * 60)
    throw new HttpError(422, 'BAD_REQUEST', 'ttlMinutes must be 5–1440');
  if (threadId !== null && !UUID_RE.test(threadId))
    throw new HttpError(400, 'BAD_REQUEST', 'threadId must be a uuid');
  const lines = await snapshotLines(tx, tenantId, cartId);
  const code = shareCode();
  const rows = await tx<{ expires_at: Date }[]>`
    insert into cart_shares (tenant_id, code, items, expires_at, single_use, thread_id)
    values (${tenantId}, ${code}, ${tx.json(lines as never)},
            now() + make_interval(mins => ${ttlMinutes}), true, ${threadId})
    returning expires_at
  `;
  return { code, expiresAt: new Date(rows[0]!.expires_at).toISOString() };
}

/** A single-use code is spent by the read (the import's claim makes a retry replay, not
 *  re-read); a spent one reads as not found, as old kernels expect. */
export async function readShare(tx: Sql, tenantId: string, code: string): Promise<ImportLine[]> {
  if (!/^[A-Za-z0-9]{6,16}$/.test(code))
    throw new HttpError(404, 'SHARE_NOT_FOUND', 'share link not found');
  const row =
    (
      await tx<{ items: ImportLine[] }[]>`
      update cart_shares set consumed_at = now()
      where tenant_id = ${tenantId} and code = ${code} and expires_at > now()
        and single_use and consumed_at is null
      returning items
    `
    )[0] ??
    (
      await tx<{ items: ImportLine[] }[]>`
        select items from cart_shares
        where tenant_id = ${tenantId} and code = ${code} and expires_at > now() and not single_use
      `
    )[0];
  if (!row) throw new HttpError(404, 'SHARE_NOT_FOUND', 'share link not found or expired');
  return row.items;
}

export async function orderLines(
  tx: Sql,
  tenantId: string,
  orderId: string,
): Promise<ImportLine[]> {
  const rows = await tx<
    {
      product_id: string | null;
      slug: string;
      qty: number;
      modifiers: { id?: string; qty?: number }[];
      combo: { slotId?: string; productId?: string; qty: number }[];
    }[]
  >`
    select product_id, slug, qty, modifiers, combo from order_items
    where tenant_id = ${tenantId} and order_id = ${orderId} order by sort
  `;
  return rows.map((r) => ({
    ...(r.product_id ? { productId: r.product_id } : {}),
    slug: r.slug,
    qty: r.qty,
    modifierIds: r.modifiers.flatMap((m) => (m.id ? [m.id] : [])),
    ...qtyLines(r.modifiers.flatMap((m) => (m.id && m.qty ? [{ id: m.id, qty: m.qty }] : []))),
    comboSelections: r.combo.flatMap((c) =>
      c.slotId && c.productId ? [{ slotId: c.slotId, productId: c.productId, qty: c.qty }] : [],
    ),
  }));
}

function qtyLines(mods: { id: string; qty: number }[]): Pick<ImportLine, 'modifiers'> {
  const modifiers = mods.filter((m) => m.qty > 1);
  return modifiers.length ? { modifiers } : {};
}
