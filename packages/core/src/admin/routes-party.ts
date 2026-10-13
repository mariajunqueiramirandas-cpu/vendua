import { partyProfilesTx } from '../modules/party.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { audit } from './audit.ts';
import type { AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Cardápio › Festa (0126, docs/features/festa-calculada.md §4.1): the store's party profiles —
// guests, groups and the products that fill each group. A save replaces the profile's groups and
// products; a group keeps its id, so the orders that counted it keep counting it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROFILES = 20;
const MAX_GROUPS = 8;
const MAX_PRODUCTS = 20;

interface ProfileIn {
  name: string;
  description: string | null;
  childFactorBps: number;
  minGuests: number;
  maxGuests: number;
  active: boolean;
  groups: {
    id: string | null;
    name: string;
    perGuestMilli: number;
    maxChoices: number;
    required: boolean;
    dailyCapUnits: number | null;
    products: { productId: string; unitsPerSale: number }[];
  }[];
}

const bad = (msg: string, field: string, extra: Record<string, unknown> = {}): never => {
  throw new HttpError(422, 'BAD_REQUEST', msg, { field, ...extra });
};
const text = (v: unknown, field: string, max: number) =>
  typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max
    ? v.trim()
    : bad(`${field}: 1..${max} characters`, field);
const intIn = (v: unknown, field: string, lo: number, hi: number) =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
    ? (v as number)
    : bad(`${field} must be ${lo}..${hi}`, field);
const num = (v: unknown, field: string, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : bad(`${field} must be ${lo}..${hi}`, field);

export function parseProfile(b: Record<string, unknown>): ProfileIn {
  const description =
    b.description == null || (typeof b.description === 'string' && !b.description.trim())
      ? null
      : text(b.description, 'description', 200);
  const minGuests = intIn(b.minGuests, 'minGuests', 1, 1000);
  const maxGuests = intIn(b.maxGuests, 'maxGuests', 1, 1000);
  if (minGuests > maxGuests) bad('minGuests is above maxGuests', 'minGuests');
  if (!Array.isArray(b.groups) || b.groups.length < 1 || b.groups.length > MAX_GROUPS)
    bad(`1..${MAX_GROUPS} groups`, 'groups');
  const seen = new Set<string>();
  const groups = (b.groups as unknown[]).map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return bad('a group is an object', 'groups');
    const g = raw as Record<string, unknown>;
    const id =
      g.id == null
        ? null
        : typeof g.id === 'string' && UUID_RE.test(g.id)
          ? g.id
          : bad('bad group id', 'groups');
    if (!Array.isArray(g.products) || g.products.length > MAX_PRODUCTS)
      bad(`up to ${MAX_PRODUCTS} products a group`, 'groups', { index: i });
    const products = (g.products as unknown[]).map((rp) => {
      const p = (rp ?? {}) as Record<string, unknown>;
      if (typeof p.productId !== 'string' || !UUID_RE.test(p.productId))
        bad('bad product id', 'groups', { index: i });
      if (seen.has(p.productId as string))
        bad('a product sits in one group', 'groups', { index: i, productId: p.productId });
      seen.add(p.productId as string);
      return {
        productId: p.productId as string,
        unitsPerSale: intIn(p.unitsPerSale, 'unitsPerSale', 1, 1000),
      };
    });
    return {
      id,
      name: text(g.name, 'groupName', 40),
      // pieces per guest, up to 3 decimals
      perGuestMilli: Math.round(num(g.perGuest, 'perGuest', 0.001, 100) * 1000),
      maxChoices: intIn(g.maxChoices ?? 3, 'maxChoices', 1, 10),
      required: g.required === undefined ? true : g.required === true,
      dailyCapUnits:
        g.dailyCapUnits == null ? null : intIn(g.dailyCapUnits, 'dailyCapUnits', 1, 1_000_000),
      products,
    };
  });
  return {
    name: text(b.name, 'name', 60),
    description,
    childFactorBps: Math.round(num(b.childFactor ?? 0.5, 'childFactor', 0, 1) * 10_000),
    minGuests,
    maxGuests,
    active: b.active === undefined ? true : b.active === true,
    groups,
  };
}

async function saveProfileTx(tx: Sql, tenantId: string, id: string, p: ProfileIn) {
  // products are checked against the store here: a foreign key doesn't look at RLS
  const ids = p.groups.flatMap((g) => g.products.map((x) => x.productId));
  if (ids.length) {
    const found = await tx<{ id: string }[]>`
      select id from products where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
        and status <> 'archived'`;
    const missing = ids.find((x) => !found.some((f) => f.id === x));
    if (missing)
      throw new HttpError(422, 'BAD_REQUEST', 'a product is not in this store', {
        field: 'groups',
        productId: missing,
      });
  }
  await tx`
    update party_profiles set name = ${p.name}, description = ${p.description},
      child_factor_bps = ${p.childFactorBps}, min_guests = ${p.minGuests},
      max_guests = ${p.maxGuests}, active = ${p.active}
    where tenant_id = ${tenantId} and id = ${id}`;
  const keep = p.groups.map((g) => g.id).filter((x): x is string => !!x);
  await tx`delete from party_group_products where tenant_id = ${tenantId} and profile_id = ${id}`;
  await tx`delete from party_groups where tenant_id = ${tenantId} and profile_id = ${id}
             and not (id = any(${keep}::uuid[]))`;
  for (const [i, g] of p.groups.entries()) {
    const [row] = g.id
      ? await tx<{ id: string }[]>`
          update party_groups set name = ${g.name}, per_guest_milli = ${g.perGuestMilli},
            max_choices = ${g.maxChoices}, required = ${g.required},
            daily_cap_units = ${g.dailyCapUnits}, sort = ${i}
          where tenant_id = ${tenantId} and profile_id = ${id} and id = ${g.id}
          returning id`
      : await tx<{ id: string }[]>`
          insert into party_groups (tenant_id, profile_id, name, per_guest_milli, max_choices,
                                    required, daily_cap_units, sort)
          values (${tenantId}, ${id}, ${g.name}, ${g.perGuestMilli}, ${g.maxChoices},
                  ${g.required}, ${g.dailyCapUnits}, ${i})
          returning id`;
    if (!row)
      throw new HttpError(422, 'BAD_REQUEST', 'a group is not in this profile', {
        field: 'groups',
      });
    for (const [j, x] of g.products.entries())
      await tx`
        insert into party_group_products (tenant_id, profile_id, group_id, product_id,
                                          units_per_sale, sort)
        values (${tenantId}, ${id}, ${row.id}, ${x.productId}, ${x.unitsPerSale}, ${j})`;
  }
}

export function mountParty(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const view = async (tx: Sql, tenantId: string) => ({
    profiles: await partyProfilesTx(tx, tenantId, false),
  });

  admin.get(
    '/party',
    read('attendant', (tx, t) => view(tx, t.id)),
  );

  admin.post(
    '/party/profiles',
    write('manager', async (tx, t, m, c) => {
      const p = parseProfile(await bodyJson(c, 32 * 1024));
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int as n from party_profiles where tenant_id = ${t.id}`;
      if ((n?.n ?? 0) >= MAX_PROFILES)
        throw new HttpError(409, 'LIMIT_REACHED', `up to ${MAX_PROFILES} party profiles`);
      const [row] = await tx<{ id: string }[]>`
        insert into party_profiles (tenant_id, name, min_guests, max_guests, sort)
        values (${t.id}, ${p.name}, ${p.minGuests}, ${p.maxGuests}, ${n?.n ?? 0})
        returning id`;
      await saveProfileTx(tx, t.id, row!.id, p);
      await audit(tx, t.id, m, {
        action: 'party.create',
        entity: 'party_profile',
        entityId: row!.id,
        summary: `criou a festa “${p.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: { id: row!.id, ...(await view(tx, t.id)) } };
    }),
  );

  admin.put(
    '/party/profiles/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const p = parseProfile(await bodyJson(c, 32 * 1024));
      const [cur] = await tx`
        select 1 from party_profiles where tenant_id = ${t.id} and id = ${id} for update`;
      if (!cur) throw new HttpError(404, 'NOT_FOUND', 'party profile not found');
      await saveProfileTx(tx, t.id, id, p);
      await audit(tx, t.id, m, {
        action: 'party.update',
        entity: 'party_profile',
        entityId: id,
        summary: `mudou a festa “${p.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: await view(tx, t.id) };
    }),
  );

  admin.delete(
    '/party/profiles/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const [gone] = await tx<{ name: string }[]>`
        delete from party_profiles where tenant_id = ${t.id} and id = ${id} returning name`;
      if (!gone) throw new HttpError(404, 'NOT_FOUND', 'party profile not found');
      await audit(tx, t.id, m, {
        action: 'party.delete',
        entity: 'party_profile',
        entityId: id,
        summary: `apagou a festa “${gone.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: await view(tx, t.id) };
    }),
  );
}
