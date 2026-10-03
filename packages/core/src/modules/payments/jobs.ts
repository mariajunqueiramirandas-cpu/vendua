import type { MerchantNotify } from '../../admin/context.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { unseal } from '../../platform/secrets.ts';
import {
  setConnectionStatus,
  storeRefreshed,
  tokenFor,
  type ConnectionRow,
  type ConnectionStatus,
} from './connections.ts';
import {
  ProviderError,
  type OAuthTokens,
  type PaymentProvider,
  type ProviderPayment,
} from './provider.ts';
import { autoRefundIfClosed } from '../../admin/routes-orders.ts';
import {
  applyProviderPayment,
  attemptExpired,
  markReview,
  syncOrderPayment,
  type PaymentRow,
} from './store-payments.ts';

const jobLog = log.child({ mod: 'payment-jobs' });

const DAY = 86_400_000;
const REFRESH_EVERY_MS = 10 * 60_000;
const RECONCILE_EVERY_MS = 2 * 60_000;

export interface PaymentJobDeps {
  provider: PaymentProvider;
  sessionSecret: string;
  notify: MerchantNotify;
  adminOrigin: string | null;
  /** only these stores (tests share a database with other stores and secrets) */
  only?: string[];
}

/** payment_connections across stores: read under vendua.control, like the CRM does. */
async function connectedTenants(sql: Sql, where: 'refresh' | 'all', now: Date, only?: string[]) {
  const rows = await sql.begin(async (tx) => {
    await tx`select set_config('vendua.control', '1', true)`;
    return where === 'refresh'
      ? tx<{ tenant_id: string }[]>`
          select tenant_id from payment_connections
          where status <> 'disconnected' and expires_at < ${new Date(now.getTime() + 30 * DAY)}
        `
      : tx<{ tenant_id: string }[]>`select tenant_id from payment_connections`;
  });
  return only ? rows.filter((r) => only.includes(r.tenant_id)) : rows;
}

/**
 * Tokens expiring within 30 days are refreshed. MP is never called under a row lock: a short tx
 * takes a lease (refreshing_until) — another replica skips a leased row — the refresh runs
 * outside any tx, and a second tx stores the result only if the tokens are still the ones we
 * read. Failures walk the connection down: < 7 days left → expiring, expired/unauthorized →
 * disconnected, MP hold → restricted.
 */
export async function refreshConnections(sql: Sql, o: PaymentJobDeps, now = new Date()) {
  for (const { tenant_id: tenantId } of await connectedTenants(sql, 'refresh', now, o.only)) {
    try {
      const lease = new Date(Date.now() + 2 * 60_000);
      const got = await withTenant(sql, tenantId, async (tx) => {
        const conn = (
          await tx<ConnectionRow[]>`
            update payment_connections set refreshing_until = ${lease}
            where tenant_id = ${tenantId} and status <> 'disconnected' and provider = ${o.provider.name}
              and expires_at < ${new Date(now.getTime() + 30 * DAY)}
              and (refreshing_until is null or refreshing_until < now())
            returning *
          `
        )[0];
        if (!conn) return null;
        const refresh = conn.refresh_token ? unseal(conn.refresh_token, o.sessionSecret) : null;
        if (!refresh) {
          const [s, e] = fallback(
            conn,
            now,
            conn.refresh_token ? 'token_unreadable' : 'no_refresh_token',
          );
          await setConnectionStatus(tx, tenantId, s, e);
          await tx`update payment_connections set refreshing_until = null where tenant_id = ${tenantId}`;
          return null;
        }
        return { conn, refresh, since: new Date(conn.refreshed_at ?? conn.connected_at) };
      });
      if (!got) continue;
      let tokens: OAuthTokens | null = null;
      let code: string | null = null;
      try {
        tokens = await o.provider.refresh(got.refresh);
      } catch (err) {
        code = err instanceof ProviderError ? err.code : 'unavailable';
        jobLog.warn({ err, tenantId }, 'token refresh failed');
      }
      await withTenant(sql, tenantId, async (tx) => {
        // only onto the tokens we refreshed: a reconnect meanwhile wins
        const cur = (
          await tx<{ ok: boolean }[]>`
            select date_trunc('milliseconds', coalesce(refreshed_at, connected_at)) <= ${got.since} as ok
            from payment_connections where tenant_id = ${tenantId} for update
          `
        )[0];
        if (cur?.ok) {
          if (tokens)
            // a hold is lifted by reconnecting (or the next successful charge), not by a refresh
            await storeRefreshed(
              tx,
              tenantId,
              tokens,
              o.sessionSecret,
              got.conn.status === 'restricted',
            );
          else {
            const [s, e] =
              code === 'unauthorized'
                ? (['disconnected', code] as [ConnectionStatus, string])
                : code === 'restricted'
                  ? (['restricted', code] as [ConnectionStatus, string])
                  : fallback(got.conn, now, code ?? 'unavailable');
            await setConnectionStatus(tx, tenantId, s, e);
          }
        }
        await tx`update payment_connections set refreshing_until = null where tenant_id = ${tenantId} and refreshing_until = ${lease}`;
      });
    } catch (err) {
      jobLog.error({ err, tenantId }, 'token refresh pass failed');
    }
  }
}

function fallback(conn: ConnectionRow, now: Date, code: string): [ConnectionStatus, string] {
  const expiresAt = new Date(conn.expires_at).getTime();
  return expiresAt <= now.getTime()
    ? ['disconnected', code]
    : expiresAt < now.getTime() + 7 * DAY
      ? ['expiring', code]
      : [conn.status, code];
}

function message(status: ConnectionStatus, store: string, origin: string | null) {
  const where = origin ? `${origin}/admin/pagamentos` : 'no painel da Venduá, em Pagamentos';
  switch (status) {
    case 'expiring':
      return `Venduá: a conexão da ${store} com o Mercado Pago vence em breve. Reconecte em ${where} para continuar recebendo Pix e cartão online.`;
    case 'disconnected':
      return `Venduá: a ${store} foi desconectada do Mercado Pago. Os pedidos seguem com o Pix da sua chave e pagamento na entrega. Reconecte em ${where}.`;
    case 'restricted':
      return `Venduá: o Mercado Pago colocou uma restrição na conta da ${store} e os pagamentos online foram pausados. Veja o aviso no app do Mercado Pago e depois reconecte em ${where}.`;
    default:
      return null;
  }
}

/** Each status change reaches the owners once (notified_status); back to connected is silent. */
export async function notifyConnectionChanges(sql: Sql, o: PaymentJobDeps) {
  for (const { tenant_id: tenantId } of await connectedTenants(sql, 'all', new Date(), o.only)) {
    try {
      const job = await withTenant(sql, tenantId, async (tx) => {
        const claimed = await tx<
          { status: ConnectionStatus; prev: string | null; status_changed_at: Date }[]
        >`
          update payment_connections c set notified_status = c.status
          from (select notified_status as prev from payment_connections where tenant_id = ${tenantId}) p
          where c.tenant_id = ${tenantId} and c.notified_status is distinct from c.status
          returning c.status, p.prev, c.status_changed_at
        `;
        const row = claimed[0];
        if (!row || row.status === 'connected') return null;
        const store = (
          await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`
        )[0]?.name;
        // the store stopped taking online payments on its own (an un-claim re-runs: dedupe)
        if (row.status === 'disconnected' || row.status === 'restricted')
          await recordStaffEventTx(
            tx,
            'payments.connection',
            {
              storeName: store ?? 'loja',
              connected: false,
              detail:
                row.status === 'restricted'
                  ? 'restrição na conta do Mercado Pago'
                  : 'o acesso ao Mercado Pago expirou ou foi revogado',
            },
            {
              tenantId,
              dedupeKey: `mp:${tenantId}:${row.status}:${new Date(row.status_changed_at).getTime()}`,
            },
          );
        const owners = await tx<{ phone: string }[]>`
          select phone from merchant_users
          where tenant_id = ${tenantId} and role = 'owner' and status = 'active'
        `;
        return { ...row, store: store ?? 'sua loja', owners };
      });
      if (!job) continue;
      const text = message(job.status, job.store, o.adminOrigin);
      if (!text) continue;
      let reached = 0;
      for (const { phone } of job.owners)
        await o.notify
          .whatsapp(phone, text)
          .then(() => reached++)
          .catch((err) => jobLog.warn({ err, tenantId }, 'connection alert failed'));
      // nobody heard it: un-claim so the next pass tries again
      if (job.owners.length && !reached)
        await withTenant(
          sql,
          tenantId,
          (tx) =>
            tx`update payment_connections set notified_status = ${job.prev} where tenant_id = ${tenantId} and status = ${job.status}`,
        );
    } catch (err) {
      jobLog.error({ err, tenantId }, 'connection alert pass failed');
    }
  }
}

/**
 * Webhooks get lost: every open attempt younger than 48 h is re-read from the provider and
 * applied. What nobody can pay any more (Pix past expiry, a stale hosted checkout) expires,
 * and the order's payment says so.
 */
export async function reconcilePayments(sql: Sql, o: PaymentJobDeps, now = new Date()) {
  for (const { tenant_id: tenantId } of await connectedTenants(sql, 'all', now, o.only)) {
    try {
      const { tok, open } = await withTenant(sql, tenantId, async (tx) => ({
        tok: await tokenFor(tx, tenantId, o.sessionSecret, { read: true }),
        open: await tx<PaymentRow[]>`
          select p.* from payments p
          where p.tenant_id = ${tenantId} and p.review is distinct from 'amount_mismatch' and (
            -- open attempts: webhooks get lost
            (p.status in ('creating', 'pending') and p.created_at > ${new Date(now.getTime() - 2 * DAY)})
            -- a card we replaced here (a 3DS challenge, a hosted checkout) that MP could still settle
            or (p.status = 'cancelled' and p.kind = 'card' and p.provider_payment_id is not null
                and p.created_at > ${new Date(now.getTime() - 2 * DAY)})
            -- a Pix we closed here that MP could still take until its expiry
            or (p.status in ('cancelled', 'expired') and p.kind = 'pix' and p.provider_payment_id is not null
                and p.pix_expires_at > ${new Date(now.getTime() - 60 * 60_000)})
            -- a refund MP may have made that we never recorded (a crash between the two)
            or exists (select 1 from payment_refunds r where r.payment_id = p.id and r.status = 'pending'
                       and r.created_at > ${new Date(now.getTime() - 2 * DAY)})
          )
          order by p.created_at limit 100
        `,
      }));
      const pay = { sql, provider: o.provider, sessionSecret: o.sessionSecret };
      const usable = !!tok && tok.provider === o.provider.name;
      for (const row of open) {
        if (!usable || row.provider !== o.provider.name) {
          // no token to ask MP with: we can't tell paid from unpaid — a person looks at it
          if (row.status === 'creating' || row.status === 'pending')
            await withTenant(sql, tenantId, (tx) => markReview(tx, tenantId, row, 'unverified'));
          continue;
        }
        let fresh: ProviderPayment | null = null;
        try {
          fresh = row.provider_payment_id
            ? await o.provider.getPayment(tok!.token, row.provider_payment_id)
            : await o.provider.findPayment(tok!.token, row.order_id);
        } catch (err) {
          if (!(err instanceof ProviderError && err.code === 'not_found')) {
            jobLog.warn({ err, tenantId, paymentId: row.id }, 'reconcile fetch failed');
            continue;
          }
        }
        const applied = await withTenant(sql, tenantId, async (tx) => {
          // reservations nobody sent (older than a few minutes) are settled by MP's refunded total
          const r = fresh
            ? await applyProviderPayment(tx, tenantId, fresh, { release: { exceptKey: '' } })
            : null;
          const cur = (
            await tx<PaymentRow[]>`select * from payments where id = ${row.id} for update`
          )[0];
          if (cur && attemptExpired(cur, now)) {
            await tx`update payments set status = 'expired', updated_at = now() where id = ${cur.id}`;
            await syncOrderPayment(tx, tenantId, cur.order_id);
          }
          return r;
        });
        if (applied) await autoRefundIfClosed(pay, tenantId, applied);
      }
    } catch (err) {
      jobLog.error({ err, tenantId }, 'reconcile pass failed');
    }
  }
}

export function startPaymentJobs(sql: Sql, o: PaymentJobDeps): () => void {
  if (!o.provider.configured) return () => {};
  const running = { refresh: false, reconcile: false };
  const guard = (name: keyof typeof running, fn: () => Promise<void>) => () => {
    if (running[name]) return;
    running[name] = true;
    void fn()
      .catch((err) => jobLog.error({ err, job: name }, 'payment job failed'))
      .finally(() => (running[name] = false));
  };
  const refresh = guard('refresh', async () => {
    await refreshConnections(sql, o);
    await notifyConnectionChanges(sql, o);
  });
  const reconcile = guard('reconcile', () => reconcilePayments(sql, o));
  const timers = [
    setInterval(refresh, REFRESH_EVERY_MS),
    setInterval(reconcile, RECONCILE_EVERY_MS),
    setTimeout(refresh, 30_000),
    setTimeout(reconcile, 45_000),
  ];
  return () => {
    for (const t of timers) clearInterval(t as ReturnType<typeof setInterval>);
  };
}
