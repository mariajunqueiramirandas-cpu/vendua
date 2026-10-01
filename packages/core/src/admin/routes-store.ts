import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import {
  deriveStatus,
  type SpecialDay,
  type StoreSettingsRow,
  type WeeklyWindow,
} from '../modules/store.ts';
import { audit } from './audit.ts';
import {
  DATE_RE,
  HHMM_RE,
  bool,
  int,
  isObj,
  oneOf,
  optInt,
  optText,
  text,
  type AdminDeps,
} from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { nextLocalMidnight } from './routes-catalog.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import { parsePolygon, type LatLng } from '../modules/geo.ts';

/** encomendas: the offline methods a preorder may be limited to */
const METHODS = ['pix', 'card_on_delivery', 'cash', 'meal_voucher'] as const;

export async function loadSettings(tx: Sql, tenantId: string): Promise<StoreSettingsRow> {
  let row = (
    await tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenantId}`
  )[0];
  if (!row) {
    // a store provisioned without settings still gets a working row (defaults)
    row = (
      await tx<
        StoreSettingsRow[]
      >`insert into store_settings (tenant_id) values (${tenantId}) returning *`
    )[0]!;
  }
  return row;
}

/** A self-serve store stays paused until its plan's first payment lands (CORE-BILL lifts it). */
export function assertNoBillingHold(s: StoreSettingsRow) {
  if (s.billing_hold)
    throw new HttpError(
      409,
      'BILLING_HOLD',
      'the store opens when the first plan payment is confirmed',
    );
}

export function statusOf(s: StoreSettingsRow) {
  return deriveStatus(
    s.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    s.status_override ?? null,
    s.resumes_at ?? null,
    new Date(),
    s.special_days ?? [],
  );
}

async function zonesOf(tx: Sql, tenantId: string) {
  const rows = await tx<
    {
      id: string;
      name: string;
      kind: 'neighborhood' | 'radius' | 'polygon';
      neighborhoods: string[];
      polygon: LatLng[] | null;
      fee_cents: number;
      min_order_cents: number;
      eta_min_minutes: number;
      eta_max_minutes: number;
      active: boolean;
      max_distance_km: string | null;
      fee_per_km_cents: number;
      free_delivery_over_cents: number | null;
    }[]
  >`select * from delivery_zones where tenant_id = ${tenantId} order by kind, coalesce(max_distance_km, 0), name`;
  return rows.map((z) => ({
    id: z.id,
    name: z.name,
    kind: z.kind,
    neighborhoods: z.neighborhoods,
    feeCents: z.fee_cents,
    minOrderCents: z.min_order_cents,
    etaMin: z.eta_min_minutes,
    etaMax: z.eta_max_minutes,
    active: z.active,
    maxDistanceKm: z.max_distance_km == null ? null : Number(z.max_distance_km),
    feePerKmCents: z.fee_per_km_cents,
    freeDeliveryOverCents: z.free_delivery_over_cents,
    polygon: z.polygon,
  }));
}

export async function storeView(
  tx: Sql,
  tenantId: string,
  slug: string,
  name: string,
  domain: string,
) {
  const url = await storeOrigin(tx, { id: tenantId, slug }, domain);
  const s = await loadSettings(tx, tenantId);
  const st = statusOf(s);
  return {
    url,
    profile: {
      name,
      tagline: s.tagline,
      description: s.description,
      whatsapp: s.whatsapp,
      instagram: s.instagram,
      email: s.email ?? null,
      city: s.city,
      address: s.address,
      logoUrl: s.logo_url ?? null,
    },
    status: {
      status: st.status,
      resumesAt: st.resumesAt ?? null,
      // when the derived status may flip by the clock: the admin refetches then, no polling
      changesAt: st.resumesAt ?? st.closesAt ?? null,
      override: s.status_override,
      pauseMessage: s.pause_message ?? null,
      closedMessage: s.closed_message ?? null,
      billingHold: !!s.billing_hold,
    },
    hours: s.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    specialDays: s.special_days ?? [],
    operations: {
      prepTimeMinutes: s.prep_time_minutes,
      acceptTargetMinutes: s.accept_target_minutes ?? 5,
      minOrderCents: s.min_order_cents,
      pickupEnabled: s.pickup_enabled,
      pickupAddress: s.pickup_address ?? null,
      pickupInstructions: s.pickup_instructions ?? null,
      deliveryEnabled: s.delivery_enabled,
      demand: s.demand_level ?? 'normal',
    },
    location:
      s.latitude != null && s.longitude != null
        ? { latitude: Number(s.latitude), longitude: Number(s.longitude) }
        : null,
    preorder: {
      paymentMethods: s.preorder_payment_methods ?? ['pix'],
      maxDays: s.preorder_max_days ?? 30,
    },
    zones: await zonesOf(tx, tenantId),
  };
}

function parseWindows(v: unknown): WeeklyWindow[] {
  if (!Array.isArray(v) || v.length > 28)
    throw new HttpError(422, 'BAD_REQUEST', 'hours: at most 28 time ranges', { field: 'hours' });
  return v.map((w, i) => {
    if (!isObj(w)) throw new HttpError(422, 'BAD_REQUEST', `hours[${i}] must be an object`);
    const days = w.days;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'each range needs weekdays 0–6', {
        field: `hours[${i}].days`,
      });
    const open = typeof w.open === 'string' && HHMM_RE.test(w.open) ? w.open : null;
    const close = typeof w.close === 'string' && HHMM_RE.test(w.close) ? w.close : null;
    if (!open || !close || open === close)
      throw new HttpError(422, 'BAD_REQUEST', 'times look like 09:00 and must differ', {
        field: `hours[${i}]`,
      });
    return { days: [...new Set(days as number[])].sort(), open, close };
  });
}

function parseSpecialDays(v: unknown): SpecialDay[] {
  if (!Array.isArray(v) || v.length > 60)
    throw new HttpError(422, 'BAD_REQUEST', 'at most 60 special days', { field: 'specialDays' });
  const seen = new Set<string>();
  return v
    .map((d, i) => {
      if (!isObj(d) || typeof d.date !== 'string' || !DATE_RE.test(d.date))
        throw new HttpError(422, 'BAD_REQUEST', 'special days need a date', {
          field: `specialDays[${i}]`,
        });
      if (seen.has(d.date))
        throw new HttpError(422, 'BAD_REQUEST', `${d.date} is listed twice`, {
          field: `specialDays[${i}]`,
        });
      seen.add(d.date);
      const closed = bool(d.closed, 'closed');
      const out: SpecialDay = { date: d.date, closed };
      if (!closed) {
        if (
          typeof d.open !== 'string' ||
          !HHMM_RE.test(d.open) ||
          typeof d.close !== 'string' ||
          !HHMM_RE.test(d.close) ||
          d.open >= d.close
        )
          throw new HttpError(422, 'BAD_REQUEST', 'special hours need open before close', {
            field: `specialDays[${i}]`,
          });
        out.open = d.open;
        out.close = d.close;
      }
      const label = optText(d.label, 'label', 60);
      if (label) out.label = label;
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function zoneFields(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) out.name = text(b.name, 'name', 80, 1);
  if (b.kind !== undefined)
    out.kind = oneOf(b.kind, 'kind', ['neighborhood', 'radius', 'polygon'] as const);
  if (b.neighborhoods !== undefined) {
    if (!Array.isArray(b.neighborhoods) || b.neighborhoods.length > 200)
      throw new HttpError(422, 'BAD_REQUEST', 'at most 200 neighborhoods', {
        field: 'neighborhoods',
      });
    out.neighborhoods = [
      ...new Set(b.neighborhoods.map((n, i) => text(n, `neighborhoods[${i}]`, 120, 1))),
    ];
  }
  // a new zone without a kind is a neighborhood zone (the column default)
  const kind = out.kind ?? (partial ? undefined : 'neighborhood');
  if (b.polygon !== undefined && b.polygon !== null) {
    const r = parsePolygon(b.polygon);
    if ('error' in r) throw new HttpError(422, 'BAD_REQUEST', r.error, { field: 'polygon' });
    if (kind !== undefined && kind !== 'polygon')
      throw new HttpError(422, 'BAD_REQUEST', 'only a polygon zone takes a polygon', {
        field: 'polygon',
      });
    out.polygon = r.polygon;
  } else if (kind !== undefined && kind !== 'polygon') out.polygon = null;
  if (b.maxDistanceKm !== undefined) {
    const km = b.maxDistanceKm === null ? null : Number(b.maxDistanceKm);
    if (km !== null && !(km > 0 && km <= 500))
      throw new HttpError(422, 'BAD_REQUEST', 'distance must be 0–500 km', {
        field: 'maxDistanceKm',
      });
    out.max_distance_km = km;
  }
  const ints: [string, string, number, number][] = [
    ['feeCents', 'fee_cents', 0, 1_000_000],
    ['feePerKmCents', 'fee_per_km_cents', 0, 100_000],
    ['minOrderCents', 'min_order_cents', 0, 10_000_000],
    ['etaMin', 'eta_min_minutes', 0, 1440],
    ['etaMax', 'eta_max_minutes', 0, 1440],
  ];
  for (const [k, col, min, max] of ints) if (b[k] !== undefined) out[col] = int(b[k], k, min, max);
  if (b.freeDeliveryOverCents !== undefined)
    out.free_delivery_over_cents = optInt(
      b.freeDeliveryOverCents,
      'freeDeliveryOverCents',
      1,
      10_000_000,
    );
  if (b.active !== undefined) out.active = bool(b.active, 'active');
  if (
    out.eta_min_minutes !== undefined &&
    out.eta_max_minutes !== undefined &&
    (out.eta_min_minutes as number) > (out.eta_max_minutes as number)
  )
    throw new HttpError(422, 'BAD_REQUEST', 'the shortest time is above the longest', {
      field: 'etaMin',
    });
  if (!partial && out.kind === 'radius' && out.max_distance_km == null)
    throw new HttpError(422, 'BAD_REQUEST', 'a radius zone needs a distance', {
      field: 'maxDistanceKm',
    });
  if (!partial && out.kind === 'polygon' && !out.polygon)
    throw new HttpError(422, 'BAD_REQUEST', 'draw the area with at least 3 points', {
      field: 'polygon',
    });
  if (
    !partial &&
    out.kind !== 'radius' &&
    out.kind !== 'polygon' &&
    !(out.neighborhoods as string[] | undefined)?.length
  )
    throw new HttpError(422, 'BAD_REQUEST', 'list at least one neighborhood', {
      field: 'neighborhoods',
    });
  return out;
}

function zoneColumns(tx: Sql, f: Record<string, unknown>) {
  return {
    ...f,
    ...(f.neighborhoods ? { neighborhoods: tx.json(f.neighborhoods as string[]) } : {}),
    ...(f.polygon ? { polygon: tx.json(f.polygon as LatLng[]) } : {}),
  };
}

/** PATCH can set kind and polygon apart; the row's check is what sees both. */
function polygonMismatch(err: unknown): never {
  if ((err as { constraint_name?: string }).constraint_name === 'delivery_zones_polygon_check')
    throw new HttpError(422, 'BAD_REQUEST', 'a polygon zone needs its polygon, and only it', {
      field: 'polygon',
    });
  throw err;
}

export function mountStore(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const view = (tx: Sql, t: { id: string; slug: string; name: string }) =>
    storeView(tx, t.id, t.slug, t.name, d.storeDomain);

  // attendants read it too: the status pill and today's hours are on every screen
  admin.get(
    '/store',
    read('attendant', async (tx, t) => view(tx, t)),
  );

  admin.patch(
    '/store',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, 64 * 1024);
      const s = await loadSettings(tx, t.id);
      const set: Record<string, unknown> = {};
      const changed: string[] = [];
      const p = isObj(body.profile) ? body.profile : null;
      if (p) {
        if (p.name !== undefined) {
          const name = text(p.name, 'name', 80, 2);
          await tx`update tenants set name = ${name} where id = ${t.id}`;
          changed.push('nome');
        }
        const texts: [string, string, number][] = [
          ['tagline', 'tagline', 120],
          ['description', 'description', 1000],
          ['instagram', 'instagram', 60],
          ['email', 'email', 200],
          ['city', 'city', 80],
          ['address', 'address', 300],
        ];
        for (const [k, col, max] of texts)
          if (p[k] !== undefined) {
            set[col] = optText(p[k], k, max) ?? null;
            changed.push(k);
          }
        if (p.whatsapp !== undefined) {
          const w =
            p.whatsapp === null || p.whatsapp === '' ? null : String(p.whatsapp).replace(/\D/g, '');
          if (w !== null && !/^\d{10,13}$/.test(w))
            throw new HttpError(422, 'BAD_REQUEST', 'WhatsApp needs DDD + number', {
              field: 'whatsapp',
            });
          set.whatsapp = w;
          changed.push('whatsapp');
        }
        if (p.logoUrl !== undefined) {
          const u = optText(p.logoUrl, 'logoUrl', 1000) ?? null;
          if (u && (!/^(https:\/\/|\/)/.test(u) || u.startsWith('//')))
            throw new HttpError(422, 'BAD_REQUEST', 'logo must be uploaded or https', {
              field: 'logoUrl',
            });
          set.logo_url = u;
          changed.push('logo');
        }
      }
      if (body.hours !== undefined) {
        set.hours = tx.json({
          timezone: s.hours?.timezone ?? 'America/Sao_Paulo',
          windows: parseWindows(body.hours),
        } as never);
        changed.push('horários');
      }
      if (body.specialDays !== undefined) {
        set.special_days = tx.json(parseSpecialDays(body.specialDays) as never);
        changed.push('dias especiais');
      }
      const o = isObj(body.operations) ? body.operations : null;
      if (o) {
        if (o.prepTimeMinutes !== undefined)
          set.prep_time_minutes = int(o.prepTimeMinutes, 'prepTimeMinutes', 1, 600);
        if (o.acceptTargetMinutes !== undefined)
          set.accept_target_minutes = int(o.acceptTargetMinutes, 'acceptTargetMinutes', 1, 120);
        if (o.minOrderCents !== undefined)
          set.min_order_cents = int(o.minOrderCents, 'minOrderCents', 0, 10_000_000);
        if (o.pickupEnabled !== undefined)
          set.pickup_enabled = bool(o.pickupEnabled, 'pickupEnabled');
        if (o.deliveryEnabled !== undefined)
          set.delivery_enabled = bool(o.deliveryEnabled, 'deliveryEnabled');
        if (o.demand !== undefined)
          set.demand_level = oneOf(o.demand, 'demand', ['normal', 'high'] as const);
        if (o.pickupAddress !== undefined)
          set.pickup_address = optText(o.pickupAddress, 'pickupAddress', 200) ?? null;
        if (o.pickupInstructions !== undefined)
          set.pickup_instructions =
            optText(o.pickupInstructions, 'pickupInstructions', 300) ?? null;
        const pickup = (set.pickup_enabled as boolean | undefined) ?? s.pickup_enabled;
        const delivery = (set.delivery_enabled as boolean | undefined) ?? s.delivery_enabled;
        if (!pickup && !delivery)
          throw new HttpError(422, 'BAD_REQUEST', 'keep pickup or delivery on', {
            field: 'pickupEnabled',
          });
        changed.push('operação');
      }
      const msg = isObj(body.messages) ? body.messages : null;
      if (msg) {
        if (msg.pause !== undefined) set.pause_message = optText(msg.pause, 'pause', 200) ?? null;
        if (msg.closed !== undefined)
          set.closed_message = optText(msg.closed, 'closed', 200) ?? null;
        changed.push('mensagens');
      }
      if (body.location !== undefined) {
        const l = body.location;
        if (l === null) {
          set.latitude = null;
          set.longitude = null;
        } else {
          const lat = Number(isObj(l) ? l.latitude : NaN);
          const lng = Number(isObj(l) ? l.longitude : NaN);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          )
            throw new HttpError(422, 'BAD_REQUEST', 'location needs latitude and longitude', {
              field: 'location',
            });
          set.latitude = lat;
          set.longitude = lng;
        }
        changed.push('localização');
      }
      const pre = isObj(body.preorder) ? body.preorder : null;
      if (pre) {
        if (pre.paymentMethods !== undefined) {
          const pm = pre.paymentMethods;
          if (
            !Array.isArray(pm) ||
            pm.length === 0 ||
            !pm.every((x) => (METHODS as readonly unknown[]).includes(x))
          )
            throw new HttpError(422, 'BAD_REQUEST', 'pick at least one payment method', {
              field: 'paymentMethods',
            });
          set.preorder_payment_methods = tx.json([...new Set(pm as string[])]);
        }
        if (pre.maxDays !== undefined) set.preorder_max_days = int(pre.maxDays, 'maxDays', 1, 120);
        changed.push('encomendas');
      }
      if (!changed.length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      if (Object.keys(set).length)
        await tx`update store_settings set ${tx(set as never)} where tenant_id = ${t.id}`;
      const name = (await tx<{ name: string }[]>`select name from tenants where id = ${t.id}`)[0]!
        .name;
      await audit(tx, t.id, m, {
        action: 'store.update',
        entity: 'store',
        summary: `alterou ${changed.join(', ')} da loja`,
        after: body,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await view(tx, { ...t, name }) };
    }),
  );

  // "Pausar agora": 15 min · 1 h · rest of the day · until I resume · custom minutes.
  admin.post(
    '/store/pause',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const span = oneOf(body.for, 'for', ['15m', '1h', 'today', 'indefinite', 'minutes'] as const);
      const settings = await loadSettings(tx, t.id);
      // a timed pause ends by opening the store — not while the plan is unpaid
      if (span !== 'indefinite') assertNoBillingHold(settings);
      const until =
        span === '15m'
          ? new Date(Date.now() + 15 * 60_000)
          : span === '1h'
            ? new Date(Date.now() + 60 * 60_000)
            : span === 'minutes'
              ? new Date(Date.now() + int(body.minutes, 'minutes', 5, 7 * 24 * 60) * 60_000)
              : span === 'today'
                ? await nextLocalMidnight(tx, t.id)
                : null;
      const message =
        body.message === undefined ? undefined : (optText(body.message, 'message', 200) ?? null);
      await tx`
        update store_settings set status_override = 'paused', resumes_at = ${until},
          pause_message = ${message === undefined ? tx`pause_message` : message}
        where tenant_id = ${t.id}
      `;
      await audit(tx, t.id, m, {
        action: 'store.pause',
        entity: 'store',
        summary: until ? `pausou a loja até ${until.toISOString()}` : 'pausou a loja até retomar',
        after: { until, message },
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/store/resume',
    write('attendant', async (tx, t, m) => {
      assertNoBillingHold(await loadSettings(tx, t.id));
      await tx`update store_settings set status_override = null, resumes_at = null where tenant_id = ${t.id}`;
      await audit(tx, t.id, m, {
        action: 'store.resume',
        entity: 'store',
        summary: 'voltou a aceitar pedidos',
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  // ── delivery zones ───────────────────────────────────────────────────────

  admin.post(
    '/zones',
    write('manager', async (tx, t, m, c) => {
      const f = zoneFields(await bodyJson(c), false);
      const row = (
        await tx<{ id: string }[]>`
          insert into delivery_zones ${tx(zoneColumns(tx, { tenant_id: t.id, ...f }) as never)}
          returning id
        `
      )[0]!;
      await audit(tx, t.id, m, {
        action: 'zone.create',
        entity: 'zone',
        entityId: row.id,
        summary: `criou a área "${f.name}"`,
        after: f,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 201, body: { zones: await zonesOf(tx, t.id) } };
    }),
  );

  admin.patch(
    '/zones/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const f = zoneFields(await bodyJson(c), true);
      if (!Object.keys(f).length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const row = (
        await tx`update delivery_zones set ${tx(zoneColumns(tx, f) as never)} where tenant_id = ${t.id} and id = ${id} returning name`.catch(
          polygonMismatch,
        )
      )[0];
      if (!row) throw new HttpError(404, 'ZONE_NOT_FOUND', 'zone not found');
      await audit(tx, t.id, m, {
        action: 'zone.update',
        entity: 'zone',
        entityId: id,
        summary: `alterou a área "${row.name}"`,
        after: f,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: { zones: await zonesOf(tx, t.id) } };
    }),
  );

  admin.delete(
    '/zones/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx`delete from delivery_zones where tenant_id = ${t.id} and id = ${id} returning name`
      )[0];
      if (!row) throw new HttpError(404, 'ZONE_NOT_FOUND', 'zone not found');
      await audit(tx, t.id, m, {
        action: 'zone.delete',
        entity: 'zone',
        entityId: id,
        summary: `apagou a área "${row.name}"`,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: { zones: await zonesOf(tx, t.id) } };
    }),
  );
}
