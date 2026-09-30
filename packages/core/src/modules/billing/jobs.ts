import type { MerchantNotify } from '../../admin/context.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { controlTx } from '../control.ts';
import type { PaymentProvider } from '../payments/provider.ts';
import { checkCustomDomain, DNS_GIVE_UP_MS, DNS_RECHECK_MS } from './domains.ts';
import {
  billingLog,
  DAY_MS,
  pixIsLive,
  issuePix,
  payerEmailFor,
  PIX_TTL_MS,
  upsertInvoice,
  type InvoiceRow,
} from './invoices.ts';
import { messageOwners, pastDueMessage, queueOwners, reminderMessage } from './notices.ts';
import { planRow } from './plans.ts';
import {
  applyHold,
  applyPendingPlan,
  cancelPendingUpgrade,
  chargePlanId,
  downgradeDue,
  dropPix,
  ensureRenewal,
  lockSub,
  noticeCancelled,
  RENEW_AHEAD_MS,
  setChargeAmount,
  settlePixPayment,
  stopPreapproval,
  withEffects,
  type BillingCtx,
} from './subscriptions.ts';

const TICK_MS = 10 * 60_000;
/** MP charges a card on the period's last day; give its webhook a day before "em atraso" */
const CARD_GRACE_MS = DAY_MS;
const BATCH = 200;

export interface BillingJobOpts {
  provider: PaymentProvider;
  notify: MerchantNotify;
  adminOrigin: string | null;
  /** default VENDUA_STORE_DOMAIN (the custom-domain CNAME target is `<slug>.<storeDomain>`) */
  storeDomain?: string;
}

// Invoices and renewals, reminders, holds, DNS checks — every 10 minutes. Each step picks its
// candidates across stores (controlTx), then re-checks under the store's own lock, so two
// Core instances ticking together do each thing once.
export function startBillingJobs(sql: Sql, o: BillingJobOpts): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBillingTick(sql, o, new Date());
    } catch (err) {
      billingLog.error({ err }, 'billing tick failed');
    } finally {
      running = false;
    }
  };
  let checking = false;
  const dnsTick = async () => {
    if (checking) return;
    checking = true;
    try {
      await runDomainChecks(sql, o, new Date());
    } catch (err) {
      billingLog.error({ err }, 'custom-domain checks failed');
    } finally {
      checking = false;
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const every = setInterval(() => void tick(), TICK_MS);
  const dnsEvery = setInterval(() => void dnsTick(), DNS_RECHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
    clearInterval(dnsEvery);
  };
}

type Step = (
  sql: Sql,
  ctx: Omit<BillingCtx, 'later'>,
  now: Date,
  o: BillingJobOpts,
) => Promise<void>;

export async function runBillingTick(sql: Sql, o: BillingJobOpts, now: Date) {
  const ctx = { sql, provider: o.provider, notify: o.notify, origin: o.adminOrigin };
  const steps: [string, Step][] = [
    ['reconcile', reconcilePix],
    ['end', endCancelled],
    ['upgrades', expireUpgrades],
    ['downgrades', applyDowngrades],
    ['past_due', markPastDue],
    ['renewals', issueRenewals],
    ['reminders', sendReminders],
    ['prices', (sql, base, now) => syncPlanPrices(sql, base, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step(sql, ctx, now, o);
    } catch (err) {
      billingLog.error({ err, step: name }, 'billing step failed');
    }
  }
}

async function each<T>(rows: T[], label: string, fn: (row: T) => Promise<void>) {
  for (const row of rows) {
    try {
      await fn(row);
    } catch (err) {
      billingLog.warn({ err, step: label }, 'billing item failed');
    }
  }
}

/** a missed webhook must not leave a paid Pix open: ask MP about every live attempt */
const reconcilePix: Step = async (sql, base, now) => {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string; ids: string[] }[]>`
      select id, tenant_id,
        array_remove(provider_payment_id || pix_superseded[greatest(cardinality(pix_superseded) - 4, 1):], null) as ids
      from invoices
      where status in ('open', 'void') and provider = ${base.provider.name}
        and (provider_payment_id is not null or cardinality(pix_superseded) > 0)
        and pix_expires_at > ${new Date(now.getTime() - PIX_TTL_MS)}
      order by pix_expires_at limit ${BATCH}
    `,
  );
  await each(rows, 'reconcile', async (r) => {
    for (const pid of r.ids) {
      const p = await base.provider.platformGetPayment(pid).catch(() => null);
      if (!p || p.status !== 'approved' || p.externalReference !== r.id) continue;
      await withEffects(base, (ctx) =>
        withTenant(sql, r.tenant_id, (tx) =>
          settlePixPayment(
            ctx,
            tx,
            r.tenant_id,
            r.id,
            {
              id: p.id,
              amountCents: p.amountCents,
              approvedAt: p.approvedAt ? new Date(p.approvedAt) : now,
            },
            now,
          ),
        ),
      );
      return;
    }
  });
};

/** cancel_at_period_end → cancelled at the end, and the store closes behind billing_hold */
const endCancelled: Step = async (sql, base, now) => {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select tenant_id from subscriptions
      where status in ('active', 'past_due') and cancel_at_period_end and current_period_end <= ${now}
      limit ${BATCH}
    `,
  );
  await each(rows, 'end', async ({ tenant_id }) => {
    const ended = await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        if (!sub || !sub.cancel_at_period_end || sub.status === 'cancelled') return null;
        if (!sub.current_period_end || sub.current_period_end > now) return null;
        await tx`
        update subscriptions set status = 'cancelled', cancel_at_period_end = false,
          pending_plan_id = null, upgrade_plan_id = null, upgrade_invoice_id = null,
          checkout_url = null, updated_at = now(), status_changed_at = now()
        where tenant_id = ${tenant_id}
      `;
        await tx`update invoices set status = 'void' where tenant_id = ${tenant_id} and status in ('open', 'failed')`;
        await applyHold(tx, tenant_id);
        await emitAdminTx(tx, tenant_id, 'billing');
        await noticeCancelled(ctx, tx, sub, true);
        return sub;
      }),
    );
    if (ended?.method === 'card')
      await stopPreapproval(
        { ...base, later: () => {} },
        ended.provider_subscription_id,
        'cancelled',
      );
  });
};

/** an upgrade not paid by the end of its period never applies: its invoice is void */
const expireUpgrades: Step = async (sql, base, now) => {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select s.tenant_id from subscriptions s
        left join invoices i on i.id = s.upgrade_invoice_id
      where (s.upgrade_plan_id is not null or s.upgrade_invoice_id is not null)
        and (i.id is null or i.status <> 'open' or i.period_end <= ${now}
             or s.status not in ('active', 'past_due'))
      limit ${BATCH}
    `,
  );
  await each(rows, 'upgrades', async ({ tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        if (!sub?.upgrade_plan_id && !sub?.upgrade_invoice_id) return;
        const inv = (
          await tx<InvoiceRow[]>`select * from invoices where id = ${sub.upgrade_invoice_id}`
        )[0];
        const live =
          inv?.status === 'open' &&
          inv.period_end > now &&
          (sub.status === 'active' || sub.status === 'past_due');
        if (live) return;
        await cancelPendingUpgrade(ctx, tx, sub);
        await emitAdminTx(tx, tenant_id, 'billing');
      }),
    );
  });
};

/** a downgrade paid for (the new period has begun) takes the store to the new plan */
const applyDowngrades: Step = async (sql, base, now) => {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select s.tenant_id from subscriptions s
      where s.pending_plan_id is not null and s.status in ('active', 'past_due')
        and s.pending_plan_at <= ${now} and s.current_period_start >= s.pending_plan_at
      limit ${BATCH}
    `,
  );
  await each(rows, 'downgrades', async ({ tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        if (!sub || !downgradeDue(sub, sub.current_period_start, now)) return;
        await applyPendingPlan(ctx, tx, tenant_id, sub.pending_plan_id!);
        await emitAdminTx(tx, tenant_id, 'billing');
      }),
    );
  });
};

/** the period ended unpaid: "em atraso" (a banner in the admin — the store stays open) */
const markPastDue: Step = async (sql, base, now) => {
  const cardCutoff = new Date(now.getTime() - CARD_GRACE_MS);
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select tenant_id from subscriptions
      where status = 'active' and not cancel_at_period_end and (
        (method = 'pix' and current_period_end <= ${now}) or
        (method = 'card' and current_period_end <= ${cardCutoff}))
      limit ${BATCH}
    `,
  );
  await each(rows, 'past_due', async ({ tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const late = (
          await tx<{ plan_id: string; current_period_end: Date }[]>`
            update subscriptions set status = 'past_due', updated_at = now(), status_changed_at = now()
            where tenant_id = ${tenant_id} and status = 'active' and not cancel_at_period_end
              and current_period_end <= ${now}
            returning plan_id, current_period_end
          `
        )[0];
        if (!late) return;
        await emitAdminTx(tx, tenant_id, 'billing');
        const plan = await planRow(tx, late.plan_id);
        queueOwners(
          ctx,
          tenant_id,
          pastDueMessage(plan?.name ?? late.plan_id, late.current_period_end, ctx.origin),
          `billing:past_due:${tenant_id}:${late.current_period_end.toISOString()}`,
        );
      }),
    );
  });
};

/** the next month's Pix goes out RENEW_AHEAD_MS before the period ends */
const issueRenewals: Step = async (sql, base, now) => {
  const horizon = new Date(now.getTime() + RENEW_AHEAD_MS);
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select s.tenant_id from subscriptions s
      where s.status in ('active', 'past_due') and s.method = 'pix' and not s.cancel_at_period_end
        and s.current_period_end <= ${horizon}
        and not exists (select 1 from invoices i where i.tenant_id = s.tenant_id
                          and i.period_start = s.current_period_end and i.status <> 'void')
      limit ${BATCH}
    `,
  );
  await each(rows, 'renewals', async ({ tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        if (!sub) return;
        const inv = await ensureRenewal(ctx, tx, sub, now);
        if (inv) await emitAdminTx(tx, tenant_id, 'billing', inv.id);
      }),
    );
  });
};

type Stage = 'due_soon' | 'due' | 'overdue';

function stageFor(inv: InvoiceRow, now: Date): Stage | null {
  const due = inv.due_at.getTime();
  const t = now.getTime();
  if (t >= due + 3 * DAY_MS) return 'overdue';
  if (t >= due) return 'due';
  if (t >= due - 3 * DAY_MS) return 'due_soon';
  return null;
}

const ORDER: Stage[] = ['due_soon', 'due', 'overdue'];

/** due_soon (3 days before), due, overdue (+3 days) — each at most once per invoice */
const sendReminders: Step = async (sql, base, now) => {
  const rows = await controlTx(
    sql,
    (tx) => tx<(InvoiceRow & { plan_name: string })[]>`
      select i.*, p.name as plan_name from invoices i
        join subscriptions s on s.tenant_id = i.tenant_id
        join plans p on p.id = i.plan_id
      where i.status = 'open' and i.method = 'pix' and i.kind = 'period'
        and s.status in ('active', 'past_due') and s.method = 'pix' and i.due_at <= ${new Date(now.getTime() + 3 * DAY_MS)}
        and not ('overdue' = any(i.reminded))
      order by i.due_at limit ${BATCH}
    `,
  );
  await each(rows, 'reminders', async (inv) => {
    const stage = stageFor(inv, now);
    if (!stage || inv.reminded.includes(stage)) return;
    const upto = ORDER.slice(0, ORDER.indexOf(stage) + 1);
    // claim first: a failed send is logged, never repeated into a second message
    const claimed = await withEffects(base, (ctx) =>
      withTenant(sql, inv.tenant_id, async (tx) => {
        const sub = await lockSub(tx, inv.tenant_id);
        const row = (
          await tx<InvoiceRow[]>`
            update invoices set reminded = array(select distinct unnest(reminded || ${upto}::text[]))
            where id = ${inv.id} and status = 'open' and not (${stage} = any(reminded))
            returning *
          `
        )[0];
        if (!row) return null;
        // the Pix in the message must still be payable
        if (stage !== 'due_soon' && !pixIsLive(row, now)) {
          const payerEmail = await payerEmailFor(tx, inv.tenant_id, sub?.payer_email);
          if (payerEmail)
            await issuePix(tx, ctx.provider, row, {
              payerEmail,
              planName: inv.plan_name,
              origin: ctx.origin,
              now,
              drop: dropPix(ctx),
            });
        }
        await emitAdminTx(tx, inv.tenant_id, 'billing', inv.id);
        return row;
      }),
    );
    if (!claimed) return;
    await messageOwners(
      base,
      inv.tenant_id,
      reminderMessage(stage, claimed, inv.plan_name, base.origin),
      `invoice-reminder:${inv.id}:${stage}`,
    );
  });
};

/**
 * Prices follow the catalog (a CRM price change applies to future charges): the MP assinatura
 * amount, and unpaid Pix invoices for a period that hasn't begun (or a first one, nothing paid
 * yet). Idempotent: rows already at the price are skipped. Also run right after a CRM edit.
 */
export async function syncPlanPrices(sql: Sql, base: Omit<BillingCtx, 'later'>, now: Date) {
  const cards = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select s.tenant_id from subscriptions s
        join plans p on p.id = coalesce(s.pending_plan_id, s.plan_id)
      where s.method = 'card' and s.provider_subscription_id is not null
        and s.status in ('pending', 'active', 'past_due') and s.provider = ${base.provider.name}
        and s.charge_cents is distinct from p.price_cents
      limit ${BATCH}
    `,
  );
  await each(cards, 'prices', async ({ tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        if (!sub || sub.status === 'cancelled') return;
        const plan = await planRow(tx, chargePlanId(sub));
        if (!plan || sub.charge_cents === plan.price_cents) return;
        await setChargeAmount(ctx, tx, sub, plan.price_cents);
      }),
    );
  });
  const invs = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string }[]>`
      select i.id, i.tenant_id from invoices i
        join plans p on p.id = i.plan_id
        join subscriptions s on s.tenant_id = i.tenant_id
      where i.status = 'open' and i.method = 'pix' and i.kind = 'period'
        and i.provider = ${base.provider.name} and i.amount_cents <> p.price_cents and (s.status = 'pending' or i.period_start > ${now})
      limit ${BATCH}
    `,
  );
  await each(invs, 'prices', async ({ id, tenant_id }) => {
    await withEffects(base, (ctx) =>
      withTenant(sql, tenant_id, async (tx) => {
        const sub = await lockSub(tx, tenant_id);
        const inv = (
          await tx<
            InvoiceRow[]
          >`select * from invoices where tenant_id = ${tenant_id} and id = ${id}`
        )[0];
        if (!sub || !inv || inv.status !== 'open' || inv.method !== 'pix') return;
        const plan = await planRow(tx, inv.plan_id);
        if (!plan || plan.price_cents === inv.amount_cents) return;
        const hadPix = !!inv.pix_copy_paste;
        let next = await upsertInvoice(tx, {
          tenantId: tenant_id,
          provider: ctx.provider.name,
          drop: dropPix(ctx),
          start: inv.period_start,
          planId: plan.id,
          amountCents: plan.price_cents,
          method: 'pix',
          dueAt: inv.due_at,
          reuse: inv,
        });
        const payerEmail = hadPix ? await payerEmailFor(tx, tenant_id, sub.payer_email) : null;
        if (payerEmail)
          next = await issuePix(tx, ctx.provider, next, {
            payerEmail,
            planName: plan.name,
            origin: ctx.origin,
            now,
            drop: dropPix(ctx),
          });
        await emitAdminTx(tx, tenant_id, 'billing', next.id);
      }),
    );
  });
}

/** pending_dns domains, each at most every DNS_RECHECK_MS */
export async function runDomainChecks(sql: Sql, o: BillingJobOpts, now: Date) {
  const storeDomain = o.storeDomain ?? process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';
  const rows = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string }[]>`
      select id, tenant_id from custom_domains
      where status = 'pending_dns'
        and (last_checked_at is null or last_checked_at <= ${new Date(now.getTime() - DNS_RECHECK_MS + 60_000)})
      order by last_checked_at nulls first limit ${BATCH}
    `,
  );
  await each(rows, 'dns', async (r) => {
    await checkCustomDomain(sql, { tenantId: r.tenant_id, domainId: r.id, storeDomain, now });
  });
  // a claim that gave up a week ago is gone: it never held the host, it only clutters
  await controlTx(
    sql,
    (tx) => tx`
      delete from custom_domains
      where status = 'failed' and coalesce(last_checked_at, created_at) < ${new Date(now.getTime() - DNS_GIVE_UP_MS)}
    `,
  );
}
