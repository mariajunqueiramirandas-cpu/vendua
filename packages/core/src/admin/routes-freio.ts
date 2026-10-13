import { freioConfig, kitchenNowTx, pauseUntil, deliveryPaused } from '../modules/freio.ts';
import type { FreioLevel } from '../modules/store.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { dismissLateNoticeTx, sendLateNoticeTx } from './late-orders.ts';
import { audit } from './audit.ts';
import { int, oneOf, roleAtLeast, type AdminDeps, type Merchant } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { loadSettings } from './routes-store.ts';

// Loja › Freio automático (0125, docs/features/freio-automatico.md): the kitchen's queue now, the
// brake's suggestion or pause, and its settings. Applying a suggestion or undoing a pause is a
// tap here (Início shows the same card); the sweep does the rest (modules/freio.ts).

/** Automático waits until the board is really used: 80% of last week's orders marked ready. */
const AUTO_READY_RATE = 0.8;
const AUTO_MIN_ORDERS = 10;
/** after an undo or a "agora não", the brake leaves the store alone this long */
const HOLD_MINUTES = 30;

async function readyRateTx(tx: Sql, tenantId: string) {
  const [r] = await tx<{ done: number; marked: number }[]>`
    select count(*)::int as done,
           count(*) filter (where exists (
             select 1 from order_events e where e.order_id = o.id and e.to_state = 'ready'))::int as marked
    from orders o
    where o.tenant_id = ${tenantId} and o.placed_at > now() - interval '7 days'
      and o.state in ('ready', 'out_for_delivery', 'delivered')`;
  const done = r?.done ?? 0;
  return { done, rate: done ? (r!.marked ?? 0) / done : 0 };
}

/** The month's apology coupons by face value (São Paulo month, as the Vendedor's incentives). */
export async function apologySpentTx(tx: Sql, tenantId: string): Promise<number> {
  const [r] = await tx<{ cents: number }[]>`
    select coalesce(sum(coupon_cents), 0)::int as cents from order_late_notices
    where tenant_id = ${tenantId}
      and created_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                         at time zone 'America/Sao_Paulo')`;
  return r?.cents ?? 0;
}

export async function freioViewTx(tx: Sql, tenantId: string) {
  const s = await loadSettings(tx, tenantId);
  const cfg = freioConfig(s);
  const tz = s.hours?.timezone || 'America/Sao_Paulo';
  const [kitchen, ready, spent, late] = await Promise.all([
    kitchenNowTx(tx, tenantId, cfg, tz),
    readyRateTx(tx, tenantId),
    apologySpentTx(tx, tenantId),
    tx<
      {
        orderId: string;
        number: number;
        predictedMinutes: number;
        mode: 'suggest' | 'auto';
        state: string;
        createdAt: Date;
      }[]
    >`
      select n.order_id as "orderId", o.number, n.predicted_minutes as "predictedMinutes", n.mode,
             n.state, n.created_at as "createdAt"
      from order_late_notices n join orders o on o.id = n.order_id
      where n.tenant_id = ${tenantId} and n.state = 'suggested'
        and o.state in ('confirmed', 'preparing', 'ready', 'out_for_delivery')
      order by n.created_at desc limit 10`,
  ]);
  const paused = deliveryPaused(s);
  const suggestion = s.freio_suggestion ?? null;
  return {
    settings: {
      mode: s.freio_mode ?? 'suggest',
      capacity: cfg.capacity,
      bufferMinutes: cfg.buffer,
      maxPromiseMinutes: cfg.maxPromise,
      lateMode: s.late_mode ?? 'suggest',
      apologyKind: s.apology_kind ?? 'free_delivery',
      apologyValueCents: s.apology_value_cents ?? 0,
      apologyBudgetCents: s.apology_budget_cents ?? 0,
    },
    now: {
      queue: kitchen.queue,
      backlogMinutes: kitchen.backlogMinutes,
      pickupMinutes: kitchen.pickupMinutes,
      level: (s.freio_level ?? 'normal') as FreioLevel,
      deliveryPausedUntil: paused?.toISOString() ?? null,
      deliveryEnabled: s.delivery_enabled ?? true,
      suggestion:
        suggestion && !paused
          ? { level: suggestion.level, pausedUntil: suggestion.pausedUntil }
          : null,
    },
    auto: {
      unlocked: ready.done >= AUTO_MIN_ORDERS && ready.rate >= AUTO_READY_RATE,
      readyRate: Math.round(ready.rate * 100) / 100,
      orders: ready.done,
    },
    apology: {
      spentCents: spent,
      leftCents: Math.max(0, (s.apology_budget_cents ?? 0) - spent),
    },
    late: late.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
  };
}

export type FreioView = Awaited<ReturnType<typeof freioViewTx>>;

async function logEvent(
  tx: Sql,
  tenantId: string,
  from: string,
  to: string,
  pausedUntil: Date | null,
) {
  await tx`
    insert into freio_events (tenant_id, from_level, to_level, actor, paused_until)
    values (${tenantId}, ${from}, ${to}, 'owner', ${pausedUntil})`;
}

export function mountFreio(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/freio',
    read('manager', (tx, t) => freioViewTx(tx, t.id)),
  );

  admin.patch(
    '/freio',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, 4 * 1024);
      const owner = roleAtLeast(m.role, 'owner');
      const ownerOnly = [
        'mode',
        'lateMode',
        'apologyKind',
        'apologyValueCents',
        'apologyBudgetCents',
      ];
      if (!owner && ownerOnly.some((k) => body[k] !== undefined))
        throw new HttpError(403, 'FORBIDDEN', 'only the owner changes this', {
          field: ownerOnly.find((k) => body[k] !== undefined),
        });
      const set: Record<string, unknown> = {};
      if (body.mode !== undefined) {
        const mode = oneOf(body.mode, 'mode', ['off', 'suggest', 'auto'] as const);
        if (mode === 'auto') {
          const r = await readyRateTx(tx, t.id);
          if (r.done < AUTO_MIN_ORDERS || r.rate < AUTO_READY_RATE)
            throw new HttpError(
              409,
              'FREIO_AUTO_LOCKED',
              'mark at least 80% of last week’s orders ready first',
              { field: 'mode', readyRate: r.rate },
            );
        }
        set.freio_mode = mode;
      }
      if (body.capacity !== undefined) set.kitchen_capacity = int(body.capacity, 'capacity', 1, 20);
      if (body.bufferMinutes !== undefined)
        set.dispatch_buffer_minutes = int(body.bufferMinutes, 'bufferMinutes', 0, 60);
      if (body.maxPromiseMinutes !== undefined)
        set.max_promise_minutes = int(body.maxPromiseMinutes, 'maxPromiseMinutes', 30, 240);
      if (body.lateMode !== undefined)
        set.late_mode = oneOf(body.lateMode, 'lateMode', ['off', 'suggest', 'auto'] as const);
      if (body.apologyKind !== undefined)
        set.apology_kind = oneOf(body.apologyKind, 'apologyKind', [
          'free_delivery',
          'fixed',
        ] as const);
      if (body.apologyValueCents !== undefined)
        set.apology_value_cents = int(body.apologyValueCents, 'apologyValueCents', 0, 10_000);
      if (body.apologyBudgetCents !== undefined)
        set.apology_budget_cents = int(body.apologyBudgetCents, 'apologyBudgetCents', 0, 1_000_000);
      const keys = Object.keys(set);
      if (!keys.length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      await loadSettings(tx, t.id);
      await tx`update store_settings set ${tx(set, ...keys)} where tenant_id = ${t.id}`;
      // turned off: a pause the brake put on goes with it
      if (set.freio_mode === 'off')
        await tx`update store_settings set delivery_paused_until = null, freio_suggestion = null,
                   freio_level = 'normal', freio_level_since = now()
                 where tenant_id = ${t.id}`;
      await audit(tx, t.id, m, {
        action: 'store.freio',
        entity: 'store',
        summary: `mudou o freio automático (${keys.join(', ')})`,
        after: set,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await freioViewTx(tx, t.id) };
    }),
  );

  // Sugerir's "pausar entregas": the suggestion, applied as Automático would have
  admin.post(
    '/freio/apply',
    write('manager', async (tx, t, m) => {
      const s = await loadSettings(tx, t.id);
      const sug = s.freio_suggestion;
      if (!sug) throw new HttpError(409, 'NOTHING_TO_APPLY', 'there is no suggestion now');
      const tz = s.hours?.timezone || 'America/Sao_Paulo';
      const cfg = freioConfig(s);
      const k = await kitchenNowTx(tx, t.id, cfg, tz);
      const until = pauseUntil(sug.level, k, new Date()) ?? new Date(Date.now() + 15 * 60_000);
      await tx`update store_settings set delivery_paused_until = ${until}, freio_suggestion = null
               where tenant_id = ${t.id}`;
      await logEvent(tx, t.id, s.freio_level ?? 'normal', sug.level, until);
      await audit(tx, t.id, m, {
        action: 'store.freio',
        entity: 'store',
        summary: `pausou as entregas pelo freio até ${until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz })}`,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await freioViewTx(tx, t.id) };
    }),
  );

  // "agora não" (a suggestion) or "desfazer" (a pause): delivery back, the brake waits a while
  const standDown = (kind: 'dismiss' | 'release') =>
    write('manager', async (tx, t, m: Merchant) => {
      const s = await loadSettings(tx, t.id);
      const was = deliveryPaused(s);
      if (kind === 'release' && !was)
        throw new HttpError(409, 'NOT_PAUSED', 'delivery is not paused by the brake');
      await tx`
        update store_settings set delivery_paused_until = null, freio_suggestion = null,
          freio_hold_until = now() + make_interval(mins => ${HOLD_MINUTES})
        where tenant_id = ${t.id}`;
      if (was) await logEvent(tx, t.id, s.freio_level ?? 'normal', s.freio_level ?? 'normal', null);
      await audit(tx, t.id, m, {
        action: 'store.freio',
        entity: 'store',
        summary: was ? 'desfez a pausa das entregas do freio' : 'dispensou a sugestão do freio',
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await freioViewTx(tx, t.id) };
    });
  admin.post('/freio/dismiss', standDown('dismiss'));

  // Atraso avisado (Sugerir): "avisar o cliente" or "não precisa"
  admin.post(
    '/freio/late/:orderId',
    write('manager', async (tx, t, m, c) => {
      const orderId = uuidParam(c, 'orderId');
      const r = await sendLateNoticeTx(tx, t.id, m, orderId);
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: { ...r, freio: await freioViewTx(tx, t.id) } };
    }),
  );
  admin.post(
    '/freio/late/:orderId/dismiss',
    write('manager', async (tx, t, _m, c) => {
      await dismissLateNoticeTx(tx, t.id, uuidParam(c, 'orderId'));
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await freioViewTx(tx, t.id) };
    }),
  );
  admin.post('/freio/release', standDown('release'));
}
