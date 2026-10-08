import type { MerchantNotify } from '../../admin/context.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { log } from '../../platform/log.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { platformHost } from '../../platform/store-origin.ts';
import {
  certBlocker,
  cnameTarget,
  delegated,
  delegatedAlready,
  delegatedSure,
  DNS_RECHECK_MS,
  pointsAt,
  type CustomDomainRow,
} from '../billing/domains.ts';
import { DAY_MS } from '../billing/invoices.ts';
import { messageOwners, type OwnerMessage } from '../billing/notices.ts';
import { planHas } from '../billing/plans.ts';
import { controlTx } from '../control.ts';
import { recordStaffEvent, recordStaffEventTx } from '../staff-events.ts';
import type { DnsRecord, DomainProviders } from './providers.ts';

// What happens to a custom domain after its DNS is verified (ADR 0038): the certificate is
// issued (the sidecar routes dns_ok hosts) and a probe switches the host on; a live domain is
// re-checked and goes under repair when it stops pointing at us; a store that loses the feature
// lapses it to a redirect, and gets it back when the plan returns; lapsed and removed domains
// are cleaned up with their zone. Every step picks rows across stores, then changes each one
// under a status guard, so two Core instances ticking together do each thing once.

export const domainLog = log.child({ mod: 'domains' });

export interface DomainJobDeps {
  providers: DomainProviders;
  notify: MerchantNotify;
  storeDomain: string;
}

const BATCH = 100;
/** a dns_ok host whose certificate isn't there after this tells the team */
export const TLS_STUCK_MS = 60 * 60_000;
/** consecutive failed re-checks (15 min apart) before a live domain goes under repair */
export const REPAIR_AFTER = 3;
/** consecutive daily misses before a lapsed domain counts as moved away (zone and row go) */
export const LAPSED_GONE_AFTER = 3;
/** a 'pending' zone claim older than this belongs to a job that died before writing the zone */
export const ZONE_CLAIM_STALE_MS = 10 * 60_000;

type Row = CustomDomainRow & { slug: string; tname: string };

const rowsWhere = (sql: Sql, where: (tx: Sql) => ReturnType<Sql>) =>
  controlTx(
    sql,
    (tx) => tx<Row[]>`
      select d.*, t.slug, t.name as tname from custom_domains d join tenants t on t.id = d.tenant_id
      where ${where(tx)} order by d.last_checked_at nulls first limit ${BATCH}
    `,
  );

async function each<T>(rows: T[], step: string, fn: (row: T) => Promise<void>) {
  for (const row of rows) {
    try {
      await fn(row);
    } catch (err) {
      domainLog.warn({ err, step }, 'domain step failed');
    }
  }
}

const hasDomain = (sql: Sql, tenantId: string) =>
  withTenant(sql, tenantId, (tx) => planHas(tx, tenantId, 'customDomain'));

function tell(d: DomainJobDeps, sql: Sql, tenantId: string, msg: OwnerMessage, key: string) {
  return messageOwners({ sql, notify: d.notify }, tenantId, msg, key).catch((err) =>
    domainLog.warn({ err, key }, 'owner message failed'),
  );
}

const date = (d: Date) =>
  d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });

const RENEW_STEPS =
  'entre no Registro.br, em Provedor de serviços escolha Nenhum (0) e renove por lá';

/** zone_id while the row has claimed its name but Cloudflare hasn't answered yet */
export const ZONE_CLAIMED = 'pending';
export const realZone = (id: string | null) => (id && id !== ZONE_CLAIMED ? id : null);

export const DELEGATED_ELSEWHERE =
  'Este domínio já aponta para os servidores DNS da Venduá. Para provar que ele é seu, troque os servidores DNS no Registro.br pelos do seu provedor e adicione o domínio de novo.';

/**
 * Hosted zones: create one for a delegated domain once its owner confirmed the records, and push
 * record edits to it. The row claims the name first (one zone per name, unique in the table), so
 * a zone Cloudflare already has is only ever adopted by the row that claimed it — never one
 * another store's row owns.
 */
export async function syncZones(sql: Sql, d: DomainJobDeps, now: Date) {
  const { dnsHost, edge } = d.providers;
  if (!dnsHost || !edge) return;
  const rows = await rowsWhere(
    sql,
    (tx) => tx`
      d.method = 'ns' and d.status not in ('removing', 'ordering', 'failed') and (
        ((d.zone_id is null or d.zone_id = ${ZONE_CLAIMED})
          and d.source = 'connected' and d.records_confirmed_at is not null)
        or (d.zone_id is not null and d.zone_id <> ${ZONE_CLAIMED}
          and coalesce(d.records_updated_at, d.created_at) > coalesce(d.records_synced_at, 'epoch'))
      )
    `,
  );
  await each(rows, 'zones', async (r) => {
    let zoneId = realZone(r.zone_id);
    let nameServers = r.name_servers;
    if (!zoneId) {
      if (!r.zone_id) {
        let claimed = false;
        try {
          claimed =
            (
              await controlTx(
                sql,
                (tx) => tx`
                  update custom_domains set zone_id = ${ZONE_CLAIMED}, zone_claimed_at = ${now}
                  where id = ${r.id} and zone_id is null and status = ${r.status}
                  returning id
                `,
              )
            ).length > 0;
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') throw err;
          await withTenant(sql, r.tenant_id, async (tx) => {
            await tx`
              update custom_domains set last_checked_at = ${now},
                last_error = 'Outra loja já está configurando este domínio.'
              where tenant_id = ${r.tenant_id} and id = ${r.id}
            `;
            await emitAdminTx(tx, r.tenant_id, 'billing');
          });
          return;
        }
        if (!claimed) return;
      }
      const zone = await dnsHost.ensureZone(r.host);
      if (await delegatedAlready(r.host, zone.nameServers, d.providers.rdap)) {
        // none of this row's records are in the zone yet, and only its claim holds the name
        await dnsHost.deleteZone(zone.id);
        await withTenant(sql, r.tenant_id, async (tx) => {
          const u = await tx`
            update custom_domains set zone_id = null, zone_claimed_at = null, name_servers = '{}',
              status = case when status = 'removing' then status else 'failed' end,
              last_error = ${DELEGATED_ELSEWHERE}, last_checked_at = ${now}
            where tenant_id = ${r.tenant_id} and id = ${r.id} and zone_id = ${ZONE_CLAIMED}
            returning id
          `;
          if (u.length) await emitAdminTx(tx, r.tenant_id, 'billing');
        });
        return;
      }
      zoneId = zone.id;
      nameServers = zone.nameServers;
    }
    await dnsHost.syncRecords(zoneId, r.host, edge, (r.records ?? []) as DnsRecord[]);
    // a row removed meanwhile still gets the zone id, so finishRemovals deletes the zone
    const kept = await withTenant(sql, r.tenant_id, async (tx) => {
      const u = await tx`
        update custom_domains set zone_id = ${zoneId}, name_servers = ${nameServers},
          records_synced_at = ${now}
        where tenant_id = ${r.tenant_id} and id = ${r.id}
          and (zone_id = ${ZONE_CLAIMED} or zone_id = ${zoneId})
        returning id
      `;
      if (u.length) await emitAdminTx(tx, r.tenant_id, 'billing');
      return u.length > 0;
    });
    if (kept || realZone(r.zone_id)) return;
    // the row is gone, or a registration took the name: unless another row or that order now
    // holds the name's zone, nobody tracks the one just created
    const held = await controlTx(
      sql,
      (tx) => tx`
        select 1 from custom_domains where host = ${r.host} and zone_id is not null
        union all
        select 1 from domain_orders where host = ${r.host} and status in ('queued', 'pending')
      `,
    );
    if (!held.length) await dnsHost.deleteZone(zoneId);
  });
}

/** dns_ok: the sidecar has routed the host; once https answers with a valid certificate, it
 *  goes live (activate_custom_domain). */
export async function activateVerified(sql: Sql, d: DomainJobDeps, now: Date) {
  const rows = await rowsWhere(sql, (tx) => tx`d.status = 'dns_ok'`);
  await each(rows, 'activate', async (r) => {
    if (!(await hasDomain(sql, r.tenant_id))) return;
    if (!(await d.providers.probeTls(r.host).catch(() => false))) {
      await controlTx(
        sql,
        (tx) => tx`update custom_domains set last_checked_at = ${now} where id = ${r.id}`,
      );
      if (r.dns_ok_at && now.getTime() - r.dns_ok_at.getTime() > TLS_STUCK_MS)
        await recordStaffEvent(
          sql,
          'domain.tls_stuck',
          { storeName: r.tname, host: r.host },
          { tenantId: r.tenant_id, dedupeKey: `domain.tls_stuck:${r.id}:${r.dns_ok_at.getTime()}` },
        );
      return;
    }
    const live = await controlTx(sql, async (tx) => {
      const cur = (
        await tx<{ status: string }[]>`
          select status from custom_domains where id = ${r.id} for update
        `
      )[0];
      if (cur?.status !== 'dns_ok') return false;
      const taken = await tx`
        select 1 from domains where host = ${r.host} and tenant_id <> ${r.tenant_id}
      `;
      if (taken.length) {
        await tx`
          update custom_domains set last_checked_at = ${now},
            last_error = 'Outra loja já usa este endereço.'
          where id = ${r.id}
        `;
        return false;
      }
      await tx`select activate_custom_domain(${r.tenant_id}, ${r.host})`;
      await tx`
        update custom_domains set tls_ok_at = ${now}, miss_count = 0, last_error = null,
          last_checked_at = ${now}
        where id = ${r.id}
      `;
      await recordStaffEventTx(
        tx,
        'domain.live',
        { storeName: r.tname, host: r.host },
        { tenantId: r.tenant_id, dedupeKey: `domain.live:${r.id}` },
      );
      await emitAdminTx(tx, r.tenant_id, 'billing');
      await emitAdminTx(tx, r.tenant_id, 'store');
      return true;
    });
    if (live)
      await tell(
        d,
        sql,
        r.tenant_id,
        {
          subject: `${r.host} está no ar`,
          text: `Pronto: ${r.host} já abre a sua loja na Venduá.`,
        },
        `domain-live:${r.id}`,
      );
  });
}

const edgeIps = (d: DomainJobDeps) => (d.providers.edge ? [d.providers.edge.ipv4] : []);

/** Still ours: delegated, or pointing at us with nothing that sends visitors (IPv6) or the
 *  certificate (CAA) elsewhere — the same bar as the first verification. */
async function stillPointing(r: Row, d: DomainJobDeps) {
  if (r.method === 'ns') return delegated(r.host, r.name_servers);
  const target = cnameTarget(r.slug, d.storeDomain);
  return (await pointsAt(r.host, target, edgeIps(d))) && !(await certBlocker(r.host, target));
}

/** Live domains, every 15 minutes: still pointing at us? Three misses → repairing (the store's
 *  links move to its platform host); pointing again → active. */
export async function recheckLive(sql: Sql, d: DomainJobDeps, now: Date) {
  const due = new Date(now.getTime() - DNS_RECHECK_MS + 60_000);
  const rows = await rowsWhere(
    sql,
    (tx) => tx`
      d.status in ('active', 'repairing')
      and (d.last_checked_at is null or d.last_checked_at <= ${due})
    `,
  );
  await each(rows, 'recheck', (r) => recheckRow(sql, d, r, now));
}

/** The owner's "verificar agora" on a domain under repair: the re-check, now. */
export async function recheckDomain(
  sql: Sql,
  d: DomainJobDeps,
  tenantId: string,
  id: string,
  now: Date,
) {
  const r = (
    await rowsWhere(
      sql,
      (tx) => tx`d.tenant_id = ${tenantId} and d.id = ${id} and d.status = 'repairing'`,
    )
  )[0];
  if (r) await recheckRow(sql, d, r, now);
}

async function recheckRow(sql: Sql, d: DomainJobDeps, r: Row, now: Date) {
  const ok = await stillPointing(r, d);
  const target = cnameTarget(r.slug, d.storeDomain);
  // a root's www may start (or stop) pointing at us after the domain went live
  const aliasOk =
    r.method === 'ns'
      ? !!r.alias_host
      : !!r.alias_host &&
        (await pointsAt(r.alias_host, target, edgeIps(d))) &&
        !(await certBlocker(r.alias_host, target));
  const misses = ok ? 0 : r.miss_count + 1;
  const next =
    r.status === 'active' && misses >= REPAIR_AFTER
      ? 'repairing'
      : r.status === 'repairing' && ok
        ? 'active'
        : r.status;
  const moved = await controlTx(sql, async (tx) => {
    const row = (
      await tx<CustomDomainRow[]>`
        update custom_domains set miss_count = ${misses}, last_checked_at = ${now},
          alias_ok = ${aliasOk}, status = ${next},
          last_error = ${ok ? null : 'O domínio parou de apontar para a Venduá.'}
        where id = ${r.id} and status = ${r.status}
        returning *
      `
    )[0];
    if (!row || next === r.status) return false;
    if (next === 'repairing') {
      await tx`select store_primary(${r.tenant_id}, ${platformHost(r.slug, d.storeDomain)})`;
      await recordStaffEventTx(
        tx,
        'domain.repairing',
        { storeName: r.tname, host: r.host },
        {
          tenantId: r.tenant_id,
          dedupeKey: `domain.repairing:${r.id}:${now.toISOString().slice(0, 10)}`,
        },
      );
    } else await tx`select store_primary(${r.tenant_id}, ${r.host})`;
    await emitAdminTx(tx, r.tenant_id, 'billing');
    await emitAdminTx(tx, r.tenant_id, 'store');
    return true;
  });
  if (moved && next === 'repairing')
    await tell(
      d,
      sql,
      r.tenant_id,
      {
        subject: `${r.host} parou de apontar para a Venduá`,
        text: `O domínio ${r.host} parou de apontar para a Venduá. Enquanto isso, a loja continua no endereço Venduá (${platformHost(r.slug, d.storeDomain)}). Confira os registros em Conta → Domínio próprio.`,
      },
      `domain-repairing:${r.id}:${now.toISOString().slice(0, 10)}`,
    );
}

/**
 * A store whose plan no longer has the domain (downgrade, unpaid, CRM toggle) lapses it: the host
 * leaves the resolver and redirects to the platform host. When the plan has it again, the domain
 * is checked from scratch (pending_dns) and goes live through the usual steps.
 */
export async function lapseAndRestore(sql: Sql, d: DomainJobDeps, now: Date) {
  const rows = await rowsWhere(
    sql,
    (tx) => tx`d.status in ('dns_ok', 'active', 'repairing', 'lapsed')`,
  );
  await each(rows, 'lapse', async (r) => {
    const has = await hasDomain(sql, r.tenant_id);
    if (has === (r.status !== 'lapsed')) return;
    if (has) {
      await withTenant(sql, r.tenant_id, async (tx) => {
        await tx`
          update custom_domains set status = 'pending_dns', lapsed_at = null, expiry_notice = null,
            created_at = ${now}, last_checked_at = null, miss_count = 0
          where tenant_id = ${r.tenant_id} and id = ${r.id} and status = 'lapsed'
        `;
        await emitAdminTx(tx, r.tenant_id, 'billing');
      });
      return;
    }
    const lapsed = await controlTx(sql, async (tx) => {
      const row = (
        await tx`
          update custom_domains set status = 'lapsed', lapsed_at = ${now}, miss_count = 0,
            last_checked_at = ${now}, last_error = null
          where id = ${r.id} and status = ${r.status}
          returning id
        `
      )[0];
      if (!row) return false;
      await tx`select unroute_custom_domain(${r.tenant_id}, ${r.host}, ${platformHost(r.slug, d.storeDomain)})`;
      await recordStaffEventTx(
        tx,
        'domain.lapsed',
        { storeName: r.tname, host: r.host },
        {
          tenantId: r.tenant_id,
          dedupeKey: `domain.lapsed:${r.id}:${now.toISOString().slice(0, 10)}`,
        },
      );
      await emitAdminTx(tx, r.tenant_id, 'billing');
      await emitAdminTx(tx, r.tenant_id, 'store');
      return true;
    });
    if (lapsed && r.status !== 'dns_ok')
      await tell(
        d,
        sql,
        r.tenant_id,
        {
          subject: 'Domínio próprio desligado',
          text:
            `Seu plano não inclui mais domínio próprio, então ${r.host} agora leva os clientes para o endereço Venduá.` +
            (r.source === 'included'
              ? ` O domínio continua seu: para não perder, ${RENEW_STEPS}${r.expires_at ? ` até ${date(r.expires_at)}` : ''}.`
              : ''),
        },
        `domain-lapsed:${r.id}:${now.toISOString().slice(0, 10)}`,
      );
  });
}

const NOTICE_DAYS = [30, 7, 1] as const;

/** Lapsed domains, daily: expiry notices for an included one, and cleanup (zone and row) once
 *  the domain is gone for good — its nameservers moved, it stopped pointing at us, or the
 *  registry freed it after the restore window. */
export async function settleLapsed(sql: Sql, d: DomainJobDeps, now: Date) {
  const due = new Date(now.getTime() - DAY_MS + 60_000);
  const rows = await rowsWhere(
    sql,
    (tx) => tx`d.status = 'lapsed' and (d.last_checked_at is null or d.last_checked_at <= ${due})`,
  );
  await each(rows, 'lapsed', async (r) => {
    // a failed lookup reads as "not pointing", so moving away takes LAPSED_GONE_AFTER daily
    // misses in a row; the registry freeing the name is definite
    const pointing = await stillPointing(r, d);
    const misses = pointing ? 0 : r.miss_count + 1;
    let gone = misses >= LAPSED_GONE_AFTER;
    if (!gone && r.source === 'included') {
      const info = await d.providers.rdap(r.host);
      gone = info !== null && !info.registered;
    }
    if (gone) {
      const zoneId = realZone(r.zone_id);
      if (zoneId && d.providers.dnsHost) await d.providers.dnsHost.deleteZone(zoneId);
      await withTenant(sql, r.tenant_id, async (tx) => {
        await tx`delete from custom_domains where tenant_id = ${r.tenant_id} and id = ${r.id} and status = 'lapsed'`;
        await emitAdminTx(tx, r.tenant_id, 'billing');
      });
      return;
    }
    await controlTx(
      sql,
      (tx) => tx`
        update custom_domains set last_checked_at = ${now}, miss_count = ${misses}
        where id = ${r.id} and status = 'lapsed'
      `,
    );
    if (r.source !== 'included' || !r.expires_at) return;
    const left = Math.ceil((r.expires_at.getTime() - now.getTime()) / DAY_MS);
    const notice = NOTICE_DAYS.filter((n) => left <= n && left > 0).at(-1);
    if (!notice || (r.expiry_notice !== null && r.expiry_notice <= notice)) return;
    const claimed = await controlTx(
      sql,
      (tx) => tx`
        update custom_domains set expiry_notice = ${notice}
        where id = ${r.id} and (expiry_notice is null or expiry_notice > ${notice})
        returning id
      `,
    );
    if (claimed.length)
      await tell(
        d,
        sql,
        r.tenant_id,
        {
          subject: `${r.host} vence em ${left} ${left === 1 ? 'dia' : 'dias'}`,
          text: `O domínio ${r.host} vence em ${date(r.expires_at)}. Ele é seu: para não perder, ${RENEW_STEPS}.`,
        },
        `domain-expiry:${r.id}:${notice}`,
      );
  });
}

/** Removed by the owner: the zone goes, then the row. A connected domain that failed (never
 *  delegated in time, or another store proved it) gives its zone back the same way and keeps the
 *  row, so an unproven claim doesn't hold the name. */
export async function finishRemovals(sql: Sql, d: DomainJobDeps, now: Date) {
  const rows = await rowsWhere(
    sql,
    (tx) => tx`
      d.status = 'removing'
      or (d.status = 'failed' and d.source = 'connected' and d.zone_id is not null)
    `,
  );
  await each(rows, 'remove', async (r) => {
    const removing = r.status === 'removing';
    // syncZones may still be creating this row's zone: it writes the id here when done
    const claimed = r.zone_id === ZONE_CLAIMED;
    if (
      claimed &&
      r.zone_claimed_at &&
      now.getTime() - r.zone_claimed_at.getTime() < ZONE_CLAIM_STALE_MS
    )
      return;
    // an owner who delegated to this row's zone after the week ran out keeps it: "verificar" (or
    // adding the domain again) then finds the delegation, which a new zone would refuse
    // (or when DNS didn't answer: a lost zone takes its records with it)
    if (!removing && !claimed && (await delegatedSure(r.host, r.name_servers)) !== false) return;
    if (removing)
      await controlTx(
        sql,
        (tx) =>
          tx`select unroute_custom_domain(${r.tenant_id}, ${r.host}, ${platformHost(r.slug, d.storeDomain)})`,
      );
    if (r.zone_id) {
      if (!d.providers.dnsHost) return;
      // a claim whose job died may have created the zone: it holds the name, so it's this row's
      const zoneId = claimed ? (await d.providers.dnsHost.findZone(r.host))?.id : r.zone_id;
      if (zoneId) await d.providers.dnsHost.deleteZone(zoneId);
    }
    if (!removing) {
      await withTenant(sql, r.tenant_id, async (tx) => {
        const u = await tx`
          update custom_domains set zone_id = null, zone_claimed_at = null, name_servers = '{}',
            records_synced_at = null
          where tenant_id = ${r.tenant_id} and id = ${r.id} and status = 'failed'
            and zone_id = ${r.zone_id}
          returning id
        `;
        if (u.length) await emitAdminTx(tx, r.tenant_id, 'billing');
      });
      return;
    }
    await withTenant(sql, r.tenant_id, async (tx) => {
      await tx`
        delete from custom_domains
        where tenant_id = ${r.tenant_id} and id = ${r.id} and status = 'removing'
      `;
      await emitAdminTx(tx, r.tenant_id, 'billing');
      await emitAdminTx(tx, r.tenant_id, 'store');
    });
  });
}

/** registro.br's record, daily: the registry expiry and whether DNSSEC is on. */
export async function refreshRdap(sql: Sql, d: DomainJobDeps, now: Date) {
  const due = new Date(now.getTime() - DAY_MS + 60_000);
  const rows = await rowsWhere(
    sql,
    (tx) => tx`
      d.host like '%.br' and d.status in ('pending_dns', 'dns_ok', 'active', 'repairing', 'lapsed')
      and (d.rdap_checked_at is null or d.rdap_checked_at <= ${due})
    `,
  );
  await each(rows, 'rdap', async (r) => {
    const info = await d.providers.rdap(r.host);
    await withTenant(sql, r.tenant_id, async (tx) => {
      await tx`
        update custom_domains set rdap_checked_at = ${now},
          expires_at = ${info?.expiresAt ?? r.expires_at},
          dnssec_signed = ${info ? info.signed : r.dnssec_signed}
        where tenant_id = ${r.tenant_id} and id = ${r.id}
      `;
    });
  });
}
