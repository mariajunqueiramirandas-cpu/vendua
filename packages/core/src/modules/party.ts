import { withTenant, type Sql } from '../platform/db.ts';
import type { CartParty, OrderParty } from './encomenda-capacity.ts';
import { enqueueEveReminderTx } from '../store-whatsapp/messages.ts';
import type { Context } from 'hono';
import { bodyJson, HttpError, sessionCartId } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { assertCartOpen, loadCartView } from './cart.ts';
import { importLines, type ImportReport } from './cart-share.ts';
import {
  groupUnits,
  guestsMilli,
  lineReason,
  PARTY_LINE_QTY_MAX,
  splitGroup,
  type PartyLinePlan,
} from './party-math.ts';

// Festa calculada F0 + F1 (0126, docs/features/festa-calculada.md): the store's party profiles,
// the quote (guests → whole sales of the store's own products), the cart built from it, and the
// ceiling on a day's encomendas. Paid in full: the sinal (F2) waits on its legal review.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the cart-share import cap */
const MAX_PARTY_LINES = 40;

// ── profiles (F1) ─────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  name: string;
  description: string | null;
  child_factor_bps: number;
  min_guests: number;
  max_guests: number;
  active: boolean;
  sort: number;
}
interface GroupRow {
  id: string;
  profile_id: string;
  name: string;
  per_guest_milli: number;
  max_choices: number;
  required: boolean;
  daily_cap_units: number | null;
  sort: number;
}
interface PickRow {
  group_id: string;
  product_id: string;
  units_per_sale: number;
  sort: number;
  name: string;
  slug: string;
  status: string;
  needs_choices: boolean;
}

/** a product that can't go in the bag as it is: a required option, or a kit to fill. The
 *  calculator adds plain lines, so such a product has no place in a party. */
export const needsChoices = (tx: Sql) => tx`(
  exists (select 1 from modifier_groups mg where mg.product_id = p.id and mg.required)
  or exists (select 1 from combo_slots cs where cs.product_id = p.id and cs.min_select > 0))`;

export interface PartyProfile {
  id: string;
  name: string;
  description: string | null;
  /** how much a child counts, 0..1 */
  childFactor: number;
  minGuests: number;
  maxGuests: number;
  active: boolean;
  groups: {
    id: string;
    name: string;
    /** pieces per guest (1.5 = one and a half) */
    perGuest: number;
    maxChoices: number;
    required: boolean;
    dailyCapUnits: number | null;
    products: {
      productId: string;
      name: string;
      slug: string;
      unitsPerSale: number;
      /** admin view: the product asks for a choice, so the calculator can't add it */
      needsChoices?: boolean;
    }[];
  }[];
}

/** The store's profiles; `forShopper` keeps the active ones and the products on sale. */
export async function partyProfilesTx(
  tx: Sql,
  tenantId: string,
  forShopper: boolean,
): Promise<PartyProfile[]> {
  const [profiles, groups, picks] = await Promise.all([
    tx<ProfileRow[]>`
      select id, name, description, child_factor_bps, min_guests, max_guests, active, sort
      from party_profiles where tenant_id = ${tenantId} ${forShopper ? tx`and active` : tx``}
      order by sort, created_at`,
    tx<GroupRow[]>`
      select id, profile_id, name, per_guest_milli, max_choices, required, daily_cap_units, sort
      from party_groups where tenant_id = ${tenantId} order by sort, name`,
    tx<PickRow[]>`
      select gp.group_id, gp.product_id, gp.units_per_sale, gp.sort, p.name, p.slug, p.status,
             ${needsChoices(tx)} as needs_choices
      from party_group_products gp join products p on p.id = gp.product_id
      where gp.tenant_id = ${tenantId} ${forShopper ? tx`and p.status = 'active'` : tx`and p.status <> 'archived'`}
      order by gp.sort, p.name`,
  ]);
  return profiles
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      childFactor: p.child_factor_bps / 10_000,
      minGuests: p.min_guests,
      maxGuests: p.max_guests,
      active: p.active,
      groups: groups
        .filter((g) => g.profile_id === p.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          perGuest: g.per_guest_milli / 1000,
          maxChoices: g.max_choices,
          required: g.required,
          dailyCapUnits: g.daily_cap_units,
          products: picks
            .filter((x) => x.group_id === g.id && !(forShopper && x.needs_choices))
            .map((x) => ({
              productId: x.product_id,
              name: x.name,
              slug: x.slug,
              unitsPerSale: x.units_per_sale,
              ...(forShopper ? {} : { needsChoices: x.needs_choices }),
            })),
        }))
        .filter((g) => !forShopper || g.products.length > 0),
    }))
    .filter((p) => !forShopper || p.groups.length > 0);
}

// ── the quote ─────────────────────────────────────────────────────────────────

export interface PartyQuoteIn {
  profileId: string;
  adults: number;
  children: number;
  /** groupId → the products picked in it */
  choices: Record<string, string[]>;
}

export interface PartyQuote {
  profileId: string;
  adults: number;
  children: number;
  /** guests as adults (children by the store's factor), for "~35 pessoas" */
  guests: number;
  groups: { groupId: string; name: string; units: number }[];
  lines: (Omit<PartyLinePlan, 'wanted'> & { name: string; unitsPerSale: number; reason: string })[];
}

const invalid = (msg: string, field: string): never => {
  throw new HttpError(422, 'INVALID_PARTY', msg, { field });
};

export function parsePartyInput(body: Record<string, unknown>): PartyQuoteIn {
  const id = body.profileId;
  if (typeof id !== 'string' || !UUID_RE.test(id)) invalid('profileId must be an id', 'profileId');
  const int = (v: unknown, f: string) =>
    v === undefined
      ? 0
      : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000
        ? (v as number)
        : invalid(`${f} must be 0..1000`, f);
  const adults = int(body.adults, 'adults');
  const children = int(body.children, 'children');
  const raw = body.choices;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    invalid('choices must be an object', 'choices');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) invalid('too many groups', 'choices');
  const choices: Record<string, string[]> = {};
  for (const [g, list] of entries) {
    if (!UUID_RE.test(g)) invalid('a group must be an id', 'choices');
    if (
      !Array.isArray(list) ||
      list.length > 10 ||
      list.some((x) => typeof x !== 'string' || !UUID_RE.test(x))
    )
      invalid('a group takes up to 10 product ids', 'choices');
    choices[g] = [...new Set(list as string[])];
  }
  return { profileId: id as string, adults, children, choices };
}

/** Guests and picks → whole sales of each product. Pure Core arithmetic; nothing is written. */
export async function quotePartyTx(
  tx: Sql,
  tenantId: string,
  input: PartyQuoteIn,
): Promise<PartyQuote> {
  const profile = (await partyProfilesTx(tx, tenantId, true)).find((p) => p.id === input.profileId);
  if (!profile) throw new HttpError(404, 'NOT_FOUND', 'party profile not found');
  const guests = input.adults + input.children;
  if (guests < profile.minGuests || guests > profile.maxGuests)
    throw new HttpError(
      422,
      'INVALID_PARTY',
      `guests must be ${profile.minGuests}..${profile.maxGuests}`,
      {
        field: 'adults',
        min: profile.minGuests,
        max: profile.maxGuests,
      },
    );
  for (const g of Object.keys(input.choices))
    if (!profile.groups.some((x) => x.id === g))
      invalid('a group is not in this profile', 'choices');
  const gm = guestsMilli(input.adults, input.children, Math.round(profile.childFactor * 10_000));
  const groups: PartyQuote['groups'] = [];
  const lines: PartyQuote['lines'] = [];
  for (const g of profile.groups) {
    const picked = input.choices[g.id] ?? [];
    if (picked.length > g.maxChoices)
      throw new HttpError(422, 'INVALID_PARTY', `pick up to ${g.maxChoices} in ${g.name}`, {
        field: 'choices',
        groupId: g.id,
      });
    if (!picked.length) {
      if (g.required)
        throw new HttpError(422, 'INVALID_PARTY', `pick something in ${g.name}`, {
          field: 'choices',
          groupId: g.id,
        });
      continue;
    }
    const picks = picked.map((pid) => {
      const p = g.products.find((x) => x.productId === pid);
      if (!p)
        throw new HttpError(422, 'INVALID_PARTY', 'a product is not in this group', {
          field: 'choices',
          groupId: g.id,
        });
      return p;
    });
    const units = groupUnits(gm, Math.round(g.perGuest * 1000));
    groups.push({ groupId: g.id, name: g.name, units });
    for (const l of splitGroup(g.id, units, picks)) {
      const p = picks.find((x) => x.productId === l.productId)!;
      if (l.qty > PARTY_LINE_QTY_MAX)
        throw new HttpError(422, 'PARTY_TOO_BIG', `${p.name}: more than ${PARTY_LINE_QTY_MAX}`, {
          productId: p.productId,
          groupId: g.id,
        });
      lines.push({
        productId: l.productId,
        groupId: l.groupId,
        qty: l.qty,
        units: l.units,
        name: p.name,
        unitsPerSale: p.unitsPerSale,
        reason: lineReason(g.name, units, l, p.unitsPerSale),
      });
    }
  }
  if (!lines.length) invalid('pick at least one product', 'choices');
  if (lines.length > MAX_PARTY_LINES) invalid(`at most ${MAX_PARTY_LINES} lines`, 'choices');
  return {
    profileId: profile.id,
    adults: input.adults,
    children: input.children,
    guests: Math.ceil(gm / 1000),
    groups,
    lines,
  };
}

/**
 * The quote, put in the shopper's cart: what was there gives way to the party (the storefront
 * asks first), each line goes in at today's price, and what can't be sold now comes back in the
 * report as for a shared bag. The cart remembers the guests; the order freezes the units.
 */
export async function buildPartyCartTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  input: PartyQuoteIn,
): Promise<{ quote: PartyQuote; report: ImportReport }> {
  const quote = await quotePartyTx(tx, tenantId, input);
  await tx`delete from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId}`;
  const report = await importLines(
    tx,
    tenantId,
    cartId,
    quote.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
  );
  const party: CartParty = {
    profileId: quote.profileId,
    adults: quote.adults,
    children: quote.children,
  };
  await tx`update carts set party = ${tx.json(party as never)}, updated_at = now()
           where tenant_id = ${tenantId} and id = ${cartId}`;
  return { quote, report };
}

/** At placement: the units each group of the cart's profile holds in the final lines. */
export async function orderPartyTx(
  tx: Sql,
  tenantId: string,
  party: CartParty,
  lines: readonly { productId: string; qty: number }[],
): Promise<OrderParty> {
  const map = await tx<{ product_id: string; group_id: string; units_per_sale: number }[]>`
    select product_id, group_id, units_per_sale from party_group_products
    where tenant_id = ${tenantId} and profile_id = ${party.profileId}`;
  const units = new Map<string, number>();
  for (const l of lines) {
    const m = map.find((x) => x.product_id === l.productId);
    if (m) units.set(m.group_id, (units.get(m.group_id) ?? 0) + l.qty * m.units_per_sale);
  }
  return {
    profileId: party.profileId,
    adults: party.adults,
    children: party.children,
    groups: [...units].map(([groupId, u]) => ({ groupId, units: u })),
  };
}

// ── the day before (F0) ───────────────────────────────────────────────────────

/** from this store-local hour the day before, the D−1 reminders go out */
const EVE_FROM = '09:00';

/**
 * The admin sweep, once a minute per store: tomorrow's encomendas (store time), from 9h, each
 * reminded once from the store's WhatsApp. An order placed in the last 12 hours just heard from
 * the store and is left alone. Returns how many were queued.
 */
export async function eveReminderPass(sql: Sql, tenantId: string, now = new Date()) {
  return withTenant(sql, tenantId, async (tx) => {
    const due = await tx<{ id: string }[]>`
      with tz as (
        select coalesce(hours ->> 'timezone', 'America/Sao_Paulo') as z, encomenda_reminder as on_
        from store_settings where tenant_id = ${tenantId}
      )
      select o.id from orders o, tz
      where tz.on_ and o.tenant_id = ${tenantId}
        and (${now}::timestamptz at time zone tz.z)::time >= ${EVE_FROM}::time
        and o.scheduled_for = (${now}::timestamptz at time zone tz.z)::date + 1
        and o.state not in ('cancelled', 'refunded', 'delivered')
        and o.placed_at < ${now}::timestamptz - interval '12 hours'
        and not exists (select 1 from store_wa_messages m
                        where m.order_id = o.id and m.event = 'reminder_eve')
      order by o.placed_at limit 50`;
    let queued = 0;
    for (const o of due) if (await enqueueEveReminderTx(tx, tenantId, o.id)) queued++;
    return queued;
  });
}

// ── routes ────────────────────────────────────────────────────────────────────

type Handler = (c: Context) => Promise<Response>;

/**
 * Shopper side: `GET /storefront/v1/party` (the profiles), `POST /checkout/v1/party/quote` (the
 * quantities, nothing written) and `POST /checkout/v1/cart/party` (the session's cart becomes
 * the party).
 */
export function mountParty(d: {
  storefront: { get: (p: string, h: Handler) => unknown };
  checkout: { post: (p: string, h: Handler) => unknown };
  sql: Sql;
  sessionSecret: string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => Handler;
}) {
  d.storefront.get('/party', async (c) => {
    const tenant = c.get('tenant') as Tenant;
    const profiles = await withTenant(d.sql, tenant.id, (tx) =>
      partyProfilesTx(tx, tenant.id, true),
    );
    c.header('cache-control', 'no-store');
    return c.json({
      profiles: profiles.map(({ active: _a, ...p }) => ({
        ...p,
        groups: p.groups.map(({ dailyCapUnits: _c, ...g }) => g),
      })),
    });
  });
  d.checkout.post(
    '/party/quote',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const input = parsePartyInput(await bodyJson(c, 8 * 1024));
      return { status: 200, body: { quote: await quotePartyTx(tx, tenant.id, input) } };
    }),
  );
  d.checkout.post(
    '/cart/party',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      const input = parsePartyInput(await bodyJson(c, 8 * 1024));
      await assertCartOpen(tx, tenant.id, cartId);
      const { quote, report } = await buildPartyCartTx(tx, tenant.id, cartId, input);
      return {
        status: 200,
        body: { cart: await loadCartView(tx, tenant.id, cartId), quote, report },
      };
    }),
  );
}
