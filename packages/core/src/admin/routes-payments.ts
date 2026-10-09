import { createHmac, timingSafeEqual } from 'node:crypto';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, bodyJson, boundedText, parseJsonObject } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { normalizePixKey, pixPayload, type PixKeyType } from '../modules/pix.ts';
import {
  connectionView,
  OWNER_DISCONNECTED,
  disconnectConnection,
  isOnline,
  loadConnection,
  upsertConnection,
} from '../modules/payments/connections.ts';
import type { PaymentProvider } from '../modules/payments/provider.ts';
import { paymentReviews } from '../modules/payments/store-payments.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import {
  DEFAULT_PAYMENT_METHODS,
  MAX_FIXED_CENTS,
  MAX_PERCENT_BPS,
  PAYMENT_METHODS,
  isPaymentMethod,
  readPaymentAdjustments,
  type PaymentAdjustment,
  type PaymentAdjustments,
} from '../modules/payment-adjustments.ts';
import { audit } from './audit.ts';
import { isObj, need, oneOf, optText, text, type AdminCtx, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeTz } from './routes-orders.ts';
import { csvMoney, csvResponse } from './routes-reports.ts';
import { loadSettings } from './routes-store.ts';

// Pagamentos (A3): offline methods and the store's Pix key, plus the Mercado Pago connection
// (OAuth, 13-payments.md#merchant-connection), `card_online` and the fee statement.
//
// `mercadoPago.lastError` is a code, never copy — the admin maps it to pt-BR:
//   unauthorized       MP refused the token (revoked, or the refresh token was used up)
//   restricted         MP holds the account (KYC, policy): online charges are paused
//   unavailable        MP didn't answer (network, 5xx, timeout) — retried by the job
//   invalid            MP refused a request of ours (e.g. the refresh call)
//   not_found          MP doesn't know the resource
//   token_unreadable   the sealed token no longer opens (VENDUA_SECRETS_KEY changed): reconnect
//   no_refresh_token   the connection can't renew itself: reconnect before it expires
// (`disconnected_by_owner` is internal — that store reads `status: 'not_connected'`.)
const METHODS = PAYMENT_METHODS;
const STATE_TTL_MS = 10 * 60_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const payLog = log.child({ mod: 'admin-payments' });

/** the statement's words for a settled attempt, as Pagamentos shows them */
const STATUS_WORD: Record<string, string> = {
  approved: 'aprovado',
  partially_refunded: 'reembolso parcial',
  refunded: 'reembolsado',
  charged_back: 'contestado',
  in_mediation: 'em disputa',
};

// OAuth `state`: which store and person started the connect, signed, 10 minutes. The callback
// only accepts it back in that same person's session — a link from someone else connects nothing.
// `b: 'onboarding'` sends the owner back to the Bem-vindo wizard instead of Pagamentos: it rides
// signed, and only that literal picks the other page, so it is never an open redirect.
function signState(
  secret: string,
  tenantId: string,
  userId: string,
  back: 'onboarding' | null = null,
  now = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify({
      t: tenantId,
      u: userId,
      exp: now + STATE_TTL_MS,
      ...(back ? { b: back } : {}),
    }),
  ).toString('base64url');
  const mac = createHmac('sha256', `mp-oauth|${secret}`).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function readState(
  secret: string,
  state: string,
): { t: string; u: string; exp: number; b?: unknown } | null {
  if (state.length > 600) return null;
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(
    createHmac('sha256', `mp-oauth|${secret}`).update(body).digest('base64url'),
  );
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof v.t === 'string' && typeof v.u === 'string' && typeof v.exp === 'number'
      ? v
      : null;
  } catch {
    return null;
  }
}

// Money per settled attempt: gross = what the shopper paid; providerFee = what Mercado Pago kept;
// applicationFee = Venduá's cut (0 today); net = what reached the store's MP account for it,
// BEFORE refunds (MP's net_received_amount) — refunds are their own line, refundedCents.
const MONEY_COLS = (tx: Sql) => tx`
  coalesce(sum(amount_cents), 0)::int as "grossCents",
  coalesce(sum(provider_fee_cents), 0)::int as "providerFeeCents",
  coalesce(sum(application_fee_cents), 0)::int as "applicationFeeCents",
  coalesce(sum(coalesce(net_cents, amount_cents - coalesce(provider_fee_cents, 0) - application_fee_cents)), 0)::int as "netCents",
  coalesce(sum(refunded_cents), 0)::int as "refundedCents",
  count(*)::int as count
`;
const SETTLED_SQL = ['approved', 'partially_refunded', 'refunded', 'charged_back', 'in_mediation'];

/** Money that landed in a store-local month: settled attempts by approval date. */
async function monthTotals(tx: Sql, tenantId: string, month: string, tz: string) {
  return (
    await tx<
      {
        grossCents: number;
        providerFeeCents: number;
        applicationFeeCents: number;
        netCents: number;
        refundedCents: number;
        count: number;
      }[]
    >`
      select ${MONEY_COLS(tx)} from payments
      where tenant_id = ${tenantId} and status = any(${SETTLED_SQL})
        and to_char(approved_at at time zone ${tz}, 'YYYY-MM') = ${month}
    `
  )[0]!;
}

function currentMonth(tz: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);
}

/** `adjustments` replaces the whole map; a method mapped to null or {} has none. */
function parseAdjustments(raw: unknown): PaymentAdjustments {
  if (raw === null) return {};
  const bad = (message: string, field = 'adjustments') =>
    new HttpError(422, 'INVALID_ADJUSTMENT', message, { field });
  if (!isObj(raw)) throw bad('adjustments must be an object');
  const out: PaymentAdjustments = {};
  for (const [method, v] of Object.entries(raw)) {
    if (!isPaymentMethod(method)) throw bad(`unknown payment method ${method.slice(0, 40)}`);
    if (v === null) continue;
    if (!isObj(v)) throw bad('an adjustment must be an object', `adjustments.${method}`);
    const adj: PaymentAdjustment = {};
    for (const [k, n] of Object.entries(v)) {
      const field = `adjustments.${method}.${k.slice(0, 40)}`;
      const max = k === 'percentBps' ? MAX_PERCENT_BPS : k === 'fixedCents' ? MAX_FIXED_CENTS : 0;
      if (!max) throw bad('an adjustment takes percentBps and fixedCents only', field);
      if (n === null) continue;
      if (!Number.isSafeInteger(n) || Math.abs(n as number) > max)
        throw bad(`${k} must be an integer between -${max} and ${max}`, field);
      if (n !== 0) adj[k as keyof PaymentAdjustment] = n as number;
    }
    if (Object.keys(adj).length) out[method] = adj;
  }
  return out;
}

export async function paymentsView(tx: Sql, tenantId: string, provider: PaymentProvider) {
  const s = await loadSettings(tx, tenantId);
  const by = await tx<{ method: string; status: string; orders: number; cents: number }[]>`
    select payment ->> 'method' as method, payment ->> 'status' as status, count(*)::int as orders,
           coalesce(sum(total_cents), 0)::int as cents
    from orders where tenant_id = ${tenantId} and state not in ('cancelled', 'refunded')
      and placed_at > now() - interval '30 days'
    group by 1, 2
  `;
  // online Pix is confirmed by Mercado Pago — only offline Pix waits for "recebi"
  const awaiting = await tx<
    { id: string; number: number; name: string; totalCents: number; placedAt: string }[]
  >`
    select id, number, customer ->> 'name' as name, total_cents as "totalCents", placed_at as "placedAt"
    from orders where tenant_id = ${tenantId} and payment ->> 'method' = 'pix'
      and payment ->> 'status' = 'pending' and coalesce((payment ->> 'online')::boolean, false) = false
      and state not in ('cancelled', 'refunded')
    order by placed_at desc limit 20
  `;
  const pix =
    s.pix_key && s.pix_key_type
      ? {
          key: s.pix_key,
          keyType: s.pix_key_type,
          beneficiary: s.pix_beneficiary ?? '',
          city: s.pix_city ?? '',
          sample: pixPayload({
            key: s.pix_key,
            keyType: s.pix_key_type as PixKeyType,
            beneficiary: s.pix_beneficiary ?? '',
            city: s.pix_city ?? s.city ?? '',
          }),
        }
      : null;
  const byMethod = new Map<string, { method: string; cents: number; orders: number }>();
  for (const r of by) {
    const m = byMethod.get(r.method) ?? { method: r.method, cents: 0, orders: 0 };
    m.cents += r.cents;
    m.orders += r.orders;
    byMethod.set(r.method, m);
  }
  const tz = await storeTz(tx, tenantId);
  const month = currentMonth(tz);
  return {
    methods: s.payment_methods ?? [...DEFAULT_PAYMENT_METHODS],
    // { method: { percentBps?, fixedCents? } }, signed: negative = discount
    adjustments: readPaymentAdjustments(s.payment_adjustments),
    // what PATCH accepts, either sign
    adjustmentBounds: { maxPercentBps: MAX_PERCENT_BPS, maxFixedCents: MAX_FIXED_CENTS },
    pix,
    mercadoPago: connectionView(await loadConnection(tx, tenantId), provider),
    last30: by,
    last30TotalCents: by.reduce((a, r) => a + r.cents, 0),
    last30Orders: by.reduce((a, r) => a + r.orders, 0),
    last30ByMethod: [...byMethod.values()].sort(
      (a, b) => b.cents - a.cents || a.method.localeCompare(b.method),
    ),
    awaitingPix: awaiting,
    // money we couldn't verify or settle by ourselves (no token, wrong amount, refund refused)
    review: await paymentReviews(tx, tenantId),
    month: { month, ...(await monthTotals(tx, tenantId, month, tz)) },
  };
}

export function mountPayments(d: AdminDeps) {
  const { admin, provider } = d;
  const { read, write, named } = handlers(d);
  const redirectUri = (c: AdminCtx) =>
    `${d.publicOrigin(c)}/admin/v1/payments/mercadopago/callback`;

  admin.get(
    '/payments',
    named('payments').read('manager', async (tx, t) => paymentsView(tx, t.id, provider)),
  );

  admin.patch(
    '/payments',
    write('owner', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      await loadSettings(tx, t.id);
      const changed: string[] = [];
      if (body.methods !== undefined) {
        const pm = body.methods;
        if (
          !Array.isArray(pm) ||
          pm.length === 0 ||
          pm.length > METHODS.length ||
          !pm.every((x) => (METHODS as readonly unknown[]).includes(x))
        )
          throw new HttpError(422, 'BAD_REQUEST', 'keep at least one payment method', {
            field: 'methods',
          });
        if (pm.includes('card_online') && !isOnline(await loadConnection(tx, t.id), provider))
          throw new HttpError(
            422,
            'MP_NOT_CONNECTED',
            'connect Mercado Pago to take cards online',
            {
              field: 'methods',
            },
          );
        await tx`update store_settings set payment_methods = ${tx.json([...new Set(pm as string[])])} where tenant_id = ${t.id}`;
        changed.push('formas de pagamento');
      }
      if (body.adjustments !== undefined) {
        const adjustments = parseAdjustments(body.adjustments);
        await tx`update store_settings set payment_adjustments = ${tx.json(adjustments as never)} where tenant_id = ${t.id}`;
        changed.push('descontos e acréscimos por forma de pagamento');
      }
      if (body.pix !== undefined) {
        if (body.pix === null) {
          await tx`update store_settings set pix_key = null, pix_key_type = null, pix_beneficiary = null, pix_city = null where tenant_id = ${t.id}`;
        } else {
          const p = isObj(body.pix) ? body.pix : {};
          const type = oneOf(p.keyType, 'keyType', [
            'cpf',
            'cnpj',
            'email',
            'phone',
            'random',
          ] as const);
          const key = normalizePixKey(text(p.key, 'key', 100, 1), type);
          if (!key)
            throw new HttpError(422, 'INVALID_PIX', 'this Pix key does not look right', {
              field: 'key',
            });
          const beneficiary = text(p.beneficiary, 'beneficiary', 25, 2);
          const city = optText(p.city, 'city', 15) ?? null;
          await tx`
            update store_settings set pix_key = ${key}, pix_key_type = ${type}, pix_beneficiary = ${beneficiary}, pix_city = ${city}
            where tenant_id = ${t.id}
          `;
        }
        changed.push('Pix');
      }
      if (!changed.length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      await audit(tx, t.id, m, {
        action: 'payments.update',
        entity: 'payments',
        summary: `alterou ${changed.join(' e ')}`,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await paymentsView(tx, t.id, provider) };
    }),
  );

  admin.post(
    '/payments/mercadopago/connect',
    write('owner', async (_tx, t, m, c) => {
      if (!provider.configured)
        throw new HttpError(409, 'PAYMENTS_UNAVAILABLE', 'online payments are not set up here');
      // the admin's Pagamentos posts no body; the wizard posts { back: 'onboarding' }
      const raw = await boundedText(c, 1024);
      const body = raw.trim() ? parseJsonObject(raw) : {};
      const state = signState(
        d.sessionSecret,
        t.id,
        m.userId,
        body.back === 'onboarding' ? 'onboarding' : null,
      );
      return { status: 200, body: { url: provider.connectUrl(state, redirectUri(c as AdminCtx)) } };
    }),
  );

  // MP sends the owner back here with ?code&state (or ?error=access_denied). A GET behind the
  // session gate: the Lax cookie rides the top-level redirect. Idempotent by nature — a code is
  // exchanged once (MP refuses a second use) and the connection row is keyed by tenant.
  admin.get('/payments/mercadopago/callback', async (c) => {
    const st = readState(d.sessionSecret, c.req.query('state') ?? '');
    const page = st?.b === 'onboarding' ? '/admin/bem-vindo' : '/admin/pagamentos';
    const back = (q: string) => c.redirect(`${page}?${q}`, 302);
    const fail = (reason: string) => back(`mp=error&reason=${reason}`);
    const m = c.get('merchant');
    const t = c.get('tenant');
    if (m.role !== 'owner') return fail('invalid_state');
    if (c.req.query('error'))
      return fail(c.req.query('error') === 'access_denied' ? 'access_denied' : 'exchange_failed');
    if (!st || st.t !== t.id || st.u !== m.userId || st.exp < Date.now())
      return fail('invalid_state');
    const code = c.req.query('code') ?? '';
    if (!code || code.length > 300) return fail('exchange_failed');
    let tokens;
    try {
      tokens = await provider.exchangeCode(code, redirectUri(c));
    } catch (err) {
      payLog.warn({ err, tenantId: t.id }, 'mercado pago code exchange failed');
      return fail('exchange_failed');
    }
    await withTenant(d.sql, t.id, async (tx) => {
      const before = await loadConnection(tx, t.id);
      await upsertConnection(tx, t.id, provider.name, tokens, d.sessionSecret, m.userId);
      await audit(tx, t.id, m, {
        action: 'payments.mercadopago.connect',
        entity: 'payments',
        summary: `conectou o Mercado Pago (conta ${tokens.providerUserId})`,
        before: before ? { accountId: before.provider_user_id, status: before.status } : null,
        after: { accountId: tokens.providerUserId, liveMode: tokens.liveMode },
      });
      await emitAdminTx(tx, t.id, 'billing');
      await recordStaffEventTx(
        tx,
        'payments.connection',
        { storeName: t.name, connected: true, detail: tokens.liveMode ? null : 'modo de teste' },
        { tenantId: t.id },
      );
      await recordStaffEventTx(
        tx,
        'store.onboarding',
        { step: 'payments' },
        { tenantId: t.id, dedupeKey: `onboarding:${t.id}:payments` },
      );
    });
    return back('mp=connected');
  });

  admin.post(
    '/payments/mercadopago/disconnect',
    write('owner', async (tx, t, m) => {
      const before = await loadConnection(tx, t.id);
      if (before && before.last_error !== OWNER_DISCONNECTED) {
        await disconnectConnection(tx, t.id);
        await audit(tx, t.id, m, {
          action: 'payments.mercadopago.disconnect',
          entity: 'payments',
          summary: 'desconectou o Mercado Pago',
          before: { accountId: before.provider_user_id, status: before.status },
        });
        await emitAdminTx(tx, t.id, 'billing');
        await emitAdminTx(tx, t.id, 'store');
        await recordStaffEventTx(
          tx,
          'payments.connection',
          { storeName: t.name, connected: false, detail: 'pelo lojista' },
          { tenantId: t.id },
        );
      }
      return { status: 200, body: await paymentsView(tx, t.id, provider) };
    }),
  );

  admin.get(
    '/payments/statement',
    // per payment and in totals, netCents is before refunds (see MONEY_COLS)
    read('manager', async (tx, t, _m, c) => {
      const tz = await storeTz(tx, t.id);
      const month = c.req.query('month') ?? currentMonth(tz);
      if (!MONTH_RE.test(month)) throw new HttpError(400, 'BAD_REQUEST', 'month must be YYYY-MM');
      const payments = await tx`
        select p.id, p.order_id as "orderId", o.number as "orderNumber", p.kind, p.status,
               p.amount_cents as "amountCents", p.provider_fee_cents as "providerFeeCents",
               coalesce(p.net_cents, p.amount_cents - coalesce(p.provider_fee_cents, 0) - p.application_fee_cents)::int as "netCents",
               p.refunded_cents as "refundedCents",
               p.approved_at as "approvedAt", p.created_at as "createdAt"
        from payments p join orders o on o.id = p.order_id
        where p.tenant_id = ${t.id} and p.status = any(${SETTLED_SQL})
          and to_char(p.approved_at at time zone ${tz}, 'YYYY-MM') = ${month}
        order by p.approved_at desc
        limit 1000
      `;
      return {
        month,
        // netCents (totals and rows) is before refunds; refundedCents is its own line
        netBasis: 'before_refunds',
        totals: await monthTotals(tx, t.id, month, tz),
        payments,
      };
    }),
  );
  // the month's statement as a spreadsheet: one month (≤ 20000 rows), Core's money formatting
  admin.get('/payments/statement.csv', async (c) => {
    need(c, 'manager');
    const t = c.get('tenant');
    const { month, rows } = await withTenant(d.sql, t.id, async (tx) => {
      const tz = await storeTz(tx, t.id);
      const month = c.req.query('month') ?? currentMonth(tz);
      if (!MONTH_RE.test(month)) throw new HttpError(400, 'BAD_REQUEST', 'month must be YYYY-MM');
      const rows = await tx<
        {
          number: number;
          approved: string | null;
          kind: string;
          status: string;
          amount: number;
          fee: number | null;
          app: number;
          net: number;
          refunded: number;
        }[]
      >`
        select o.number, to_char(p.approved_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as approved,
               p.kind, p.status, p.amount_cents as amount, p.provider_fee_cents as fee,
               p.application_fee_cents as app,
               coalesce(p.net_cents, p.amount_cents - coalesce(p.provider_fee_cents, 0) - p.application_fee_cents)::int as net,
               p.refunded_cents as refunded
        from payments p join orders o on o.id = p.order_id
        where p.tenant_id = ${t.id} and p.status = any(${SETTLED_SQL})
          and to_char(p.approved_at at time zone ${tz}, 'YYYY-MM') = ${month}
        order by p.approved_at
        limit 20000
      `;
      return { month, rows };
    });
    const head = [
      'pedido',
      'aprovado em',
      'forma',
      'situação',
      'valor',
      'taxa Mercado Pago',
      'taxa Venduá',
      // before refunds, like the statement on screen; refunds are the next column
      'você recebe',
      'reembolsado',
    ];
    const lines = rows.map((p) => [
      p.number,
      p.approved,
      p.kind === 'pix' ? 'Pix' : 'cartão',
      STATUS_WORD[p.status] ?? p.status,
      csvMoney(p.amount),
      p.fee === null ? '' : csvMoney(p.fee),
      csvMoney(p.app),
      csvMoney(p.net),
      csvMoney(p.refunded),
    ]);
    return csvResponse(c, `extrato-mercado-pago-${month}.csv`, head, lines);
  });
}
