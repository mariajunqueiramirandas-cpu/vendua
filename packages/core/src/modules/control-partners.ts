import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, clientIp, uuidParam, windowCounter } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { claimControl, controlTx } from './control.ts';
import { recordStaffEvent } from './staff-events.ts';

// Partners (migration 0120): accountants, suppliers, agencies who bring stores. They apply on the
// site (/parceiros/), staff approve them in the CRM (Lojas → Parceiros), and every plan invoice
// their stores pay in the store's first commission_months earns them commission_bps of it. Staff
// pay what is due by Pix and record the payout here; Core sums it (clients never compute money).

export const PARTNER_KINDS = ['contador', 'fornecedor', 'agencia', 'consultor', 'outro'] as const;
type PartnerKind = (typeof PARTNER_KINDS)[number];
const STATUSES = ['pending', 'active', 'paused', 'rejected'] as const;
type PartnerStatus = (typeof STATUSES)[number];

interface PartnerRow {
  id: string;
  code: string;
  name: string;
  kind: PartnerKind;
  phone: string;
  email: string | null;
  city: string | null;
  pix_key: string | null;
  note: string | null;
  status: PartnerStatus;
  commission_bps: number;
  commission_months: number;
  approved_at: Date | null;
  created_at: Date;
}

const bad = (field: string, message: string) =>
  new HttpError(422, 'BAD_REQUEST', message, { field });

function str(v: unknown, field: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw bad(field, `${field} is required`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw bad(field, `${field} must have ${min}–${max} chars`);
  return s;
}
const optStr = (v: unknown, field: string, max: number) =>
  v === undefined || v === null || v === '' ? null : str(v, field, max);

/** national digits, DDD first: 10 or 11 digits, or with 55 in front */
export function partnerPhoneOr422(v: unknown): string {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  const n = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  if (!/^[1-9][0-9]{9,10}$/.test(n)) throw bad('phone', 'phone must be a Brazilian number');
  return n;
}

function emailOr422(v: unknown): string | null {
  const e = optStr(v, 'email', 120);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('email', 'email is not valid');
  return e?.toLowerCase() ?? null;
}

const kindOr422 = (v: unknown): PartnerKind => {
  if (!PARTNER_KINDS.includes(v as PartnerKind))
    throw bad('kind', `kind must be one of ${PARTNER_KINDS.join(', ')}`);
  return v as PartnerKind;
};

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw bad(field, `${field} must be an integer ${min}–${max}`);
  return v;
}

const codeOr422 = (v: unknown): string => {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(c))
    throw bad('code', 'code must have 3–30 letters, numbers or -');
  return c;
};

/** A readable code from the name, with a random tail: "LIMA-7K2Q". Staff can change it. */
export function partnerCodeFrom(name: string): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .split(' ')
      .filter((w) => w.length > 2)
      .pop()
      ?.slice(0, 12) ?? 'PARCEIRO';
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]);
  return `${base.length >= 3 ? base : 'PARCEIRO'}-${tail.join('')}`;
}

const adminHost = () => process.env.VENDUA_ADMIN_HOST?.trim().toLowerCase() || null;

function partnerOut(
  r: PartnerRow & { stores?: number; due_cents?: number | string; paid_cents?: number | string },
) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    phone: r.phone,
    email: r.email,
    city: r.city,
    pixKey: r.pix_key,
    note: r.note,
    status: r.status,
    commissionBps: r.commission_bps,
    commissionMonths: r.commission_months,
    approvedAt: r.approved_at,
    createdAt: r.created_at,
    /** the link the partner shares: signup with its code (null without VENDUA_ADMIN_HOST) */
    link: adminHost() ? `https://${adminHost()}/admin/comecar?parceiro=${r.code}` : null,
    stores: r.stores ?? 0,
    dueCents: Number(r.due_cents ?? 0),
    paidCents: Number(r.paid_cents ?? 0),
  };
}

export function mountControlPartners(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  idemKey: (c: Context) => string;
  trustProxy: boolean;
  proxyHops: number;
}) {
  const { app, sql, controlGate, idemKey } = o;

  // ── the site's application form ─────────────────────────────────────────
  // Public, through the site's own nginx. Idempotent by its natural key (one application per
  // phone: a repeat answers the same and changes nothing), like signup, and rate limited per IP.
  const allow = windowCounter({ windowMs: 10 * 60_000, max: 5 });
  app.post('/site/v1/partners', async (c) => {
    const ip = clientIp(c, { trustForwardedFor: o.trustProxy, proxyHops: o.proxyHops });
    if (!allow(ip)) throw new HttpError(429, 'RATE_LIMITED', 'too many requests — wait a little');
    const body = await bodyJson(c, 4096);
    // a bot fills every field it sees; people never see this one
    if (typeof body.website === 'string' && body.website !== '')
      return c.json({ received: true }, 202);
    const name = str(body.name, 'name', 80, 2);
    const kind = kindOr422(body.kind);
    const phone = partnerPhoneOr422(body.phone);
    const email = emailOr422(body.email);
    const city = optStr(body.city, 'city', 80);
    const note = optStr(body.note, 'note', 500);
    const before = await controlTx(
      sql,
      (tx) => tx<{ id: string }[]>`select id from partners where phone = ${phone}`,
    );
    await sql`
      select apply_partner(${name}, ${kind}, ${phone}, ${email}, ${city}, ${note},
                           ${partnerCodeFrom(name)})
    `;
    if (!before[0])
      await recordStaffEvent(
        sql,
        'partner.applied',
        { name, kind, city },
        {
          dedupeKey: `partner.applied:${phone}`,
        },
      ).catch(() => {});
    return c.json({ received: true }, 202);
  });

  // ── the CRM ───────────────────────────────────────────────────────────────

  app.get('/control/v1/partners', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) => tx<(PartnerRow & { stores: number; due_cents: string; paid_cents: string })[]>`
        select p.*,
          (select count(*) from store_referrals r where r.partner_id = p.id)::int as stores,
          coalesce((select sum(commission_cents) from partner_commissions k
                    where k.partner_id = p.id and k.status = 'due'), 0)::bigint as due_cents,
          coalesce((select sum(commission_cents) from partner_commissions k
                    where k.partner_id = p.id and k.status = 'paid'), 0)::bigint as paid_cents
        from partners p
        order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end,
          p.created_at desc
        limit 500
      `,
    );
    const referrals = await controlTx(
      sql,
      (tx) => tx<
        {
          tenant_id: string;
          name: string;
          slug: string;
          referrer: string | null;
          created_at: Date;
          rewarded_at: Date | null;
        }[]
      >`
        select r.tenant_id, t.name, t.slug, rt.name as referrer, r.created_at, r.rewarded_at
        from store_referrals r
        join tenants t on t.id = r.tenant_id
        left join tenants rt on rt.id = r.referrer_tenant_id
        where r.referrer_tenant_id is not null
        order by r.created_at desc limit 100
      `,
    );
    return c.json({
      partners: rows.map(partnerOut),
      // store-to-store referrals, newest first: who brought whom, and whether the month was earned
      referrals: referrals.map((r) => ({
        tenantId: r.tenant_id,
        name: r.name,
        slug: r.slug,
        referrer: r.referrer,
        createdAt: r.created_at,
        rewardedAt: r.rewarded_at,
      })),
    });
  });

  app.get('/control/v1/partners/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    return c.json(
      await controlTx(sql, async (tx) => {
        const p = (
          await tx<(PartnerRow & { stores: number; due_cents: string; paid_cents: string })[]>`
            select p.*,
              (select count(*) from store_referrals r where r.partner_id = p.id)::int as stores,
              coalesce((select sum(commission_cents) from partner_commissions k
                        where k.partner_id = p.id and k.status = 'due'), 0)::bigint as due_cents,
              coalesce((select sum(commission_cents) from partner_commissions k
                        where k.partner_id = p.id and k.status = 'paid'), 0)::bigint as paid_cents
            from partners p where p.id = ${id}
          `
        )[0];
        if (!p) throw new HttpError(404, 'NOT_FOUND', 'partner not found');
        const [stores, commissions, payouts] = await Promise.all([
          tx<{ tenant_id: string; name: string; slug: string; created_at: Date }[]>`
            select r.tenant_id, t.name, t.slug, r.created_at from store_referrals r
            join tenants t on t.id = r.tenant_id where r.partner_id = ${id}
            order by r.created_at desc limit 500
          `,
          tx<
            {
              id: string;
              store: string;
              number: number;
              paid_cents: number;
              commission_cents: number;
              status: string;
              created_at: Date;
            }[]
          >`
            select k.id, t.name as store, i.number, k.paid_cents, k.commission_cents, k.status,
              k.created_at
            from partner_commissions k
            join tenants t on t.id = k.tenant_id join invoices i on i.id = k.invoice_id
            where k.partner_id = ${id} order by k.created_at desc limit 500
          `,
          tx<
            {
              id: string;
              total_cents: number;
              commissions: number;
              paid_at: Date;
              note: string | null;
            }[]
          >`
            select id, total_cents, commissions, paid_at, note from partner_payouts
            where partner_id = ${id} order by paid_at desc limit 100
          `,
        ]);
        return {
          partner: partnerOut(p),
          stores: stores.map((s) => ({
            tenantId: s.tenant_id,
            name: s.name,
            slug: s.slug,
            createdAt: s.created_at,
          })),
          commissions: commissions.map((k) => ({
            id: k.id,
            store: k.store,
            invoiceNumber: k.number,
            paidCents: k.paid_cents,
            commissionCents: k.commission_cents,
            status: k.status,
            createdAt: k.created_at,
          })),
          payouts: payouts.map((x) => ({
            id: x.id,
            totalCents: x.total_cents,
            commissions: x.commissions,
            paidAt: x.paid_at,
            note: x.note,
          })),
        };
      }),
    );
  });

  // staff add a partner they met (it starts active) or fix one's details
  app.post('/control/v1/partners', async (c) => {
    controlGate(c);
    const body = await bodyJson(c, 4096);
    const name = str(body.name, 'name', 80, 2);
    const kind = kindOr422(body.kind);
    const phone = partnerPhoneOr422(body.phone);
    const email = emailOr422(body.email);
    const city = optStr(body.city, 'city', 80);
    const pixKey = optStr(body.pixKey, 'pixKey', 120);
    const note = optStr(body.note, 'note', 500);
    const code = body.code ? codeOr422(body.code) : partnerCodeFrom(name);
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const row = (
        await tx<PartnerRow[]>`
          insert into partners (code, name, kind, phone, email, city, pix_key, note, status,
                                approved_at, approved_by)
          values (${code}, ${name}, ${kind}, ${phone}, ${email}, ${city}, ${pixKey}, ${note},
                  'active', now(), 'equipe')
          on conflict do nothing
          returning *
        `
      )[0];
      if (!row)
        throw new HttpError(409, 'PARTNER_EXISTS', 'a partner has this phone or code', {
          field: 'phone',
        });
      return { status: 201, body: { partner: partnerOut(row) } };
    });
    return c.json(res.body, res.status as 201);
  });

  app.patch('/control/v1/partners/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c, 4096);
    if (body.status !== undefined && !STATUSES.includes(body.status as PartnerStatus))
      throw bad('status', `status must be one of ${STATUSES.join(', ')}`);
    const status = body.status as PartnerStatus | undefined;
    const set = {
      name: body.name === undefined ? undefined : str(body.name, 'name', 80, 2),
      kind: body.kind === undefined ? undefined : kindOr422(body.kind),
      email: body.email === undefined ? undefined : emailOr422(body.email),
      city: body.city === undefined ? undefined : optStr(body.city, 'city', 80),
      pixKey: body.pixKey === undefined ? undefined : optStr(body.pixKey, 'pixKey', 120),
      note: body.note === undefined ? undefined : optStr(body.note, 'note', 500),
      code: body.code === undefined ? undefined : codeOr422(body.code),
      bps:
        body.commissionBps === undefined
          ? undefined
          : intIn(body.commissionBps, 'commissionBps', 0, 5000),
      months:
        body.commissionMonths === undefined
          ? undefined
          : intIn(body.commissionMonths, 'commissionMonths', 1, 60),
    };
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const keep = <T>(v: T | undefined, col: string) => (v === undefined ? tx(col) : v);
      const row = (
        await tx<PartnerRow[]>`
          update partners set
            status = ${status ?? tx`status`},
            name = ${keep(set.name, 'name')}, kind = ${keep(set.kind, 'kind')},
            email = ${keep(set.email, 'email')}, city = ${keep(set.city, 'city')},
            pix_key = ${keep(set.pixKey, 'pix_key')}, note = ${keep(set.note, 'note')},
            code = ${keep(set.code, 'code')},
            commission_bps = ${keep(set.bps, 'commission_bps')},
            commission_months = ${keep(set.months, 'commission_months')},
            approved_at = case when ${status === 'active'} and approved_at is null then now()
                               else approved_at end,
            approved_by = case when ${status === 'active'} and approved_by is null then 'equipe'
                               else approved_by end,
            updated_at = now()
          where id = ${id}
          returning *
        `.catch((err: { code?: string }) => {
          if (err.code === '23505')
            throw new HttpError(409, 'PARTNER_CODE_TAKEN', 'another partner has this code', {
              field: 'code',
            });
          throw err;
        })
      )[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'partner not found');
      return { status: 200, body: { partner: partnerOut(row) } };
    });
    return c.json(res.body, res.status as 200);
  });

  // Staff sent the partner a Pix for everything due: one payout settles every due commission.
  // The total is Core's sum at that moment, never a number the CRM sends.
  app.post('/control/v1/partners/:id/payouts', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c, 2048);
    const note = optStr(body.note, 'note', 300);
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const p = (await tx<PartnerRow[]>`select * from partners where id = ${id} for update`)[0];
      if (!p) throw new HttpError(404, 'NOT_FOUND', 'partner not found');
      const due = await tx<{ id: string; commission_cents: number }[]>`
        select id, commission_cents from partner_commissions
        where partner_id = ${id} and status = 'due' for update
      `;
      const total = due.reduce((t, k) => t + k.commission_cents, 0);
      if (!due.length || total <= 0)
        throw new HttpError(409, 'NOTHING_DUE', 'this partner has nothing due');
      const payout = (
        await tx<{ id: string; paid_at: Date }[]>`
          insert into partner_payouts (partner_id, total_cents, commissions, note, paid_by)
          values (${id}, ${total}, ${due.length}, ${note}, 'equipe')
          returning id, paid_at
        `
      )[0]!;
      await tx`
        update partner_commissions set status = 'paid', payout_id = ${payout.id}
        where id = any (${due.map((k) => k.id)}::uuid[])
      `;
      return {
        status: 201,
        body: {
          payout: {
            id: payout.id,
            totalCents: total,
            commissions: due.length,
            paidAt: payout.paid_at,
            note,
          },
        },
      };
    });
    return c.json(res.body, res.status as 201);
  });
}
