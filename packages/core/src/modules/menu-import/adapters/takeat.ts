// Takeat: the restaurant by slug, then its whole menu, its delivery hours and (when it charges by
// neighbourhood) the fee table (docs/menu-import.md Appendix A, checked 2026-10-01). Prices are
// decimal strings; the payload mixes dine-in and delivery, so only what sells for delivery comes.

import {
  toCents,
  type ImportCategory,
  type ImportOptionGroup,
  type ImportProduct,
  type ImportZone,
  type Lost,
  type MenuImportV1,
  type PaymentMethod,
  type SourceInfo,
} from '../doc.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
import {
  colour,
  intersectDays,
  liftFloor,
  methodOf,
  numOf,
  positiveCents,
  reais,
  scheduleOf,
  windowsOf,
} from './shared.ts';
import { flag, isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'backend-delivery.takeat.app';

const RESERVED = new Set(['login', 'cadastro', 'admin', 'api', 'pedido', 'pedidos', 'conta']);

// "Dom" … "Sáb", Sunday first
const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const dayOf = (v: unknown) =>
  DAY_NAMES.indexOf(str(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 3));

/** Times are UTC instants of a Brasília clock on placeholder dates: back to "HH:MM" there. */
function brt(v: unknown): string | null {
  const t = Date.parse(str(v));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - 3 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** `enable_times` + `start_time`/`end_time` + `active_days` ("tftttff", Sunday first). */
function windowsFor(o: Raw): Map<number, [string, string][]> | null {
  if (!flag(o.enable_times)) return null;
  const from = brt(o.start_time);
  const to = brt(o.end_time);
  const days = str(o.active_days);
  if (!from || !to || !/^[tf]{7}$/i.test(days)) return null;
  // 00:00→23:59 (or 00:01→00:00) is all day
  const allDay =
    from === to || (from <= '00:01' && to >= '23:59') || (from === '00:01' && to === '00:00');
  const out = new Map<number, [string, string][]>();
  [...days.toLowerCase()].forEach((c, d) => {
    out.set(d, c === 't' ? [allDay ? ['00:00', '23:59'] : [from, to]] : []);
  });
  return out;
}

const sells = (o: Raw) => o.available_in_delivery === undefined || flag(o.available_in_delivery);

/**
 * A complement list (`complement_categories[]`): the customer sees `question`; options only when
 * sold for delivery. `optional` lists have no minimum (one marked optional with a minimum is
 * "none or at least N": a rule we keep as no minimum, with a note); `limit` caps the units and an
 * option's own `limit` its quantity. Prices count only when `additional`: the dearest once
 * (`more_expensive_only`) or a sum. The storefront's average (`use_average`) isn't repeated.
 */
function optionGroup(
  g: Raw,
): { group: ImportOptionGroup; exact: boolean; relaxed: boolean } | 'empty' | null {
  if (!sells(g)) return 'empty';
  const name = str(g.question).trim() || str(g.name).trim();
  if (!name || !Array.isArray(g.complements)) return null;
  const optional = flag(g.optional);
  const minimum = Math.trunc(numOf(g.minimum) ?? 1);
  const min = optional ? 0 : Math.max(0, minimum);
  const rawMax = Math.trunc(numOf(g.limit) ?? 0);
  const max = rawMax > 0 ? rawMax : 1000;
  const paid = flag(g.additional);
  const options: ImportOptionGroup['options'] = [];
  for (const o of list(g.complements)) {
    if (!sells(o)) continue;
    const oname = str(o.name).trim();
    const cents = paid ? toCents(o.delivery_price ?? o.price ?? 0) : 0;
    if (!oname || cents === null) return null;
    const opt: ImportOptionGroup['options'][number] = { name: oname, priceDeltaCents: cents };
    const q = Math.trunc(numOf(o.limit) ?? 1);
    if (max > 1 && q > 1) opt.maxQty = Math.min(q, max);
    const d = str(o.description).trim();
    if (d) opt.description = d;
    const img = isRaw(o.image) ? str(o.image.url) : '';
    if (img) opt.imageUrl = img;
    options.push(opt);
  }
  if (!options.length) return min > 0 ? null : 'empty';
  const dearest = paid && flag(g.more_expensive_only) && max > 1;
  return {
    group: {
      name,
      min,
      max,
      ...(dearest ? { pricingRule: 'most_expensive' as const } : {}),
      options,
    },
    // the storefront adds the average once per line, not per unit: never repeated here
    exact: !(paid && !flag(g.more_expensive_only) && flag(g.use_average)),
    relaxed: optional && minimum > 1,
  };
}

/** The storefront's price: the first set of delivery promo, delivery, promo, regular. */
function prices(p: Raw): { price: number | null; compareAt?: number } {
  const set = (v: unknown) => v !== null && v !== undefined && str(v) !== '';
  const regular = set(p.delivery_price) ? p.delivery_price : p.price;
  const promo = set(p.delivery_price_promotion)
    ? p.delivery_price_promotion
    : set(p.delivery_price)
      ? null
      : set(p.price_promotion)
        ? p.price_promotion
        : null;
  if (!set(regular)) return { price: flag(p.has_starting_price) ? 0 : null };
  const r = toCents(regular);
  if (promo === null) return { price: r };
  const c = toCents(promo);
  return c !== null && r !== null && c < r ? { price: c, compareAt: r } : { price: c };
}

function product(
  p: Raw,
  cat: Map<number, [string, string][]> | null,
  tags: Map<string, string>,
  lost: Lost[],
): ImportProduct | null {
  const name = str(p.name).trim();
  if (!sells(p)) {
    lost.push({ scope: 'product', subject: name, code: 'dine_in_only' });
    return null;
  }
  const { price, compareAt } = prices(p);
  const out: ImportProduct = {
    ref: str(p.id),
    name,
    description: str(p.description),
    priceCents: price ?? -1,
    ...(compareAt ? { compareAtPriceCents: compareAt } : {}),
    tags: [],
    images: [isRaw(p.image) ? str(p.image.url) : ''].filter(Boolean),
    status: flag(p.sold_off) ? 'sold_out' : 'active',
    optionGroups: [],
  };
  const hide = (code: string, detail?: string) => {
    out.status = 'archived';
    lost.push({ scope: 'product', subject: name, code, ...(detail ? { detail } : {}) });
  };
  if (flag(p.use_weight)) hide('sold_by_weight');
  // a delivery price of 0 under a priced item is a leftover there: the storefront would sell it free
  if (price === 0 && (toCents(p.price ?? 0) ?? 0) > 0 && !flag(p.has_starting_price))
    hide('price_unreadable');
  const tag = tags.get(str(p.delivery_tag_id));
  if (tag) out.tags.push(tag);

  const days = intersectDays(cat, windowsFor(p));
  const sched = days ? scheduleOf(days) : undefined;
  if (sched === 'never') {
    lost.push({ scope: 'product', subject: name, code: 'never_available' });
    return null;
  }
  if (sched) out.availability = sched;

  const groups = [...list(p.complement_categories)].sort(
    (a, b) =>
      (numOf(isRaw(a.ProductComplement) ? a.ProductComplement.custom_order : null) ?? 0) -
      (numOf(isRaw(b.ProductComplement) ? b.ProductComplement.custom_order : null) ?? 0),
  );
  for (const g of groups) {
    const r = optionGroup(g);
    if (r === 'empty') continue;
    if (!r) {
      hide('options_unreadable', str(g.question).trim() || str(g.name) || undefined);
      continue;
    }
    if (!r.exact) hide('pizza_pricing', r.group.name);
    if (r.relaxed)
      lost.push({ scope: 'product', subject: name, code: 'option_minimum', detail: r.group.name });
    out.optionGroups.push(r.group);
  }
  liftFloor(out);
  return out;
}

const METHOD: Record<string, PaymentMethod> = {
  CASH: 'cash',
  PIX: 'pix',
  CREDIT: 'card_on_delivery',
  DEBIT: 'card_on_delivery',
  VOUCHER: 'meal_voucher',
};

function payments(store: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  let online = false;
  for (const m of list(store.payment_methods)) {
    const rm = list(m.restaurant_method)[0];
    if (
      !rm ||
      !flag(rm.available) ||
      (rm.delivery_accepts !== undefined && !flag(rm.delivery_accepts))
    )
      continue;
    const keyword = str(m.keyword);
    if (keyword === 'pix_auto' || keyword.startsWith('online')) {
      online = true;
      continue;
    }
    if (keyword === 'clube') {
      lost.push({ scope: 'store', code: 'cashback' });
      continue;
    }
    // custom entries ("others") carry only the merchant's label
    const method = METHOD[str(m.method).toUpperCase()] ?? methodOf(str(m.name));
    if (!method) {
      lost.push({ scope: 'store', code: 'payment_method', detail: str(m.name) || keyword });
      continue;
    }
    if (!methods.includes(method)) methods.push(method);
  }
  if (online) lost.push({ scope: 'store', code: 'online_payment' });
  if (methods.includes('pix')) lost.push({ scope: 'store', code: 'pix_unreadable' });
  return { methods };
}

/** The neighbourhood table (`countries → states → cities → neighborhoods`), one zone per fee. */
function neighbourhoodZones(
  table: unknown,
  extra: { etaMin?: number; etaMax?: number; minOrderCents?: number },
  lost: Lost[],
): ImportZone[] {
  const byFee = new Map<number, string[]>();
  const t = isRaw(table) ? table : {};
  for (const country of list(t.countries))
    for (const state of list(country.states))
      for (const city of list(state.cities))
        for (const n of list(city.neighborhoods)) {
          const fee = toCents(n.delivery_tax_price ?? 0);
          const name = str(n.name).trim();
          if (fee !== null && name) byFee.set(fee, [...(byFee.get(fee) ?? []), name]);
          else
            lost.push({ scope: 'store', code: 'zone_dropped', ...(name ? { detail: name } : {}) });
        }
  return [...byFee.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fee, names]) => ({
      name: fee === 0 ? 'Entrega grátis' : `Taxa ${reais(fee)}`,
      kind: 'neighborhood' as const,
      neighborhoods: names,
      feeCents: fee,
      ...extra,
    }));
}

function hours(schedule: unknown) {
  const ranges: { day: number; open: string; close: string }[] = [];
  for (const r of list(schedule)) {
    const day = dayOf(r.day);
    if (day < 0 || !flag(r.is_active)) continue;
    const shift = (o: unknown, c: unknown, on: boolean) => {
      const open = brt(o);
      const close = brt(c);
      if (on && open && close) ranges.push({ day, open, close });
    };
    shift(r.open_time, r.close_time, flag(r.delivery_active) || flag(r.withdrawal_active));
    if (flag(r.is_two_shifts))
      shift(r.open_time_2, r.close_time_2, flag(r.delivery_active2) || flag(r.withdrawal_active2));
  }
  return windowsOf(ranges);
}

export const takeat: Adapter = {
  platform: 'takeat',
  hosts: { api: [API], images: ['takeat-imgs.takeat.app'] },

  match(url) {
    if (url.hostname.toLowerCase() !== 'pedido.takeat.app') return null;
    const slug = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (!slug || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug) || RESERVED.has(slug)) return null;
    return { ref: slug };
  },

  async read(ref: string, http: ImportHttp) {
    const base = `https://${API}/public`;
    const store = await http.json(`${base}/restaurant/${encodeURIComponent(ref)}`);
    const id = isRaw(store) ? numOf(store.id) : null;
    if (!isRaw(store) || id === null) throw new ImportFailure('NOT_FOUND', 'no restaurant');
    const brand = isRaw(store.brand) ? numOf(store.brand.id) : null;
    const menu = await http.json(
      `${base}/restaurants/menu/${id}?gd=true${brand !== null ? `&brand_id=${brand}` : ''}`,
    );
    if (!Array.isArray(menu)) throw new ImportFailure('UNREADABLE', 'no menu');
    const schedule = await http.json(`${base}/restaurants/delivery-schedules/${id}`);
    const info = isRaw(store.delivery_info) ? store.delivery_info : {};
    const fees = flag(info.allow_delivery_addresses)
      ? await http.json(`${base}/restaurants/delivery-addresses/${id}`)
      : null;
    return { store, menu, schedule, fees };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const store = isRaw(raw.store) ? raw.store : {};
    const info = isRaw(store.delivery_info) ? store.delivery_info : {};
    const lost: Lost[] = [];

    const tags = new Map(
      list(info.delivery_product_tags).map((t) => [str(t.id), str(t.name).trim()] as const),
    );
    const categories: ImportCategory[] = [];
    for (const c of [...list(raw.menu)].sort(
      (a, b) => (numOf(a.custom_order) ?? 0) - (numOf(b.custom_order) ?? 0),
    )) {
      // staff meals and till helpers: never shown to a customer there
      if (flag(c.is_exclusive)) continue;
      const name = str(c.name).trim();
      // a category not sold for delivery takes its items with it at checkout
      if (!sells(c)) {
        const n = list(c.products).length;
        if (n)
          lost.push({ scope: 'category', subject: name, code: 'dine_in_only', detail: String(n) });
        continue;
      }
      const times = windowsFor(c);
      const products = [...list(c.products)]
        .sort((a, b) => (numOf(a.custom_order) ?? 0) - (numOf(b.custom_order) ?? 0))
        .map((p) => product(p, times, tags, lost))
        .filter((p): p is ImportProduct => p !== null);
      if (isRaw(c.image) && str(c.image.url))
        lost.push({ scope: 'category', subject: name, code: 'category_image' });
      categories.push({ name, products });
    }

    const eta = ((m) => (m !== null && m > 0 ? { etaMin: m, etaMax: m } : {}))(
      numOf(info.time_to_delivery),
    );
    // separate minimums there; here the store's binds both and a zone's adds to it on delivery
    const pickup = flag(info.is_withdrawal_allowed);
    const deliveryMin = positiveCents(info.delivery_minimum_price) ?? 0;
    // with no pickup the store minimum binds delivery alone
    const pickupMin = pickup ? (positiveCents(info.withdrawal_minimum_price) ?? 0) : deliveryMin;
    let zones: ImportZone[] | undefined;
    if (flag(info.is_delivery_allowed)) {
      if (flag(info.allow_delivery_addresses)) {
        zones = neighbourhoodZones(
          raw.fees,
          { ...eta, ...(deliveryMin > pickupMin ? { minOrderCents: deliveryMin } : {}) },
          lost,
        );
        if (!zones.length) zones = undefined;
      }
      if (!zones) lost.push({ scope: 'store', code: 'delivery_by_address' });
      // a lower delivery minimum than pickup's, or one with no zone to carry it
      if (deliveryMin < pickupMin || (!zones && deliveryMin > pickupMin))
        lost.push({ scope: 'store', code: 'delivery_minimum', detail: reais(deliveryMin) });
    }
    if (flag(store.is_order_scheduling_active)) lost.push({ scope: 'store', code: 'time_slots' });
    if (flag(store.only_qrcode)) lost.push({ scope: 'store', code: 'dine_in' });

    const a = isRaw(store.adress) ? store.adress : {};
    const lat = numOf(a.latitude);
    const lng = numOf(a.longitude);
    const greeting = str(store.greeting_message)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const logo = isRaw(store.avatar) ? str(store.avatar.url) : '';
    const brandFile =
      isRaw(store.brand) && isRaw(store.brand.file) ? str(store.brand.file.url) : '';
    const prep = numOf(zones ? info.time_to_delivery : info.time_to_withdrawal);

    return {
      v: 1,
      source,
      store: {
        name: str(store.fantasy_name) || str(store.name),
        ...(greeting.length
          ? { announcement: { title: greeting[0]!, body: greeting.slice(1).join(' ') } }
          : {}),
        whatsapp: str(store.phone),
        instagram: str(store.instagram),
        address: [
          [str(a.street).trim(), str(a.number).trim()].filter(Boolean).join(', '),
          str(a.complement).trim(),
          str(a.neighborhood).trim(),
        ]
          .filter(Boolean)
          .join(' - '),
        city: str(a.city),
        ...(lat !== null && lng !== null ? { coords: { lat, lng } } : {}),
        logoUrl: logo || brandFile,
        coverUrl: isRaw(info.cover) ? str(info.cover.url) : '',
        ...((c) => (c ? { brandColor: c } : {}))(colour(info.primary_color)),
      },
      hours: hours(raw.schedule),
      operations: {
        ...(pickupMin > 0 ? { minOrderCents: pickupMin } : {}),
        ...(prep && prep > 0 ? { prepTimeMinutes: Math.round(prep) } : {}),
        pickup,
        delivery: !!zones?.length,
      },
      ...(zones ? { zones } : {}),
      payments: payments(store, lost),
      categories,
      lost,
    };
  },
};
