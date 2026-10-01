// Delivery Direto: the brand's units, then the store's categories, one request per category, the
// pizza module when the store uses it, fees and payment forms (docs/menu-import.md Appendix A,
// checked 2026-10-01). Every path hangs off the store link itself. Reais as numbers.

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
import { pointInPolygon } from '../../geo.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
import {
  averageExact,
  colour,
  hhmm,
  intersectDays,
  liftFloor,
  methodOf,
  numOf,
  pool,
  positiveCents,
  reais,
  scheduleOf,
  windowsOf,
} from './shared.ts';
import { flag, isRaw, list, str, type Adapter, type Raw } from './types.ts';

const HOST = 'deliverydireto.com.br';

// first path segments that are the platform's own pages and assets
const RESERVED = new Set([
  'ss',
  'bs',
  'ws',
  'api',
  'admin',
  'blog',
  'login',
  'cadastro',
  'termos',
  'privacidade',
  'ajuda',
  'planos',
  'precos',
  'contato',
  'sobre',
  'static',
  'img',
]);
// second segments under a brand that aren't a unit
const NOT_A_UNIT = new Set(['pages', 'categories', 'item', 'items', 'stores', 'basic_info']);

const SLUG = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

/** `items_availability`/`categoryavailabilities`: weekday 1 = Sunday; start = end is all day. */
function availability(v: unknown): Map<number, [string, string][]> | null {
  const rows = list(v);
  if (!rows.length) return null;
  const out = new Map<number, [string, string][]>();
  for (let d = 0; d < 7; d++) out.set(d, []);
  for (const r of rows) {
    const d = (numOf(r.weekday) ?? 0) - 1;
    const a = hhmm(r.period_start);
    const b = hhmm(r.period_end);
    if (d < 0 || d > 6 || !a || !b) continue;
    out.get(d)!.push(a === b ? ['00:00', '23:59'] : [a, b]);
  }
  return out;
}

/**
 * A property: RADIO (one), CHECKBOX (several distinct) or MULTIPLE (a quantity per option, the
 * option's `max_choices`), between `combo_min_choices` and `combo_max_choices`. Priced SUM,
 * HIGHER (the dearest), AVERAGE (exact here only when no half cent can occur) or SMALLER
 * (the cheapest, no rule here).
 */
function optionGroup(g: Raw): { group: ImportOptionGroup; exact: boolean } | 'empty' | null {
  if (flag(g.is_hidden)) return 'empty';
  const name = str(g.name).trim();
  if (!name || !Array.isArray(g.options)) return null;
  const kind = str(g.choice_type).toUpperCase();
  const min = Math.max(0, Math.trunc(numOf(g.combo_min_choices) ?? 0));
  const rawMax = Math.trunc(numOf(g.combo_max_choices) ?? 0);
  const max = kind === 'RADIO' ? 1 : rawMax > 0 ? rawMax : 1000;
  const options: ImportOptionGroup['options'] = [];
  for (const o of [...list(g.options)].sort(
    (a, b) => (numOf(a.view_order) ?? 0) - (numOf(b.view_order) ?? 0),
  )) {
    const status = str(o.status).toUpperCase();
    if (flag(o.is_hidden) || status === 'HIDDEN') continue;
    const oname = str(o.name).trim();
    const cents = toCents(o.price ?? 0);
    if (!oname || cents === null) return null;
    const opt: ImportOptionGroup['options'][number] = { name: oname, priceDeltaCents: cents };
    const q = Math.trunc(numOf(o.max_choices) ?? 1);
    if (kind === 'MULTIPLE' && max > 1 && q > 1) opt.maxQty = Math.min(q, max);
    const d = str(o.description).trim();
    if (d) opt.description = d;
    const img = str(o.cover_photo);
    if (img) opt.imageUrl = img;
    if (status === 'SHORT_SUPPLY' || o.is_active === false) opt.soldOut = true;
    options.push(opt);
  }
  if (!options.length) return min > 0 ? null : 'empty';
  return ruled(name, min, max, str(g.price_calculation_type).toUpperCase(), options);
}

function ruled(
  name: string,
  min: number,
  max: number,
  calc: string,
  options: ImportOptionGroup['options'],
): { group: ImportOptionGroup; exact: boolean } {
  const group: ImportOptionGroup = { name, min, max, options };
  if (max > 1 && calc === 'HIGHER') group.pricingRule = 'most_expensive';
  if (max > 1 && calc === 'AVERAGE') group.pricingRule = 'average';
  const exact =
    max === 1 ||
    calc === 'SUM' ||
    calc === '' ||
    calc === 'HIGHER' ||
    (calc === 'AVERAGE' && averageExact(group));
  return { group, exact };
}

function product(
  item: Raw,
  cat: Map<number, [string, string][]> | null,
  lost: Lost[],
  lift = true,
): ImportProduct | null {
  const name = str(item.name).trim();
  const status = str(item.status).toUpperCase();
  if (status === 'HIDDEN' || flag(item.is_hidden)) return null;
  const tags = list(item.filters)
    .filter((f) => str(f.type) === 'ORDER_TYPE')
    .map((f) => str(f.tag));
  if (tags.length && !tags.includes('delivery') && !tags.includes('takeout')) {
    lost.push({ scope: 'product', subject: name, code: 'dine_in_only' });
    return null;
  }
  const days = intersectDays(cat, availability(item.items_availability));
  const sched = days ? scheduleOf(days) : undefined;
  if (sched === 'never') {
    lost.push({ scope: 'product', subject: name, code: 'never_available' });
    return null;
  }
  const out: ImportProduct = {
    ref: str(item.id),
    name,
    description: str(item.description),
    priceCents: toCents(item.numeric_price ?? item.base_price ?? 0) ?? -1,
    tags: [
      ...list(item.badges).map((b) => str(b.name).trim()),
      ...(flag(item.is_new) ? ['Novidade'] : []),
    ].filter(Boolean),
    images: [str(item.cover_photo)].filter(Boolean),
    // SHORT_SUPPLY is paused; UNAVAILABLE is only "outside its hours right now"
    status: status === 'SHORT_SUPPLY' ? 'sold_out' : 'active',
    optionGroups: [],
  };
  if (sched) out.availability = sched;
  if (tags.length && !tags.includes('delivery'))
    lost.push({ scope: 'product', subject: name, code: 'pickup_only' });
  if (flag(item.is_fractional) || /^(kg|g)$/i.test(str(item.unit_type))) {
    out.status = 'archived';
    lost.push({ scope: 'product', subject: name, code: 'sold_by_weight' });
  }
  addGroups(out, item.properties, lost);
  if (lift) liftFloor(out);
  return out;
}

function addGroups(p: ImportProduct, props: unknown, lost: Lost[]) {
  for (const g of [...list(props)].sort(
    (a, b) => (numOf(a.view_order) ?? 0) - (numOf(b.view_order) ?? 0),
  )) {
    const r = optionGroup(g);
    if (r === 'empty') continue;
    const hide = (code: string, detail?: string) => {
      p.status = 'archived';
      lost.push({ scope: 'product', subject: p.name, code, ...(detail ? { detail } : {}) });
    };
    if (!r) {
      hide('options_unreadable', str(g.name) || undefined);
      continue;
    }
    if (!r.exact) hide('pizza_pricing', r.group.name);
    p.optionGroups.push(r.group);
  }
}

/**
 * The pizza module: each size is a product (`pizzasetting`: `maximum_flavors` and its price
 * rule), its flavours priced per size by `get_pizza_flavors?size=`; the size's own properties
 * (crusts) and `get_pizza_additionals` are its other lists.
 */
function pizzaModule(
  module: Raw,
  cat: Map<number, [string, string][]> | null,
  lost: Lost[],
): ImportProduct[] {
  const out: ImportProduct[] = [];
  for (const size of list(module.sizes)) {
    // the floor lifts once, after the flavours join the size's own lists
    const p = product(size, cat, lost, false);
    if (!p) continue;
    const setting = isRaw(size.pizzasetting) ? size.pizzasetting : {};
    const flavours = list(isRaw(module.flavors) ? module.flavors[str(size.id)] : null);
    const max = Math.max(1, Math.trunc(numOf(setting.maximum_flavors) ?? 1));
    const options: ImportOptionGroup['options'] = [];
    let readable = true;
    for (const f of flavours) {
      const status = str(f.status).toUpperCase();
      if (status === 'HIDDEN' || flag(f.is_hidden)) continue;
      const cents = toCents(f.base_price ?? 0);
      if (cents === null || !str(f.name).trim()) readable = false;
      options.push({
        name: str(f.name).trim(),
        priceDeltaCents: cents ?? 0,
        ...(str(f.description).trim() ? { description: str(f.description).trim() } : {}),
        ...(status === 'SHORT_SUPPLY' ? { soldOut: true } : {}),
      });
    }
    if (!readable || !options.length) {
      p.status = 'archived';
      lost.push({
        scope: 'product',
        subject: p.name,
        code: 'options_unreadable',
        detail: 'Sabores',
      });
    } else {
      const r = ruled(
        max > 1 ? `Escolha até ${max} sabores` : 'Sabor',
        1,
        max,
        str(setting.price_calculation_type || 'AVERAGE').toUpperCase(),
        options,
      );
      if (!r.exact) {
        p.status = 'archived';
        lost.push({
          scope: 'product',
          subject: p.name,
          code: 'pizza_pricing',
          detail: r.group.name,
        });
      }
      p.optionGroups.unshift(r.group);
    }
    const extra = isRaw(module.additionals) ? module.additionals[str(size.id)] : null;
    addGroups(p, isRaw(extra) ? extra.properties : null, lost);
    liftFloor(p);
    out.push(p);
  }
  return out;
}

/** "lng,lat|lng,lat|…", closed and padded with repeats → a [lat, lng] ring. */
function ring(v: unknown): [number, number][] {
  const pts: [number, number][] = [];
  for (const pair of str(v).split('|')) {
    const [lng, lat] = pair.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const last = pts[pts.length - 1];
    if (last && last[0] === lat && last[1] === lng) continue;
    pts.push([lat!, lng!]);
  }
  if (pts.length > 3 && pts[0]![0] === pts.at(-1)![0] && pts[0]![1] === pts.at(-1)![1]) pts.pop();
  return pts;
}

/**
 * A circle as a 48-sided polygon around it (Venduá's discs centre on the store, these needn't):
 * drawn just outside, so no address the old store took is refused.
 */
function circle(lat: number, lng: number, metres: number): [number, number][] {
  const n = 48;
  // edges touch the circle at cos(π/n); 1% + 10 m more covers flat lat/lng and the rounding
  const r = (metres / Math.cos(Math.PI / n)) * 1.01 + 10;
  const perDeg = (6_371_000 * Math.PI) / 180; // geo.ts's haversine Earth
  const dLat = r / perDeg;
  const dLng = r / (perDeg * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [
      Math.round((lat + dLat * Math.sin(a)) * 1e6) / 1e6,
      Math.round((lng + dLng * Math.cos(a)) * 1e6) / 1e6,
    ] as [number, number];
  });
}

/** Whether any two areas share ground (a corner inside another catches it but for crosses). */
function overlap(zs: ImportZone[]): boolean {
  const rings = zs.map((z) => z.polygon ?? []);
  return rings.some((a, i) =>
    rings.some((b, j) => j !== i && a.some(([lat, lng]) => pointInPolygon({ lat, lng }, b))),
  );
}

function zones(
  fees: Raw,
  extra: { minOrderCents?: number; freeDeliveryOverCents?: number },
  lost: Lost[],
): ImportZone[] | undefined {
  const out: ImportZone[] = [];
  for (const f of list(fees.fees)) {
    if (f.active !== undefined && !flag(f.active)) continue;
    // a share of the order on top of the fee: Venduá's fees are fixed
    if (
      (str(f.price_type) && str(f.price_type).toUpperCase() !== 'FIXED') ||
      (numOf(f.price_percent) ?? 0) > 0
    ) {
      lost.push({ scope: 'store', code: 'delivery_fees_unreadable', detail: str(f.name) });
      continue;
    }
    const fee = toCents(f.price ?? 0);
    if (fee === null) {
      lost.push({ scope: 'store', code: 'delivery_fees_unreadable', detail: str(f.name) });
      continue;
    }
    // this area's own free-delivery rule: never seen set, so not guessed at
    const free = positiveCents(f.free_delivery_minimum_order);
    if (free) lost.push({ scope: 'store', code: 'free_delivery_rule', detail: reais(free) });
    const lo = numOf(f.min_waiting_time);
    const hi = numOf(f.max_waiting_time);
    const base = {
      feeCents: fee,
      ...(lo !== null && lo > 0 ? { etaMin: lo } : {}),
      ...(hi !== null && hi > 0 ? { etaMax: hi } : {}),
      ...(extra.minOrderCents ? { minOrderCents: extra.minOrderCents } : {}),
      ...(extra.freeDeliveryOverCents && fee > 0
        ? { freeDeliveryOverCents: extra.freeDeliveryOverCents }
        : {}),
    };
    const type = str(f.type).toUpperCase();
    if (type === 'POLYGON') {
      const r = ring(f.polygon);
      if (r.length < 3) {
        lost.push({ scope: 'store', code: 'zone_dropped', detail: str(f.name) });
        continue;
      }
      out.push({
        name: str(f.name).trim() || `Área ${out.length + 1}`,
        kind: 'polygon',
        polygon: r,
        ...base,
      });
    } else if (type === 'CIRCLE') {
      const lat = numOf(f.center_lat);
      const lng = numOf(f.center_lng);
      const radius = numOf(f.radius);
      if (lat === null || lng === null || radius === null || !(radius > 0)) {
        lost.push({ scope: 'store', code: 'zone_dropped', detail: str(f.name) });
        continue;
      }
      out.push({
        name: `Até ${String(Math.round(radius / 100) / 10).replace('.', ',')} km`,
        kind: 'polygon',
        polygon: circle(lat, lng, radius),
        ...base,
      });
    }
  }
  if (overlap(out)) lost.push({ scope: 'store', code: 'delivery_overlap' });
  return out.length ? out : undefined;
}

function payments(forms: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  let online = false;
  for (const f of list(forms.payment_forms)) {
    const name = str(f.name).trim();
    if (flag(f.online_acceptance) && !flag(f.delivery_acceptance)) {
      online = true;
      continue;
    }
    if (f.delivery_acceptance !== undefined && !flag(f.delivery_acceptance)) continue;
    const enc = str(f.encoded_name).toLowerCase();
    const mode = str(f.operation_mode).toUpperCase();
    const method: PaymentMethod | null =
      enc === 'money'
        ? 'cash'
        : enc === 'pix' || /\bpix\b/i.test(name)
          ? 'pix'
          : mode === 'VOUCHER' || ['sodexo', 'alelo', 'vr', 'ticket'].includes(enc)
            ? 'meal_voucher'
            : mode === 'CREDIT' || mode === 'DEBIT' || flag(f.is_card_brand)
              ? 'card_on_delivery'
              : methodOf(name);
    if (!method) {
      lost.push({ scope: 'store', code: 'payment_method', detail: name || enc });
      continue;
    }
    if (!methods.includes(method)) methods.push(method);
    if ((numOf(f.discount_percentage) ?? 0) > 0)
      lost.push({ scope: 'store', code: 'payment_adjustment', detail: name || enc });
  }
  if (
    online ||
    flag(forms.accept_pix_as_online_payment) ||
    flag(forms.accept_credit_card_as_online_payment)
  )
    lost.push({ scope: 'store', code: 'online_payment' });
  // the key, when there is one, is written inside a payment form's name
  if (methods.includes('pix')) lost.push({ scope: 'store', code: 'pix_unreadable' });
  return { methods };
}

function hours(unit: Raw) {
  const ranges: { day: number; open: string; close: string }[] = [];
  for (const h of list(unit.business_hours)) {
    const day = (numOf(h.weekday) ?? 0) - 1;
    // a wall-clock time on a placeholder date with a fake +00:00: read the digits
    const open = hhmm(str(h.shift_start).split('T')[1]);
    const close = hhmm(str(h.shift_end).split('T')[1]);
    if (day >= 0 && day <= 6 && open && close) ranges.push({ day, open, close });
  }
  return windowsOf(ranges);
}

const data = (v: unknown): Raw => (isRaw(v) && isRaw(v.data) ? v.data : {});

export const deliverydireto: Adapter = {
  platform: 'deliverydireto',
  hosts: { api: [HOST], images: ['duisktnou8b89.cloudfront.net', 'img.deliverydireto.com.br'] },

  match(url) {
    if (url.hostname.toLowerCase().replace(/^www\./, '') !== HOST) return null;
    const [brand, unit] = url.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (!brand || !SLUG.test(brand) || RESERVED.has(brand)) return null;
    return { ref: unit && SLUG.test(unit) && !NOT_A_UNIT.has(unit) ? `${brand}/${unit}` : brand };
  },

  async read(ref: string, http: ImportHttp) {
    const [brand, given] = ref.split('/');
    const origin = `https://${HOST}`;
    const info = data(await http.json(`${origin}/${encodeURIComponent(brand!)}/basic_info`));
    const units = list(isRaw(info.brand) ? info.brand.stores : null);
    // a brand link opens its only unit; with several, the merchant has to paste the unit's
    const unit = given
      ? units.find((u) => str(u.encoded_name).toLowerCase() === given)
      : units.length === 1
        ? units[0]
        : undefined;
    if (!unit) throw new ImportFailure('NOT_FOUND', given ? 'no such unit' : 'pick a unit');
    const base = `${origin}/${encodeURIComponent(brand!)}/${encodeURIComponent(str(unit.encoded_name))}`;
    const cats = await http.json(`${base}/categories`);
    if (!isRaw(cats) || cats.status !== 'success' || !Array.isArray(data(cats).categories))
      throw new ImportFailure('UNREADABLE', 'no categories');
    const list0 = list(data(cats).categories);
    // categories are independent: read a few at a time within the per-host pacing
    const details = await pool(list0, 4, async (c) => {
      const d = await http.json(`${base}/categories/${numOf(c.id)}?include=items,properties`);
      return isRaw(d) && d.status === 'success' && isRaw(data(d).category)
        ? data(d).category
        : { name: c.name, unreadable: true };
    });
    let module: Raw | null = null;
    if (list0.some((c) => str(c.encoded_name) === 'pizza_module')) {
      const sizes = list(data(await http.json(`${base}/pizza_module/get_pizza_sizes`)).items);
      const flavors: Raw = {};
      const additionals: Raw = {};
      await pool(sizes, 2, async (s) => {
        const id = numOf(s.id);
        flavors[String(id)] = data(
          await http.json(`${base}/pizza_module/get_pizza_flavors?size=${id}`),
        ).items;
        additionals[String(id)] = data(
          await http.json(`${base}/pizza_module/get_pizza_additionals?size=${id}`),
        );
      });
      module = { sizes, flavors, additionals };
    }
    const fees = data(await http.json(`${base}/delivery/fees`));
    const forms = data(await http.json(`${base}/payment-forms`));
    return { unit, categories: details, pizza: module, fees, forms };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const unit = isRaw(raw.unit) ? raw.unit : {};
    const settings = isRaw(unit.settings) ? unit.settings : {};
    const lost: Lost[] = [];

    const categories: ImportCategory[] = [];
    for (const c of [...list(raw.categories)].sort(
      (a, b) => (numOf(a.view_order) ?? 0) - (numOf(b.view_order) ?? 0),
    )) {
      const name = str(c.name).trim();
      if (c.unreadable) {
        lost.push({ scope: 'category', subject: name, code: 'category_unreadable' });
        continue;
      }
      const times = availability(c.categoryavailabilities);
      const products =
        str(c.encoded_name) === 'pizza_module'
          ? pizzaModule(isRaw(raw.pizza) ? raw.pizza : {}, times, lost)
          : [...list(c.items)]
              .sort((a, b) => (numOf(a.view_order) ?? 0) - (numOf(b.view_order) ?? 0))
              .map((i) => product(i, times, lost))
              .filter((p): p is ImportProduct => p !== null);
      if (str(c.cover_photo))
        lost.push({ scope: 'category', subject: name, code: 'category_image' });
      categories.push({ name, description: str(c.description), products });
    }

    // separate minimums there; here the store's binds both and a zone's adds to it on delivery
    const pickup = numOf(unit.takeout_status) === 1;
    const deliveryMin = positiveCents(unit.minimum_order) ?? 0;
    // with no pickup the store minimum binds delivery alone
    const pickupMin = pickup ? (positiveCents(unit.takeout_minimum_order) ?? 0) : deliveryMin;
    const deliveryOn = numOf(unit.switch_delivery) === 1;
    const zoneList = deliveryOn
      ? zones(
          isRaw(raw.fees) ? raw.fees : {},
          {
            ...(deliveryMin > pickupMin ? { minOrderCents: deliveryMin } : {}),
            ...((f) => (f !== null ? { freeDeliveryOverCents: f } : {}))(
              positiveCents(settings.free_delivery_minimum_order),
            ),
          },
          lost,
        )
      : undefined;
    if (deliveryOn && deliveryMin < pickupMin)
      lost.push({
        scope: 'store',
        code: 'delivery_minimum_lower',
        ...(deliveryMin ? { detail: reais(deliveryMin) } : {}),
      });
    if (deliveryOn && !zoneList && deliveryMin > pickupMin)
      lost.push({ scope: 'store', code: 'delivery_minimum', detail: reais(deliveryMin) });
    // no area drawn: the storefront shows delivery as free, wherever the address
    if (deliveryOn && !zoneList)
      lost.push(
        list(isRaw(raw.fees) ? raw.fees.fees : null).length
          ? { scope: 'store', code: 'delivery_fees_unreadable' }
          : { scope: 'store', code: 'delivery_flat_fee', detail: 'grátis' },
      );

    const a = isRaw(unit.address) ? unit.address : {};
    const lat = numOf(a.lat ?? unit.lat);
    const lng = numOf(a.lng ?? unit.lng);
    const prep = numOf(zoneList ? unit.min_waiting_time : unit.takeout_time);

    return {
      v: 1,
      source,
      store: {
        name: str(unit.name),
        tagline: str(unit.description).split(/\r?\n/)[0] ?? '',
        whatsapp: str(unit.formatted_contact_telephone),
        instagram: str(unit.url_instagram),
        address: flag(unit.hide_address)
          ? ''
          : [
              [str(a.street).trim(), str(a.number).trim()].filter(Boolean).join(', '),
              str(a.complement).trim(),
              str(a.neighborhood).trim(),
            ]
              .filter(Boolean)
              .join(' - '),
        city: str(a.city),
        ...(lat !== null && lng !== null ? { coords: { lat, lng } } : {}),
        logoUrl: /placeholder/.test(str(unit.logo_photo)) ? '' : str(unit.logo_photo),
        coverUrl: str(unit.cover_photo),
        ...((c) => (c ? { brandColor: c } : {}))(colour(settings.primary_color)),
      },
      hours: hours(unit),
      operations: {
        ...(pickupMin > 0 ? { minOrderCents: pickupMin } : {}),
        ...(prep && prep > 0 ? { prepTimeMinutes: Math.round(prep) } : {}),
        pickup,
        delivery: !!zoneList?.length,
      },
      ...(zoneList ? { zones: zoneList } : {}),
      payments: payments(isRaw(raw.forms) ? raw.forms : {}, lost),
      categories,
      lost,
    };
  },
};
