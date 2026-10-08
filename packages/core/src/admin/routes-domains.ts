import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { withTenant } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { accountView } from '../modules/billing/account.ts';
import {
  checkCustomDomain,
  hostTaken,
  newVerifyToken,
  normalizeHost,
  type CustomDomainRow,
} from '../modules/billing/domains.ts';
import { cpfCnpj, validDocument, validEmail } from '../modules/billing/input.ts';
import { planHas, requireFeature, tenantPlan } from '../modules/billing/plans.ts';
import { lockBilling } from '../modules/billing/subscriptions.ts';
import {
  aliasOf,
  comBrLabel,
  isRoot,
  labelFromQuery,
  suggestions,
} from '../modules/domains/hosts.ts';
import { recheckDomain } from '../modules/domains/lifecycle.ts';
import { discoverRecords, parseRecords } from '../modules/domains/records.ts';
import type { HolderAddress } from '../modules/domains/providers.ts';
import { audit } from './audit.ts';
import { need, text, type AdminCtx, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Pangolim's own domain (ADR 0038): connect one the owner has (records at their DNS, or their
// nameservers delegated to Venduá's zone), or have Venduá register a .com.br in the store's name.
// Owner only. Writes are idempotent (handlers.write); the reads that call DNS, RDAP, the registrar
// or the CNPJ record run with no transaction open.

const UFS = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
);

function holderAddress(v: unknown): HolderAddress {
  const a = (v ?? {}) as Record<string, unknown>;
  if (typeof v !== 'object' || v === null)
    throw new HttpError(422, 'BAD_REQUEST', 'address is required', { field: 'holder.address' });
  const f = (k: string, max: number, min = 1) => text(a[k], `holder.address.${k}`, max, min);
  const state = f('state', 2, 2).toUpperCase();
  if (!UFS.has(state))
    throw new HttpError(422, 'BAD_REQUEST', 'state must be a UF', {
      field: 'holder.address.state',
    });
  const postalCode = f('postalCode', 9, 8).replace(/\D/g, '');
  if (postalCode.length !== 8)
    throw new HttpError(422, 'BAD_REQUEST', 'postal code has 8 digits', {
      field: 'holder.address.postalCode',
    });
  const complement =
    a.complement === undefined || a.complement === null || a.complement === ''
      ? undefined
      : f('complement', 60);
  return {
    street: f('street', 120),
    number: f('number', 20),
    ...(complement ? { complement } : {}),
    district: f('district', 60),
    city: f('city', 60),
    state,
    postalCode,
  };
}

function holderPhone(v: unknown): string {
  let digits = text(v, 'holder.phone', 30, 8).replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  if (!/^[1-9]{2}\d{8,9}$/.test(digits))
    throw new HttpError(422, 'BAD_REQUEST', 'phone with area code, like (11) 91234-5678', {
      field: 'holder.phone',
    });
  return digits;
}

export function mountDomains(d: AdminDeps) {
  const { admin } = d;
  const { write } = handlers(d);
  const p = d.domains;
  const view = (tx: Sql, t: Tenant) =>
    accountView(tx, t, { storeDomain: d.storeDomain, provider: d.provider, domains: p });
  const delegation = () => !!(p.dnsHost && p.edge);
  const purchase = () => delegation() && !!p.registrar;

  const current = async (tx: Sql, tenantId: string) =>
    (
      await tx<CustomDomainRow[]>`
        select * from custom_domains where tenant_id = ${tenantId} and status <> 'removing'
        for update
      `
    )[0];

  // ── connect a domain the owner already has ────────────────────────────────
  admin.post(
    '/account/domains',
    write('owner', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'customDomain');
      const body = await bodyJson(c);
      const host = normalizeHost(body.host, d.storeDomain);
      const method = body.method === undefined ? 'cname' : body.method;
      if (method !== 'cname' && method !== 'ns')
        throw new HttpError(422, 'BAD_REQUEST', 'method is cname or ns', { field: 'method' });
      if (method === 'ns') {
        if (!delegation())
          throw new HttpError(503, 'DELEGATION_UNAVAILABLE', 'nameserver delegation is not set up');
        if (!isRoot(host))
          throw new HttpError(
            422,
            'DOMAIN_NOT_ROOT',
            'delegate the domain itself, like loja.com.br',
            {
              field: 'host',
            },
          );
      }
      await lockBilling(tx, t.id);
      const cur = await current(tx, t.id);
      const order = (
        await tx`
          select 1 from domain_orders where tenant_id = ${t.id} and kind = 'register'
            and status in ('awaiting_payment', 'queued', 'pending', 'conflict')
        `
      ).length;
      if (order || cur?.source === 'included')
        throw new HttpError(409, 'DOMAIN_INCLUDED', 'the store has a domain Venduá registers');
      if (cur?.host === host && cur.method === method) {
        // trying again after giving up: a fresh week to set the DNS (same TXT token)
        if (cur.status === 'failed' && !(await hostTaken(d.sql, host, t.id)))
          await tx`
            update custom_domains set status = 'pending_dns', created_at = now(), last_error = null
            where id = ${cur.id}
          `;
        return { status: 200, body: await view(tx, t) };
      }
      if (cur && ((cur.status !== 'pending_dns' && cur.status !== 'failed') || cur.zone_id))
        throw new HttpError(409, 'DOMAIN_ACTIVE', 'the store already serves its own domain');
      if (await hostTaken(d.sql, host, t.id))
        throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
          field: 'host',
        });
      // one own domain per store: a new one replaces one that never went live
      if (cur) await tx`delete from custom_domains where id = ${cur.id}`;
      let row: { id: string };
      try {
        row = (
          await tx<{ id: string }[]>`
            insert into custom_domains (tenant_id, host, verify_token, method, alias_host)
            values (${t.id}, ${host}, ${newVerifyToken()}, ${method}, ${aliasOf(host)})
            returning id
          `
        )[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
            field: 'host',
          });
        throw err;
      }
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.add',
        entity: 'custom_domain',
        entityId: row.id,
        summary: `adicionou o domínio ${host}`,
        before: cur ? { host: cur.host } : null,
        after: { host, method },
      });
      return { status: 201, body: await view(tx, t) };
    }),
  );

  // DNS and RDAP answers can take seconds: the check runs first, with no transaction open, and
  // the idempotent write only records it and returns the view
  const checked = write('owner', async (tx, t, m, c) => {
    const id = uuidParam(c, 'id');
    const row = (
      await tx<{ host: string }[]>`
        select host from custom_domains where tenant_id = ${t.id} and id = ${id}
      `
    )[0];
    if (!row) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
    await audit(tx, t.id, m, {
      action: 'domain.check',
      entity: 'custom_domain',
      entityId: id,
      summary: `verificou o domínio ${row.host}`,
    });
    return { status: 200, body: await view(tx, t) };
  });
  admin.post('/account/domains/:id/check', async (c) => {
    need(c, 'owner');
    const t = (c as AdminCtx).get('tenant');
    const id = uuidParam(c, 'id');
    const now = new Date();
    // under repair, the live re-check: back to active as soon as DNS points here again
    await recheckDomain(
      d.sql,
      { providers: p, notify: d.notify, storeDomain: d.storeDomain },
      t.id,
      id,
      now,
    );
    await checkCustomDomain(d.sql, {
      tenantId: t.id,
      domainId: id,
      storeDomain: d.storeDomain,
      now,
      manual: true,
      rdap: p.rdap,
      ...(p.edge ? { edgeIps: [p.edge.ipv4] } : {}),
    });
    return checked(c as AdminCtx);
  });

  admin.delete(
    '/account/domains/:id',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<CustomDomainRow[]>`
          select * from custom_domains where tenant_id = ${t.id} and id = ${id} for update
        `
      )[0];
      if (!row || row.status === 'removing')
        throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
      if (row.source === 'included')
        throw new HttpError(409, 'DOMAIN_INCLUDED', 'the store keeps the domain Venduá registered');
      // a domain that was ever routed or hosted leaves through the jobs: off the resolver, the
      // zone deleted, then the row (it stops showing at once)
      const routed = row.zone_id || !['pending_dns', 'failed'].includes(row.status);
      if (routed) await tx`update custom_domains set status = 'removing' where id = ${id}`;
      else await tx`delete from custom_domains where tenant_id = ${t.id} and id = ${id}`;
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.remove',
        entity: 'custom_domain',
        entityId: id,
        summary: `removeu o domínio ${row.host}`,
        before: { host: row.host, status: row.status },
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  // ── a delegated domain's own records ──────────────────────────────────────
  admin.post('/account/domains/:id/discover', async (c) => {
    need(c, 'owner');
    const t = (c as AdminCtx).get('tenant');
    const id = uuidParam(c, 'id');
    const row = await withTenant(
      d.sql,
      t.id,
      async (tx) =>
        (
          await tx<{ host: string }[]>`
            select host from custom_domains where tenant_id = ${t.id} and id = ${id}
              and status <> 'removing'
          `
        )[0],
    );
    if (!row) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
    c.header('cache-control', 'no-store');
    return c.json({ records: await discoverRecords(row.host) });
  });

  admin.put(
    '/account/domains/:id/records',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 64 * 1024);
      const records = parseRecords(body.records);
      const row = (
        await tx<CustomDomainRow[]>`
          select * from custom_domains where tenant_id = ${t.id} and id = ${id}
            and status <> 'removing' for update
        `
      )[0];
      if (!row) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
      if (row.method !== 'ns')
        throw new HttpError(409, 'NOT_HOSTED', 'Venduá does not host this domain’s records');
      await tx`
        update custom_domains set records = ${tx.json(records as never)},
          records_updated_at = now(),
          records_confirmed_at = ${body.confirm === true ? tx`coalesce(records_confirmed_at, now())` : tx`records_confirmed_at`}
        where id = ${id}
      `;
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.records',
        entity: 'custom_domain',
        entityId: id,
        summary: `${body.confirm === true ? 'confirmou' : 'mudou'} os registros de ${row.host}`,
        after: { count: records.length },
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  // ── a .com.br Venduá registers ────────────────────────────────────────────
  admin.get('/account/domains/search', async (c) => {
    need(c, 'owner');
    const t = (c as AdminCtx).get('tenant');
    const q = (c.req.query('q') ?? '').slice(0, 100);
    const label = labelFromQuery(q);
    const hosts = label || q.trim() === '' ? suggestions(label, t.name, t.slug) : [];
    // the registrar knows best (premium and reserved names); registro.br's RDAP when it can't answer
    const got =
      p.registrar && hosts.length ? await p.registrar.check(hosts).catch(() => null) : null;
    const found = new Map<string, boolean | null>(
      got
        ? hosts.map((h) => [h, got.get(h)?.available ?? null] as const)
        : await Promise.all(
            hosts.map(async (h) => {
              const info = await p.rdap(h).catch(() => null);
              return [h, info ? !info.registered : null] as const;
            }),
          ),
    );
    const results = [];
    for (const h of hosts) {
      const free = found.get(h) ?? null;
      results.push({
        host: h,
        available: free && (await hostTaken(d.sql, h, t.id, { registering: true })) ? false : free,
      });
    }
    c.header('cache-control', 'no-store');
    return c.json({ query: label ? `${label}.com.br` : '', results, purchase: purchase() });
  });

  admin.get('/account/domains/holder', async (c) => {
    need(c, 'owner');
    const doc = cpfCnpj((c.req.query('document') ?? '').slice(0, 40));
    if (!doc)
      throw new HttpError(422, 'BAD_REQUEST', 'cpf or cnpj looks wrong', { field: 'document' });
    const kind = doc.length === 11 ? 'cpf' : 'cnpj';
    const rec = kind === 'cnpj' ? await p.cnpj(doc).catch(() => null) : null;
    c.header('cache-control', 'no-store');
    return c.json({ kind, document: doc, name: rec?.name ?? null, address: rec?.address ?? null });
  });

  admin.post(
    '/account/domains/order',
    write('owner', async (tx, t, m, c) => {
      if (!purchase())
        throw new HttpError(
          503,
          'DOMAIN_PURCHASE_UNAVAILABLE',
          'domain registration is not set up',
        );
      if (!(await tenantPlan(tx, t.id)).features.customDomain)
        throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include a domain", {
          feature: 'customDomain',
        });
      const body = await bodyJson(c);
      const host = typeof body.host === 'string' ? body.host.trim().toLowerCase() : '';
      if (!comBrLabel(host))
        throw new HttpError(422, 'INVALID_DOMAIN', 'pick a name like minhaloja.com.br', {
          field: 'host',
        });
      if (body.authorize !== true)
        throw new HttpError(422, 'AUTHORIZATION_REQUIRED', 'the holder must authorize it', {
          field: 'authorize',
        });
      const h = (body.holder ?? {}) as Record<string, unknown>;
      const document = validDocument(h.document, 'holder.document');
      const holder = {
        kind: document.length === 11 ? 'cpf' : 'cnpj',
        document,
        name: text(h.name, 'holder.name', 200, 2),
        email: validEmail(h.email, 'holder.email'),
        phone: holderPhone(h.phone),
        address: holderAddress(h.address),
      };
      await lockBilling(tx, t.id);
      const cur = await current(tx, t.id);
      const open = (
        await tx`
          select 1 from domain_orders where tenant_id = ${t.id} and kind = 'register'
            and status in ('awaiting_payment', 'queued', 'pending', 'conflict')
        `
      ).length;
      if (
        open ||
        (cur && ((cur.status !== 'pending_dns' && cur.status !== 'failed') || cur.zone_id))
      )
        throw new HttpError(409, 'DOMAIN_EXISTS', 'the store already has its own domain');
      if (
        (await hostTaken(d.sql, host, t.id, { registering: true })) ||
        (await hostTaken(d.sql, `www.${host}`, t.id, { registering: true }))
      )
        throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
          field: 'host',
        });
      // a connected domain still waiting for its DNS gives way to the one Venduá registers
      if (cur) await tx`delete from custom_domains where id = ${cur.id}`;
      let domainId: string;
      try {
        domainId = (
          await tx<{ id: string }[]>`
            insert into custom_domains (tenant_id, host, verify_token, status, source, method, alias_host)
            values (${t.id}, ${host}, ${newVerifyToken()}, 'ordering', 'included', 'ns', ${`www.${host}`})
            returning id
          `
        )[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
            field: 'host',
          });
        throw err;
      }
      const paid = await planHas(tx, t.id, 'customDomain');
      const order = (
        await tx<{ id: string }[]>`
          insert into domain_orders (tenant_id, custom_domain_id, kind, host, status, holder_kind,
            holder_document, holder_name, holder_email, holder_phone, holder_address,
            confirmed_by, confirmed_at)
          values (${t.id}, ${domainId}, 'register', ${host}, ${paid ? 'queued' : 'awaiting_payment'},
            ${holder.kind}, ${holder.document}, ${holder.name}, ${holder.email}, ${holder.phone},
            ${tx.json(holder.address as never)}, ${m.userId}, now())
          returning id
        `
      )[0]!;
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.order',
        entity: 'domain_order',
        entityId: order.id,
        summary: `pediu o registro de ${host}`,
        after: { host, holderKind: holder.kind },
      });
      return { status: 201, body: await view(tx, t) };
    }),
  );

  const orderAction = (
    action: 'cancel' | 'retry',
    from: readonly string[],
    apply: (tx: Sql, o: { id: string; custom_domain_id: string | null }) => Promise<unknown>,
  ) =>
    write('owner', async (tx, t, m, c: Context) => {
      const id = uuidParam(c, 'id');
      const o = (
        await tx<
          {
            id: string;
            host: string;
            status: string;
            custom_domain_id: string | null;
            claimed_until: Date | null;
          }[]
        >`
          select id, host, status, custom_domain_id, claimed_until from domain_orders
          where tenant_id = ${t.id} and id = ${id} and kind = 'register' for update
        `
      )[0];
      if (!o) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      // an order a worker took is at the registrar's door: what it gets back must land
      const busy = o.claimed_until !== null && o.claimed_until > new Date();
      if (!from.includes(o.status) || busy)
        throw new HttpError(409, 'ORDER_BUSY', 'the order can’t change now', { status: o.status });
      await apply(tx, o);
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: `domain.order.${action}`,
        entity: 'domain_order',
        entityId: o.id,
        summary: `${action === 'cancel' ? 'cancelou' : 'tentou de novo'} o registro de ${o.host}`,
      });
      return { status: 200, body: await view(tx, t) };
    });

  admin.post(
    '/account/domains/order/:id/cancel',
    orderAction('cancel', ['awaiting_payment', 'queued', 'conflict', 'failed'], async (tx, o) => {
      await tx`
        update domain_orders set status = 'cancelled', done_at = now(), updated_at = now()
        where id = ${o.id}
      `;
      if (o.custom_domain_id)
        await tx`delete from custom_domains where id = ${o.custom_domain_id} and status = 'ordering'`;
    }),
  );

  admin.post(
    '/account/domains/order/:id/retry',
    orderAction('retry', ['conflict', 'failed'], async (tx, o) => {
      const held = o.custom_domain_id
        ? await tx`select 1 from custom_domains where id = ${o.custom_domain_id} and status = 'ordering'`
        : [];
      if (!held.length)
        throw new HttpError(409, 'ORDER_BUSY', 'pick the name again', { status: 'failed' });
      await tx`
        update domain_orders set status = 'queued', next_attempt_at = null, attempts = 0,
          last_error = null, done_at = null, updated_at = now()
        where id = ${o.id}
      `;
    }),
  );
}
