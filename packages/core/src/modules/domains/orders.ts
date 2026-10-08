import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { DAY_MS } from '../billing/invoices.ts';
import { controlTx } from '../control.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { maskDocument } from './hosts.ts';
import { domainLog, type DomainJobDeps } from './lifecycle.ts';
import { messageOwners, type OwnerMessage } from '../billing/notices.ts';
import { planHas } from '../billing/plans.ts';
import {
  RegistrarError,
  type HolderAddress,
  type HolderInput,
  type RegistrarDomain,
} from './providers.ts';

// The .com.br Venduá registers and renews for a store (ADR 0038). An order waits for the plan's
// first payment, is placed with the registrar (on the registrar's own DNS: the registry wants
// answering nameservers, and Cloudflare won't host a name that isn't registered yet), polled until
// the registry confirms, and then moved to its Cloudflare zone. Each external call runs with no
// transaction open, on an order claimed by pushing its next_attempt_at forward.

export type OrderStatus =
  | 'awaiting_payment'
  | 'queued'
  | 'pending'
  | 'registered'
  | 'renewed'
  | 'conflict'
  | 'failed'
  | 'cancelled';

export interface OrderRow {
  id: string;
  tenant_id: string;
  custom_domain_id: string | null;
  kind: 'register' | 'renew';
  host: string;
  status: OrderStatus;
  holder_kind: 'cnpj' | 'cpf' | null;
  holder_document: string | null;
  holder_name: string | null;
  holder_email: string | null;
  holder_phone: string | null;
  holder_address: HolderAddress | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  registrar_ref: string | null;
  holder_handle: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  claimed_until: Date | null;
  expires_before: Date | null;
  conflict_since: Date | null;
  last_error: string | null;
  cost_cents: number | null;
  cost_currency: string | null;
  placed_at: Date | null;
  done_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const BATCH = 20;
/** a CPF/CNPJ with another provider is retried daily for this long */
export const CONFLICT_DAYS = 7;
/** the registry's own worst case (OpenSRS documents 45 days) */
const PENDING_GIVE_UP_MS = 45 * DAY_MS;
const POLL_MS = 10 * 60_000;
const CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;
/** renew this long before the registry expiry */
export const RENEW_AHEAD_MS = 30 * DAY_MS;

export const ORDER_ERRORS = {
  taken: 'Esse nome foi registrado por outra pessoa antes de nós. Escolha outro nome.',
  invalid:
    'O Registro.br recusou os dados do dono. Confira o CPF/CNPJ, o nome e o endereço e tente de novo.',
  conflict: 'Esse CPF/CNPJ usa outro provedor no Registro.br.',
  other: 'O registro não deu certo. A equipe Venduá já foi avisada.',
  timeout: 'O Registro.br não confirmou o registro a tempo.',
} as const;

const OPEN = ['awaiting_payment', 'queued', 'pending', 'conflict'] as const;

/** What the admin shows of an order: the holder masked, never the address. */
export function orderView(o: OrderRow, providerName: string | null) {
  return {
    id: o.id,
    host: o.host,
    status: o.status,
    holder: {
      kind: o.holder_kind!,
      document: maskDocument(o.holder_document!),
      name: o.holder_name!,
    },
    createdAt: o.created_at,
    placedAt: o.placed_at,
    conflictSince: o.conflict_since,
    lastError: o.last_error,
    providerName,
  };
}

/** The store's register order worth showing: an open one, or one that ended in the last 30 days. */
export async function latestOrder(tx: Sql, tenantId: string, now: Date) {
  return (
    (
      await tx<OrderRow[]>`
        select * from domain_orders
        where tenant_id = ${tenantId} and kind = 'register'
          and (status in ${tx(OPEN)} or updated_at > ${new Date(now.getTime() - 30 * DAY_MS)})
        order by (status in ${tx(OPEN)}) desc, created_at desc limit 1
      `
    )[0] ?? null
  );
}

function holderOf(o: OrderRow): HolderInput {
  return {
    kind: o.holder_kind!,
    document: o.holder_document!,
    name: o.holder_name!,
    email: o.holder_email!,
    phone: o.holder_phone!,
    address: o.holder_address!,
  };
}

const storeName = async (tx: Sql, tenantId: string) =>
  (await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`)[0]?.name ??
  tenantId;

const hasDomain = (sql: Sql, tenantId: string) =>
  withTenant(sql, tenantId, (tx) => planHas(tx, tenantId, 'customDomain'));

function tell(d: DomainJobDeps, sql: Sql, tenantId: string, msg: OwnerMessage, key: string) {
  return messageOwners({ sql, notify: d.notify }, tenantId, msg, key).catch((err) =>
    domainLog.warn({ err, key }, 'owner message failed'),
  );
}

/** Takes an order for one attempt: its next_attempt_at moves forward, so no other worker does. */
async function claim(sql: Sql, o: OrderRow, now: Date): Promise<OrderRow | null> {
  return controlTx(
    sql,
    async (tx) =>
      (
        await tx<OrderRow[]>`
          update domain_orders set next_attempt_at = ${new Date(now.getTime() + CLAIM_MS)},
            claimed_until = ${new Date(now.getTime() + CLAIM_MS)},
            attempts = attempts + 1, updated_at = ${now}
          where id = ${o.id} and status = ${o.status}
            and (next_attempt_at is null or next_attempt_at <= ${now})
            and (claimed_until is null or claimed_until <= ${now})
          returning *
        `
      )[0] ?? null,
  );
}

const due = (tx: Sql, now: Date) => tx`(next_attempt_at is null or next_attempt_at <= ${now})`;

/** Still the attempt this worker claimed: nobody cancelled, retried or re-claimed it meanwhile. */
const mine = (tx: Sql, o: OrderRow) =>
  tx`id = ${o.id} and status = ${o.status} and attempts = ${o.attempts}`;

/** awaiting_payment → queued once the plan has the domain and is paid (or is the team's). */
export async function promoteAwaiting(sql: Sql, now: Date) {
  const rows = await controlTx(
    sql,
    (tx) => tx<OrderRow[]>`
      select * from domain_orders where status = 'awaiting_payment'
      order by updated_at limit ${BATCH}
    `,
  );
  for (const o of rows) {
    if (!(await hasDomain(sql, o.tenant_id))) {
      // to the back of the line: stores that never pay don't keep the others from being looked at
      await controlTx(
        sql,
        (tx) => tx`
          update domain_orders set updated_at = ${now}
          where id = ${o.id} and status = 'awaiting_payment'
        `,
      );
      continue;
    }
    await withTenant(sql, o.tenant_id, async (tx) => {
      const r = await tx`
        update domain_orders set status = 'queued', next_attempt_at = null, updated_at = ${now}
        where tenant_id = ${o.tenant_id} and id = ${o.id} and status = 'awaiting_payment'
        returning id
      `;
      if (r.length) await emitAdminTx(tx, o.tenant_id, 'billing');
    });
  }
}

async function failOrder(
  sql: Sql,
  d: DomainJobDeps,
  o: OrderRow,
  now: Date,
  error: string,
  reason: 'conflict' | 'error',
) {
  const done = await controlTx(sql, async (tx) => {
    const r = await tx`
      update domain_orders set status = 'failed', last_error = ${error}, next_attempt_at = null,
        claimed_until = null, done_at = ${now}, updated_at = ${now}
      where ${mine(tx, o)}
      returning id
    `;
    if (!r.length) return false;
    await recordStaffEventTx(
      tx,
      o.kind === 'renew' ? 'domain.renewal_failed' : 'domain.order_failed',
      o.kind === 'renew'
        ? { storeName: await storeName(tx, o.tenant_id), host: o.host }
        : { storeName: await storeName(tx, o.tenant_id), host: o.host, reason },
      { tenantId: o.tenant_id, dedupeKey: `domain.order_failed:${o.id}:failed` },
    );
    await emitAdminTx(tx, o.tenant_id, 'billing');
    return true;
  });
  if (done && o.kind === 'register')
    await tell(
      d,
      sql,
      o.tenant_id,
      {
        subject: `Não conseguimos registrar ${o.host}`,
        text: `Não conseguimos registrar ${o.host}. ${error} Veja em Conta → Domínio próprio.`,
      },
      `domain-order-failed:${o.id}`,
    );
}

async function retryLater(sql: Sql, o: OrderRow, now: Date, error: string | null) {
  const wait = Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** Math.max(0, o.attempts - 1));
  await controlTx(
    sql,
    (tx) => tx`
      update domain_orders set next_attempt_at = ${new Date(now.getTime() + wait)},
        claimed_until = null, last_error = ${error}, updated_at = ${now}
      where ${mine(tx, o)}
    `,
  );
}

async function conflictOrder(sql: Sql, d: DomainJobDeps, o: OrderRow, now: Date) {
  const since = o.conflict_since ?? now;
  if (now.getTime() - since.getTime() > CONFLICT_DAYS * DAY_MS)
    return failOrder(sql, d, o, now, ORDER_ERRORS.conflict, 'conflict');
  const first = await controlTx(sql, async (tx) => {
    const r = await tx`
      update domain_orders set status = 'conflict', conflict_since = ${since},
        last_error = ${ORDER_ERRORS.conflict}, claimed_until = null,
        next_attempt_at = ${new Date(now.getTime() + DAY_MS)}, updated_at = ${now}
      where ${mine(tx, o)}
      returning id
    `;
    if (!r.length || o.conflict_since) return false;
    await recordStaffEventTx(
      tx,
      'domain.order_failed',
      { storeName: await storeName(tx, o.tenant_id), host: o.host, reason: 'conflict' },
      { tenantId: o.tenant_id, dedupeKey: `domain.order_failed:${o.id}:conflict` },
    );
    await emitAdminTx(tx, o.tenant_id, 'billing');
    return true;
  });
  if (first)
    await tell(
      d,
      sql,
      o.tenant_id,
      {
        subject: `Falta um passo para registrar ${o.host}`,
        text: `Para registrar ${o.host}, o ${o.holder_kind === 'cpf' ? 'CPF' : 'CNPJ'} ${maskDocument(o.holder_document!)} precisa usar o provedor da Venduá no Registro.br. O passo a passo está em Conta → Domínio próprio.`,
      },
      `domain-conflict:${o.id}`,
    );
}

/** Registers queued orders (and retries a provider conflict once a day). */
export async function placeRegistrations(sql: Sql, d: DomainJobDeps, now: Date) {
  const { registrar, dnsHost, edge } = d.providers;
  if (!registrar || !dnsHost || !edge) return;
  const rows = await controlTx(
    sql,
    (tx) => tx<OrderRow[]>`
      select * from domain_orders
      where kind = 'register' and status in ('queued', 'conflict') and ${due(tx, now)}
      order by created_at limit ${BATCH}
    `,
  );
  for (const row of rows) {
    if (!(await hasDomain(sql, row.tenant_id))) {
      // the plan lost the domain before it was bought: it waits for the plan again
      await withTenant(
        sql,
        row.tenant_id,
        (tx) => tx`
          update domain_orders set status = 'awaiting_payment', updated_at = ${now}
          where tenant_id = ${row.tenant_id} and id = ${row.id} and status = ${row.status}
        `,
      );
      continue;
    }
    const o = await claim(sql, row, now);
    if (!o) continue;
    try {
      let dom: RegistrarDomain | null = await registrar.find(o.host);
      let price: { cents: number; currency: string } | undefined;
      if (!dom) {
        const av = (await registrar.check([o.host])).get(o.host);
        if (av?.available === false) throw new RegistrarError('not available', 'taken');
        price = av?.price;
        await registrar.parkZone(o.host, edge.ipv4, edge.ipv6);
        let handle = o.holder_handle;
        if (!handle) {
          handle = await registrar.createHolder(holderOf(o));
          await controlTx(
            sql,
            (tx) => tx`update domain_orders set holder_handle = ${handle} where id = ${o.id}`,
          );
        }
        dom = await registrar.register({ host: o.host, holderHandle: handle });
      }
      const placed = dom;
      await controlTx(sql, async (tx) => {
        const r = await tx`
          update domain_orders set status = 'pending', registrar_ref = ${placed.ref},
            placed_at = coalesce(placed_at, ${now}), next_attempt_at = ${now},
            claimed_until = null, conflict_since = null, last_error = null, updated_at = ${now},
            cost_cents = coalesce(cost_cents, ${price?.cents ?? null}),
            cost_currency = coalesce(cost_currency, ${price?.currency ?? null})
          where ${mine(tx, o)}
          returning id
        `;
        if (!r.length) {
          // can't happen while cancel and retry respect the claim; if it does, the domain is
          // Venduá's at the registrar and nothing here points at it
          domainLog.error(
            { order: o.id, ref: placed.ref },
            'domain registered for a changed order',
          );
          return;
        }
        await tx`
          update custom_domains set registrar_ref = ${placed.ref},
            expires_at = coalesce(${placed.expiresAt}, expires_at)
          where id = ${o.custom_domain_id}
        `;
        await recordStaffEventTx(
          tx,
          'domain.ordered',
          { storeName: await storeName(tx, o.tenant_id), host: o.host },
          { tenantId: o.tenant_id, dedupeKey: `domain.ordered:${o.id}` },
        );
        await emitAdminTx(tx, o.tenant_id, 'billing');
      });
    } catch (err) {
      const kind = err instanceof RegistrarError ? err.kind : 'other';
      // the registrar's message may echo the holder's data: log only what kind of failure it was
      domainLog.warn(
        { order: o.id, kind, error: err instanceof RegistrarError ? undefined : String(err) },
        'domain registration failed',
      );
      if (kind === 'conflict') await conflictOrder(sql, d, o, now);
      else if (kind === 'taken') await failOrder(sql, d, o, now, ORDER_ERRORS.taken, 'error');
      else if (kind === 'invalid') await failOrder(sql, d, o, now, ORDER_ERRORS.invalid, 'error');
      else if (o.attempts >= MAX_ATTEMPTS)
        await failOrder(sql, d, o, now, ORDER_ERRORS.other, 'error');
      else await retryLater(sql, o, now, null);
    }
  }
}

/** Pending registrations: once the registry confirms, the domain moves to its Cloudflare zone. */
export async function pollRegistrations(sql: Sql, d: DomainJobDeps, now: Date) {
  const { registrar, dnsHost, edge } = d.providers;
  if (!registrar || !dnsHost || !edge) return;
  const rows = await controlTx(
    sql,
    (tx) => tx<OrderRow[]>`
      select * from domain_orders
      where kind = 'register' and status = 'pending' and ${due(tx, now)}
      order by placed_at limit ${BATCH}
    `,
  );
  for (const row of rows) {
    const o = await claim(sql, row, now);
    if (!o?.registrar_ref) continue;
    try {
      const dom = await registrar.get(o.registrar_ref);
      if (dom.status === 'failed') {
        await failOrder(sql, d, o, now, ORDER_ERRORS.other, 'error');
        continue;
      }
      if (dom.status === 'pending') {
        if (o.placed_at && now.getTime() - o.placed_at.getTime() > PENDING_GIVE_UP_MS)
          await failOrder(sql, d, o, now, ORDER_ERRORS.timeout, 'error');
        else
          await controlTx(
            sql,
            (tx) => tx`
              update domain_orders set next_attempt_at = ${new Date(now.getTime() + POLL_MS)},
                claimed_until = null
              where ${mine(tx, o)}
            `,
          );
        continue;
      }
      // registered: Cloudflare takes it now, then the registrar points it there. The store now
      // holds the name at the registry, so an unverified claim another store made on its zone
      // gives way (it could never have proved the domain).
      await controlTx(
        sql,
        (tx) => tx`
          update custom_domains set status = 'failed', zone_id = null, name_servers = '{}',
            last_error = 'Outra loja comprovou que é dona deste domínio.'
          where host = ${o.host} and id <> ${o.custom_domain_id} and zone_id is not null
            and status in ('pending_dns', 'failed')
        `,
      );
      const zone = await dnsHost.ensureZone(o.host);
      await dnsHost.syncRecords(zone.id, o.host, edge, []);
      await registrar.setNameservers(o.registrar_ref, o.host, zone.nameServers);
      const done = await controlTx(sql, async (tx) => {
        const r = await tx`
          update domain_orders set status = 'registered', done_at = ${now}, next_attempt_at = null,
            claimed_until = null, last_error = null, updated_at = ${now}
          where ${mine(tx, o)}
          returning id
        `;
        if (!r.length) return false;
        await tx`
          update custom_domains set status = 'pending_dns', zone_id = ${zone.id},
            name_servers = ${zone.nameServers}, registrar_ref = ${o.registrar_ref},
            expires_at = coalesce(${dom.expiresAt}, expires_at),
            records_confirmed_at = ${now}, records_updated_at = ${now}, records_synced_at = ${now},
            created_at = ${now}, last_checked_at = null, last_error = null
          where id = ${o.custom_domain_id} and status = 'ordering'
        `;
        await recordStaffEventTx(
          tx,
          'domain.registered',
          { storeName: await storeName(tx, o.tenant_id), host: o.host },
          { tenantId: o.tenant_id, dedupeKey: `domain.registered:${o.id}` },
        );
        await emitAdminTx(tx, o.tenant_id, 'billing');
        return true;
      });
      if (done)
        await tell(
          d,
          sql,
          o.tenant_id,
          {
            subject: `${o.host} foi registrado`,
            text: `${o.host} foi registrado no nome de ${o.holder_name}. Em alguns minutos ele começa a abrir a sua loja.`,
          },
          `domain-registered:${o.id}`,
        );
    } catch (err) {
      // the registry, Cloudflare or the registrar answered badly: poll again in a while
      domainLog.warn(
        { order: o.id, kind: err instanceof RegistrarError ? err.kind : 'other' },
        'domain registration poll failed',
      );
      await retryLater(sql, o, now, null);
    }
  }
}

/** Included domains a paying store keeps get a renewal order 30 days before they expire. */
export async function scheduleRenewals(sql: Sql, now: Date) {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string; host: string }[]>`
      select d.id, d.tenant_id, d.host from custom_domains d
      where d.source = 'included' and d.registrar_ref is not null
        and d.status in ('pending_dns', 'dns_ok', 'active', 'repairing')
        and d.expires_at < ${new Date(now.getTime() + RENEW_AHEAD_MS)}
        and not exists (
          select 1 from domain_orders o where o.custom_domain_id = d.id and o.kind = 'renew'
            and (o.status in ('queued', 'pending')
              or (o.status = 'renewed' and o.done_at > ${new Date(now.getTime() - RENEW_AHEAD_MS)})
              -- a renewal that gave up is tried again the next day, not after the expiry
              or (o.status = 'failed' and o.done_at > ${new Date(now.getTime() - DAY_MS)}))
        )
      limit ${BATCH}
    `,
  );
  for (const r of rows) {
    if (!(await hasDomain(sql, r.tenant_id))) continue;
    await withTenant(sql, r.tenant_id, async (tx) => {
      await tx`
        insert into domain_orders (tenant_id, custom_domain_id, kind, host, status)
        values (${r.tenant_id}, ${r.id}, 'renew', ${r.host}, 'queued')
        on conflict do nothing
      `;
    });
  }
}

export async function runRenewals(sql: Sql, d: DomainJobDeps, now: Date) {
  const { registrar } = d.providers;
  if (!registrar) return;
  const rows = await controlTx(
    sql,
    (tx) => tx<OrderRow[]>`
      select * from domain_orders
      where kind = 'renew' and status = 'queued' and ${due(tx, now)}
      order by created_at limit ${BATCH}
    `,
  );
  for (const row of rows) {
    if (!(await hasDomain(sql, row.tenant_id))) {
      await withTenant(
        sql,
        row.tenant_id,
        (tx) => tx`
          update domain_orders set status = 'cancelled', done_at = ${now}, updated_at = ${now}
          where tenant_id = ${row.tenant_id} and id = ${row.id} and status = 'queued'
        `,
      );
      continue;
    }
    const o = await claim(sql, row, now);
    if (!o) continue;
    const ref = (
      await controlTx(
        sql,
        (tx) => tx<{ registrar_ref: string | null }[]>`
          select registrar_ref from custom_domains where id = ${o.custom_domain_id}
        `,
      )
    )[0]?.registrar_ref;
    if (!ref) {
      await failOrder(sql, d, o, now, ORDER_ERRORS.other, 'error');
      continue;
    }
    try {
      // a renewal is paid each time it's asked: note the expiry first, and on a retry ask the
      // registrar whether the last attempt went through before renewing again
      const seen = await registrar.get(ref);
      // without the expiry before asking, a lost answer couldn't be told from a refusal
      if (!seen.expiresAt) throw new RegistrarError('expiry unknown', 'unavailable');
      let dom: RegistrarDomain;
      if (!o.expires_before) {
        await controlTx(
          sql,
          (tx) => tx`
            update domain_orders set expires_before = ${seen.expiresAt} where ${mine(tx, o)}
          `,
        );
        dom = await registrar.renew(ref, o.host);
      } else if (seen.expiresAt && seen.expiresAt > o.expires_before) dom = seen;
      else dom = await registrar.renew(ref, o.host);
      await controlTx(sql, async (tx) => {
        const r = await tx`
          update domain_orders set status = 'renewed', done_at = ${now}, next_attempt_at = null,
            claimed_until = null, registrar_ref = ${ref}, updated_at = ${now}
          where ${mine(tx, o)}
          returning id
        `;
        if (!r.length) return;
        await tx`
          update custom_domains set expires_at = coalesce(${dom.expiresAt}, expires_at)
          where id = ${o.custom_domain_id}
        `;
        await recordStaffEventTx(
          tx,
          'domain.renewed',
          {
            storeName: await storeName(tx, o.tenant_id),
            host: o.host,
            until: dom.expiresAt ? dom.expiresAt.toISOString() : null,
          },
          { tenantId: o.tenant_id, dedupeKey: `domain.renewed:${o.id}` },
        );
        await emitAdminTx(tx, o.tenant_id, 'billing');
      });
    } catch (err) {
      domainLog.warn(
        { order: o.id, kind: err instanceof RegistrarError ? err.kind : 'other' },
        'domain renewal failed',
      );
      if (o.attempts >= 5) await failOrder(sql, d, o, now, ORDER_ERRORS.other, 'error');
      else await retryLater(sql, o, now, null);
    }
  }
}
