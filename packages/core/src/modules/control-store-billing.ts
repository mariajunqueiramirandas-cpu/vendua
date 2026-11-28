import type { Context, Hono } from 'hono';
import { audit } from '../admin/audit.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { STAFF_AI_DAYS_MAX, STAFF_AI_MAX, grantAiConversationsTx } from './billing/ai-allowance.ts';
import { dayMonth, queueOwners, staffAiMessage } from './billing/notices.ts';
import { planRow } from './billing/plans.ts';
import { STAFF_MONTHS_MAX, grantFreeMonthsTx } from './billing/referrals.ts';
import {
  STAFF_ACTIVATE_MONTHS_MAX,
  cancelSubscription,
  resumeSubscription,
  runEffects,
  staffActivateFree,
  staffChangePlan,
  type BillingCtx,
} from './billing/subscriptions.ts';
import { claimControl } from './control.ts';
import { recordStaffEventTx, type StaffEventMap } from './staff-events.ts';

// /control/v1/stores/:id/billing/* (CRM → a store's page): what the team changes in one store's
// plan, through the same billing code the owner's Conta uses. Each write is a staff claim
// (idempotent), runs as the store (its tenant-scoped rows), logs to the store's audit as "Equipe
// Venduá" and tells the team (billing.staff; a cancel already tells it as billing.problem).

const STAFF = { userId: null, name: 'Equipe Venduá' } as const;
const NOTE_MAX = 200;

function count(v: unknown, field: string, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max)
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an integer 1–${max}`, { field });
  return v;
}

/** optional, trimmed, empty → null */
function note(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > NOTE_MAX * 2)
    throw new HttpError(422, 'BAD_REQUEST', `note must be text up to ${NOTE_MAX} characters`, {
      field: 'note',
    });
  const t = v.trim();
  if (t.length > NOTE_MAX)
    throw new HttpError(422, 'BAD_REQUEST', `note must be text up to ${NOTE_MAX} characters`, {
      field: 'note',
    });
  return t || null;
}

const months = (n: number) => (n === 1 ? '1 mês' : `${n} meses`);

export function mountControlStoreBilling(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  idemKey: (c: Context) => string;
  billingBase: Omit<BillingCtx, 'later'>;
}) {
  const { app, sql, controlGate, idemKey, billingBase } = o;

  /**
   * One staff write on store `:id`: claimed once per Idempotency-Key, run as the store, and its
   * effects (owner messages, a superseded Pix cancelled at MP) only after the claim commits.
   */
  const storeWrite = async <T>(
    c: Context,
    work: (
      tx: Sql,
      ctx: BillingCtx,
      store: { id: string; name: string },
    ) => Promise<{ body: T; event?: StaffEventMap['billing.staff'] | null }>,
  ) => {
    const id = uuidParam(c, 'id').toLowerCase();
    const effects: (() => Promise<unknown>)[] = [];
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const store = (
        await tx<{ id: string; name: string }[]>`
          select id, name from tenants where id = ${id} and status <> 'platform'
        `
      )[0];
      if (!store) throw new HttpError(404, 'NOT_FOUND', 'store not found');
      // the store's own tables (subscriptions, invoices, settings) are tenant-scoped
      await tx`select set_config('vendua.tenant_id', ${id}, true)`;
      const ctx: BillingCtx = { ...billingBase, later: (fn) => void effects.push(fn) };
      const out = await work(tx, ctx, store);
      if (out.event) await recordStaffEventTx(tx, 'billing.staff', out.event, { tenantId: id });
      return { status: 200, body: out.body };
    });
    await runEffects(effects);
    return c.json(res.body as never, res.status as 200);
  };

  // up or down, now, nothing charged apart: the next charge is at the new plan's price
  app.post('/control/v1/stores/:id/billing/plan', async (c) => {
    controlGate(c);
    const body = await bodyJson(c, 1024);
    if (typeof body.planId !== 'string' || !/^[a-z0-9_]{2,30}$/.test(body.planId))
      throw new HttpError(422, 'BAD_REQUEST', 'planId must be a plan id', { field: 'planId' });
    const planId = body.planId;
    const why = note(body.note);
    return storeWrite(c, async (tx, ctx, store) => {
      const plan = await planRow(tx, planId);
      if (!plan) throw new HttpError(422, 'UNKNOWN_PLAN', 'no such plan', { field: 'planId' });
      const { before } = await staffChangePlan(ctx, tx, store.id, plan, new Date());
      const from = (await planRow(tx, before.plan_id))?.name ?? before.plan_id;
      await audit(tx, store.id, STAFF, {
        action: 'subscription.change',
        entity: 'account',
        entityId: store.id,
        summary: `a equipe trocou o plano de ${from} para ${plan.name}, sem cobrar a diferença`,
        before: { planId: before.plan_id, pendingPlanId: before.pending_plan_id },
        after: { planId: plan.id, note: why },
      });
      return {
        body: { ok: true },
        event: {
          storeName: store.name,
          action: 'plan',
          detail: `${from} → ${plan.name}`,
          note: why,
        },
      };
    });
  });

  // a trial (or a store waiting for its first payment) becomes a paid plan the store pays nothing for
  app.post('/control/v1/stores/:id/billing/activate', async (c) => {
    controlGate(c);
    const body = await bodyJson(c, 1024);
    const n = count(body.months, 'months', STAFF_ACTIVATE_MONTHS_MAX);
    const why = note(body.note);
    return storeWrite(c, async (tx, ctx, store) => {
      const { plan, until, before } = await staffActivateFree(ctx, tx, store.id, n, new Date());
      const was = before.status === 'trialing' ? 'o teste grátis' : 'o primeiro pagamento';
      await audit(tx, store.id, STAFF, {
        action: 'subscription.activate',
        entity: 'account',
        entityId: store.id,
        summary: `a equipe ativou o plano ${plan.name} sem cobrança até ${dayMonth(until)} (no lugar de ${was})`,
        after: { planId: plan.id, until: until.toISOString(), months: n, note: why },
      });
      return {
        body: { ok: true, until: until.toISOString() },
        event: {
          storeName: store.name,
          action: 'activate',
          detail: `${plan.name} por ${months(n)}, até ${dayMonth(until)} (estava ${before.status === 'trialing' ? 'em teste' : 'esperando o primeiro pagamento'})`,
          note: why,
        },
      };
    });
  });

  // owed like a referral's: a Pix plan's next charge moves on, a card plan gets its charges back
  app.post('/control/v1/stores/:id/billing/free-months', async (c) => {
    controlGate(c);
    const body = await bodyJson(c, 1024);
    const n = count(body.months, 'months', STAFF_MONTHS_MAX);
    const why = note(body.note);
    return storeWrite(c, async (tx, _ctx, store) => {
      await grantFreeMonthsTx(tx, store.id, n, why);
      await audit(tx, store.id, STAFF, {
        action: 'billing.credit',
        entity: 'account',
        entityId: store.id,
        summary: `a equipe deu ${n === 1 ? 'um mês grátis' : `${n} meses grátis`} do plano`,
        after: { months: n, note: why },
      });
      return {
        body: { ok: true },
        event: {
          storeName: store.name,
          action: 'free_months',
          detail: n === 1 ? '1 mês grátis' : `${n} meses grátis`,
          note: why,
        },
      };
    });
  });

  app.post('/control/v1/stores/:id/billing/ai-credits', async (c) => {
    controlGate(c);
    const body = await bodyJson(c, 1024);
    const conversations = count(body.conversations, 'conversations', STAFF_AI_MAX);
    const days = count(body.days, 'days', STAFF_AI_DAYS_MAX);
    const why = note(body.note);
    return storeWrite(c, async (tx, ctx, store) => {
      const g = await grantAiConversationsTx(tx, store.id, {
        conversations,
        days,
        note: why,
        now: new Date(),
      });
      const n = conversations.toLocaleString('pt-BR');
      await audit(tx, store.id, STAFF, {
        action: 'billing.ai_credit',
        entity: 'account',
        entityId: store.id,
        summary: `a equipe deu ${n} conversas do Duá, que valem até ${dayMonth(g.expiresAt)}`,
        after: { creditId: g.id, conversations, days, note: why },
      });
      queueOwners(
        ctx,
        store.id,
        staffAiMessage(conversations, g.expiresAt),
        `billing:staff_ai:${g.id}`,
      );
      return {
        body: { ok: true, expiresAt: g.expiresAt.toISOString() },
        event: {
          storeName: store.name,
          action: 'ai_credits',
          detail: `${n} conversas, até ${dayMonth(g.expiresAt)}`,
          note: why,
        },
      };
    });
  });

  // as the owner's cancel: the paid period stays the store's, then it ends (the team hears it
  // as billing.problem 'cancelled', in the team's words)
  app.post('/control/v1/stores/:id/billing/cancel', async (c) => {
    controlGate(c);
    return storeWrite(c, async (tx, ctx, store) => {
      const sub = await cancelSubscription(ctx, tx, store.id, 'staff');
      await audit(tx, store.id, STAFF, {
        action: 'subscription.cancel',
        entity: 'account',
        entityId: store.id,
        summary:
          sub.status === 'pending'
            ? 'a equipe cancelou o plano antes do primeiro pagamento'
            : 'a equipe cancelou o plano (vale até o fim do período)',
      });
      return { body: { ok: true }, event: null };
    });
  });

  app.post('/control/v1/stores/:id/billing/resume', async (c) => {
    controlGate(c);
    return storeWrite(c, async (tx, ctx, store) => {
      await resumeSubscription(ctx, tx, store.id, new Date());
      await audit(tx, store.id, STAFF, {
        action: 'subscription.resume',
        entity: 'account',
        entityId: store.id,
        summary: 'a equipe desfez o cancelamento do plano',
      });
      return {
        body: { ok: true },
        event: {
          storeName: store.name,
          action: 'resume',
          detail: 'o plano segue renovando',
          note: null,
        },
      };
    });
  });
}
