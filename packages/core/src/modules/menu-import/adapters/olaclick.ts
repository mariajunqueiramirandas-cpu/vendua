// OlaClick: a host lookup names the company, then its menu, profile, store settings and payment
// methods (docs/menu-import.md Appendix A, checked 2026-10-01). Reais as numbers.

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
import { colour, eta, hhmm, numOf, positiveCents, reais, sizeGroup, windowsOf } from './shared.ts';
import { flag, isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'api.olaclick.app';

// the platform's own subdomains, not a store
const RESERVED = new Set([
  'www',
  'app',
  'api',
  'admin',
  'panel',
  'painel',
  'blog',
  'help',
  'ajuda',
]);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The variants the storefront offers: one, or those with a name or a list price. */
function variants(p: Raw): Raw[] {
  const all = list(p.product_variants);
  if (all.length <= 1) return all;
  const named = all.filter((v) => str(v.name).trim() || (numOf(v.original_price) ?? 0) > 0);
  return named.length ? named : all.slice(0, 1);
}

/** What the storefront charges for a variant: `price`, else `original_price`. */
const variantPrice = (v: Raw) =>
  toCents(typeof v.price === 'number' ? v.price : (v.original_price ?? 0));

/**
 * A modifier list: `one` (pick one) or `many`; its minimum counts only when `required`, its
 * `max_modifiers` caps the units picked and each option's `max_limit` its own quantity. The
 * storefront adds every pick's price × quantity: a plain sum.
 */
function optionGroup(g: Raw): ImportOptionGroup | 'empty' | null {
  const name = str(g.name).trim();
  if (!name || !Array.isArray(g.modifiers)) return null;
  const min = flag(g.required) ? Math.max(0, Math.trunc(numOf(g.min_modifiers) ?? 0)) : 0;
  const rawMax = Math.trunc(numOf(g.max_modifiers) ?? 0);
  const max = str(g.type) === 'one' ? 1 : rawMax > 0 ? rawMax : 1000;
  const options: ImportOptionGroup['options'] = [];
  for (const m of [...list(g.modifiers)].sort(
    (a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0),
  )) {
    if (m.visible !== undefined && !flag(m.visible)) continue;
    const oname = str(m.name).trim();
    const cents = toCents(m.price ?? 0);
    if (!oname || cents === null) return null;
    const opt: ImportOptionGroup['options'][number] = { name: oname, priceDeltaCents: cents };
    const q = Math.trunc(numOf(m.max_limit) ?? 1);
    if (max > 1 && q > 1) opt.maxQty = Math.min(q, max);
    options.push(opt);
  }
  if (!options.length) return min > 0 ? null : 'empty';
  return { name, min, max, options };
}

function product(p: Raw, featured: Set<string>, lost: Lost[]): ImportProduct | null {
  if (p.visible !== undefined && !flag(p.visible)) return null;
  const name = str(p.name).trim();
  const vs = variants(p);
  const out: ImportProduct = {
    ref: str(p.id),
    name,
    description: str(p.description),
    priceCents: -1,
    tags: featured.has(str(p.id)) ? ['Destaque'] : [],
    images: [...list(p.images)]
      .sort((a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0))
      .map((i) => str(i.image_url))
      .filter(Boolean),
    status: 'active',
    optionGroups: [],
  };
  const hide = (code: string, detail?: string) => {
    out.status = 'archived';
    lost.push({ scope: 'product', subject: name, code, ...(detail ? { detail } : {}) });
  };
  const stockOn = flag(p.stock_enabled);
  const prices = vs.map(variantPrice);
  // validateDoc hides an unusable price; a price that isn't a number isn't read past
  if (!vs.length || prices.some((c) => c === null)) return out;
  if (vs.some((v) => v.price !== null && v.price !== undefined && typeof v.price !== 'number'))
    hide('price_unreadable');
  // a packaging charge per item is added to the order there; there's none here
  if (vs.some((v) => (numOf(v.packaging_price) ?? 0) > 0)) hide('packaging_fee');
  const list0 = (v: Raw) => toCents(v.original_price ?? 0) ?? 0;
  if (vs.length === 1) {
    const v = vs[0]!;
    out.priceCents = prices[0]!;
    if (list0(v) > out.priceCents) out.compareAtPriceCents = list0(v);
    if (stockOn) out.stockQuantity = Math.max(0, Math.trunc(numOf(v.stock) ?? 0));
  } else {
    const sizes = vs.map((v, i) => ({
      name: str(v.name).trim() || `Opção ${i + 1}`,
      cents: prices[i]!,
      soldOut: stockOn && (numOf(v.stock) ?? 0) <= 0,
    }));
    const g = sizeGroup(sizes)!;
    out.priceCents = g.baseCents;
    out.optionGroups.push(g.group);
    // a struck-through price only when every size is discounted: the cheapest one's
    const cheapest = vs[prices.indexOf(g.baseCents)]!;
    if (vs.every((v, i) => list0(v) > prices[i]!)) out.compareAtPriceCents = list0(cheapest);
    if (sizes.every((s) => s.soldOut) && out.status !== 'archived') out.status = 'sold_out';
  }

  for (const g of [...list(p.modifier_categories)].sort(
    (a, b) =>
      (numOf(a.product_modifier_category_position) ?? numOf(a.position) ?? 0) -
      (numOf(b.product_modifier_category_position) ?? numOf(b.position) ?? 0),
  )) {
    if (g.is_active !== undefined && !flag(g.is_active)) continue;
    const r = optionGroup(g);
    if (r === 'empty') continue;
    if (!r) {
      hide('options_unreadable', str(g.name) || undefined);
      continue;
    }
    out.optionGroups.push(r);
  }
  return out;
}

/**
 * `delivery.prices.type` is the live mode (stores keep the others configured): FIXED (one fee;
 * a zone only when a distance limit is set), BY_DISTRICT (neighbourhoods), BY_AREA (polygons of
 * `{latitude, longitude}`), BY_RANGE (distance bands, `min`/`max` in metres) and
 * BY_DRIVE_DISTANCE (`starting_price` + `price_per_km` up to `max_distance_km`). Free above
 * `minimum_amount_for_free` (subtotal ≥ it there, as here).
 */
function zones(delivery: Raw, lost: Lost[]): ImportZone[] | undefined {
  const prices = isRaw(delivery.prices) ? delivery.prices : {};
  const type = str(prices.type);
  const free = positiveCents(delivery.minimum_amount_for_free);
  // the minimum is for delivery only there; here the store's would bind pickup too
  const min = positiveCents(delivery.minimum_amount_to_allow);
  const t = eta(delivery.average_time);
  const extra = (fee: number) => ({
    ...t,
    ...(min !== null ? { minOrderCents: min } : {}),
    ...(free !== null && fee > 0 ? { freeDeliveryOverCents: free } : {}),
  });
  const distance = isRaw(prices.distance) ? prices.distance : {};
  const limitKm = numOf(distance.max_distance_km) ?? 0;
  const bad = () => {
    lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
    return undefined;
  };

  if (type === 'FIXED') {
    // one fee for any address (the distance limit belongs to the per-km mode)
    const fee = toCents((isRaw(prices.fixed) ? prices.fixed.price : 0) ?? 0);
    if (fee === null) return bad();
    lost.push({
      scope: 'store',
      code: 'delivery_flat_fee',
      detail: fee === 0 ? 'grátis' : reais(fee),
    });
    return undefined;
  }
  if (type === 'BY_DISTRICT') {
    const byFee = new Map<number, string[]>();
    for (const d of list(prices.districts)) {
      if (d.enabled !== undefined && !flag(d.enabled)) continue;
      const fee = toCents(d.price ?? 0);
      const name = str(d.name).trim();
      if (fee === null || !name) return bad();
      byFee.set(fee, [...(byFee.get(fee) ?? []), name]);
    }
    const out = [...byFee.entries()]
      .sort(([a], [b]) => a - b)
      .map(([fee, names]) => ({
        name: fee === 0 ? 'Entrega grátis' : `Taxa ${reais(fee)}`,
        kind: 'neighborhood' as const,
        neighborhoods: names,
        feeCents: fee,
        ...extra(fee),
      }));
    return out.length ? out : undefined;
  }
  if (type === 'BY_AREA') {
    const out: ImportZone[] = [];
    if (isRaw(prices.area) && flag(prices.area.enable_out_of_area))
      lost.push({ scope: 'store', code: 'delivery_out_of_area' });
    for (const a of list(isRaw(prices.area) ? prices.area.areas : [])) {
      if (a.enabled !== undefined && !flag(a.enabled)) continue;
      const fee = toCents(a.price ?? 0);
      const ring = list(a.paths)
        .map((p) => [numOf(p.latitude), numOf(p.longitude)] as const)
        .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null)
        .map(([lat, lng]) => [lat, lng] as [number, number]);
      if (fee === null || ring.length < 3) return bad();
      out.push({
        name: str(a.name).trim() || `Área ${out.length + 1}`,
        kind: 'polygon',
        polygon: ring,
        feeCents: fee,
        ...extra(fee),
      });
    }
    return out.length ? out : undefined;
  }
  if (type === 'BY_RANGE') {
    const bands = list(prices.ranges)
      .filter((r) => r.enabled === undefined || flag(r.enabled))
      .map((r) => ({ min: numOf(r.min) ?? 0, max: numOf(r.max), fee: toCents(r.price ?? 0) }));
    if (bands.some((b) => b.max === null || !(b.max > 0) || b.fee === null)) return bad();
    bands.sort((a, b) => a.max! - b.max!);
    // a band that starts past the previous one's end leaves a ring with no delivery
    bands.forEach((b, i) => {
      const prev = i ? bands[i - 1]!.max! : 0;
      if (b.min > prev)
        lost.push({
          scope: 'store',
          code: 'delivery_gap',
          detail: String(b.min / 1000).replace('.', ','),
        });
    });
    if (bands.length) lost.push({ scope: 'store', code: 'delivery_distance_straight_line' });
    const out = bands.map((b) => ({
      name: `Até ${String(Math.round(b.max! / 10) / 100).replace('.', ',')} km`,
      kind: 'radius' as const,
      maxDistanceKm: b.max! / 1000,
      feeCents: b.fee!,
      ...extra(b.fee!),
    }));
    return out.length ? out : undefined;
  }
  if (type === 'BY_DRIVE_DISTANCE') {
    const start = toCents(distance.starting_price ?? 0);
    const perKm = toCents(distance.price_per_km ?? 0);
    if (start === null || perKm === null) return bad();
    if (!(limitKm > 0)) {
      lost.push({ scope: 'store', code: 'delivery_by_address' });
      return undefined;
    }
    // there the km are driven; here they're straight-line, counted up to the next whole km
    lost.push({ scope: 'store', code: 'delivery_distance_straight_line' });
    return [
      {
        name: `Até ${String(limitKm).replace('.', ',')} km`,
        kind: 'radius',
        maxDistanceKm: limitKm,
        feeCents: start,
        ...(perKm > 0 ? { feePerKmCents: perKm } : {}),
        ...extra(start + perKm),
      },
    ];
  }
  return type ? bad() : undefined;
}

const PAYMENT: Record<string, PaymentMethod> = {
  cash: 'cash',
  pix: 'pix',
  credit_card: 'card_on_delivery',
  debit_card: 'card_on_delivery',
  meal_voucher: 'meal_voucher',
  food_voucher: 'meal_voucher',
  voucher: 'meal_voucher',
};

function payments(raw: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  const pm = isRaw(raw.payments) ? raw.payments : {};
  let online = false;
  const seen = new Set<string>();
  for (const m of [...list(pm.delivery), ...list(pm.takeaway)]) {
    const code = str(m.code);
    if (seen.has(code)) continue;
    seen.add(code);
    if (code === 'online_payment' || str(m.provider_code)) {
      online = true;
      continue;
    }
    const method = PAYMENT[code];
    if (!method) {
      lost.push({ scope: 'store', code: 'payment_method', detail: str(m.name) || code });
      continue;
    }
    if (!methods.includes(method)) methods.push(method);
    if ((numOf(m.payment_method_fee) ?? 0) !== 0)
      lost.push({ scope: 'store', code: 'payment_adjustment', detail: str(m.name) || code });
  }
  if (online) lost.push({ scope: 'store', code: 'online_payment' });
  // the key is told to the customer after the order; it isn't in the public payload
  if (methods.includes('pix')) lost.push({ scope: 'store', code: 'pix_unreadable' });
  return { methods };
}

function hours(company: Raw) {
  const bh = isRaw(company.business_hours_settings) ? company.business_hours_settings : {};
  const ranges: { day: number; open: string; close: string }[] = [];
  WEEKDAYS.forEach((d, day) => {
    const s = isRaw(bh[d]) ? bh[d] : null;
    if (!s || (s.is_active !== undefined && !flag(s.is_active))) return;
    for (const h of list(s.hours)) {
      const open = hhmm(h.open);
      const close = hhmm(h.close);
      if (open && close) ranges.push({ day, open, close });
    }
  });
  return windowsOf(ranges);
}

const data = (v: unknown): Raw => (isRaw(v) && isRaw(v.data) ? v.data : {});

export const olaclick: Adapter = {
  platform: 'olaclick',
  hosts: { api: [API], images: ['assets.olaclick.app'] },

  match(url) {
    const host = url.hostname.toLowerCase();
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.ola\.click$/.exec(host);
    if (!m || RESERVED.has(m[1]!)) return null;
    return { ref: host };
  },

  async read(ref: string, http: ImportHttp) {
    const lookup = await http.json(
      `https://${API}/ms-companies/public/hosts/${encodeURIComponent(ref)}`,
    );
    const id = str(data(lookup).company_id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ImportFailure('NOT_FOUND', 'no company');
    const c = `https://${API}/ms-companies/public/companies/${id}`;
    const menu = await http.json(`https://${API}/ms-products/public/companies/${id}/categories`);
    const company = await http.json(c);
    const settings = await http.json(`${c}/ecommerce-settings`);
    const payments = await http.json(
      `https://${API}/ms-orders/public/companies/${id}/payment-methods`,
    );
    if (!isRaw(menu) || !Array.isArray(menu.data)) throw new ImportFailure('UNREADABLE', 'no menu');
    return {
      categories: menu.data,
      company: data(company),
      settings: data(settings),
      payments: data(payments),
    };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const company = isRaw(raw.company) ? raw.company : {};
    const settings = isRaw(raw.settings) ? raw.settings : {};
    const delivery = isRaw(settings.delivery) ? settings.delivery : {};
    const takeaway = isRaw(settings.takeaway) ? settings.takeaway : {};
    const lost: Lost[] = [];

    const cats = [...list(raw.categories)].sort(
      (a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0),
    );
    // "Destaques" repeats products from the other categories: it becomes a badge
    const featured = new Set(
      cats
        .filter((c) => str(c.type) === 'FAVORITE')
        .flatMap((c) => list(c.products).map((p) => str(p.id))),
    );
    const categories: ImportCategory[] = [];
    for (const c of cats) {
      if (str(c.type) === 'FAVORITE') continue;
      if (c.visible !== undefined && !flag(c.visible)) continue;
      const products = [...list(c.products)]
        .sort((a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0))
        .map((p) => product(p, featured, lost))
        .filter((p): p is ImportProduct => p !== null);
      categories.push({ name: str(c.name).trim(), products });
    }

    const deliveryOn = flag(delivery.active);
    const zoneList = deliveryOn ? zones(delivery, lost) : undefined;
    const min = positiveCents(delivery.minimum_amount_to_allow);
    if (deliveryOn && !zoneList && min !== null)
      lost.push({ scope: 'store', code: 'delivery_minimum', detail: reais(min) });
    const layout = isRaw(settings.layout_settings) ? settings.layout_settings : {};
    const landing = isRaw(layout.landing) ? layout.landing : {};
    const buttons = isRaw(landing.buttons_icons) ? landing.buttons_icons : {};
    const header = isRaw(landing.header) ? landing.header : {};
    const banner =
      isRaw(layout.company) && isRaw(layout.company.banner) ? layout.company.banner : {};
    const lat = numOf(company.latitude);
    const lng = numOf(company.longitude);

    return {
      v: 1,
      source,
      store: {
        name: str(company.name),
        whatsapp: str(company.whatsapp),
        address: str(company.address),
        ...(lat !== null && lng !== null ? { coords: { lat, lng } } : {}),
        logoUrl: str(company.logo_url),
        coverUrl: str(banner.url),
        ...((c) => (c ? { brandColor: c } : {}))(
          colour(buttons.button_color) ?? colour(header.color),
        ),
      },
      hours: hours(company),
      operations: {
        pickup: flag(takeaway.active),
        delivery: deliveryOn && !!zoneList?.length,
      },
      ...(zoneList ? { zones: zoneList } : {}),
      payments: payments(raw, lost),
      categories,
      lost,
    };
  },
};
