// Saipos: a store lookup by host, then the whole menu in one view-data payload
// (docs/menu-import.md Appendix A, checked 2026-10-01). Reais as numbers; option prices are per
// size of the item; many items sit in disabled categories and many option references point at
// nothing. What the storefront shows — categories, sale windows, promotions — follows its own
// bundle's rules, read 2026-10-01.

import {
  toCents,
  type ImportCategory,
  type ImportOptionGroup,
  type ImportProduct,
  type Lost,
  type MenuImportV1,
  type PaymentMethod,
  type SourceInfo,
} from '../doc.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
import {
  averageExact,
  colour,
  hhmm,
  intersectDays,
  liftFloor,
  methodOf,
  numOf,
  positiveCents,
  reais,
  scheduleOf,
  sizeGroup,
  windowsOf,
} from './shared.ts';
import { isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'delivery-api.saipos.com';
const STATIC = 'https://static.saipos.com/';

// the platform's own subdomains (marketing, help, panel), not a store
const RESERVED = new Set([
  'www',
  'app',
  'api',
  'blog',
  'conta',
  'meajuda',
  'delivery-api',
  'static',
  'cms',
  'lp',
  'materiais',
  'material',
  'ofertas',
  'conteudo',
  'ideias',
  'store',
  'webmail',
  'vpn',
  'security',
  'seguro',
  'assinatura',
  'rating',
  'offline',
]);

// the storefront's channel: sale windows and promotions for other channels don't apply
const SITE = 7;

const yes = (v: unknown) => str(v).toUpperCase() === 'Y';
const image = (v: unknown) => (str(v) ? `${STATIC}${str(v).replace(/^\/+/, '')}` : '');

/**
 * A choice for one size of the item: an option's price is its variation for that size (none: 0,
 * as the storefront does). `max_choices` 1 is a single pick, else a quantity per option up to
 * the maximum. `calc_method` 1 adds everything, 2 averages over the units picked, 3 charges the
 * dearest once.
 */
function optionGroup(
  c: Raw,
  variation: number | null,
): { group: ImportOptionGroup; exact: boolean } | 'empty' | null {
  const name = (str(c.desc_store_choice_delivery) || str(c.desc_store_choice)).trim();
  if (!name || !Array.isArray(c.choice_items)) return null;
  const min = Math.max(0, Math.trunc(numOf(c.min_choices) ?? 0));
  const rawMax = Math.trunc(numOf(c.max_choices) ?? 0);
  const max = rawMax > 0 ? rawMax : 1000;
  const options: ImportOptionGroup['options'] = [];
  for (const o of [...list(c.choice_items)].sort(
    (a, b) => (numOf(a.order) ?? 0) - (numOf(b.order) ?? 0),
  )) {
    if (!yes(o.enabled)) continue;
    const oname = (str(o.desc_store_choice_item_deli) || str(o.desc_store_choice_item)).trim();
    const v = list(o.variations).find((x) => numOf(x.id_store_variation) === variation);
    const cents = toCents(v ? (v.aditional_price ?? 0) : 0);
    if (!oname || cents === null) return null;
    options.push({
      name: oname,
      priceDeltaCents: cents,
      ...(max > 1 ? { maxQty: max } : {}),
      ...(str(o.detail).trim() ? { description: str(o.detail).trim() } : {}),
      ...(image(o.img_path) ? { imageUrl: image(o.img_path) } : {}),
    });
  }
  if (!options.length) return min > 0 ? null : 'empty';
  const calc = numOf(c.calc_method) ?? 1;
  const group: ImportOptionGroup = {
    name,
    min,
    max,
    ...(max > 1 && calc === 2 ? { pricingRule: 'average' as const } : {}),
    ...(max > 1 && calc === 3 ? { pricingRule: 'most_expensive' as const } : {}),
    options,
  };
  return {
    group,
    exact: max === 1 || calc === 1 || calc === 3 || (calc === 2 && averageExact(group)),
  };
}

/** One product for one item size (or the item, when it has one): its lists priced for it. */
function forSize(
  item: Raw,
  name: string,
  price: Price,
  variation: number | null,
  choices: Map<number, Raw>,
  lost: Lost[],
  lift = true,
): ImportProduct {
  const p: ImportProduct = {
    ref: `${str(item.id_store_item)}${variation !== null ? `:${variation}` : ''}`,
    name,
    description: str(item.detail),
    priceCents: price.cents ?? -1,
    ...(price.was ? { compareAtPriceCents: price.was } : {}),
    tags: [],
    images: [image(item.img_path)].filter(Boolean),
    status: 'active',
    optionGroups: [],
  };
  for (const ref of [...list(item.choices)].sort(
    (a, b) => (numOf(a.order) ?? 0) - (numOf(b.order) ?? 0),
  )) {
    // a reference to a list the payload doesn't have isn't shown there either
    const c = choices.get(numOf(ref.id_store_choice) ?? -1);
    if (!c) continue;
    const r = optionGroup(c, variation);
    if (r === 'empty') continue;
    if (!r) {
      p.status = 'archived';
      lost.push({
        scope: 'product',
        subject: name,
        code: 'options_unreadable',
        detail: str(c.desc_store_choice),
      });
      continue;
    }
    if (!r.exact) {
      p.status = 'archived';
      lost.push({ scope: 'product', subject: name, code: 'pizza_pricing', detail: r.group.name });
    }
    p.optionGroups.push(r.group);
  }
  if (lift) liftFloor(p);
  if (price.later !== undefined)
    lost.push({
      scope: 'product',
      subject: name,
      code: 'promo_schedule',
      detail: reais(price.later),
    });
  if (price.unreadable) {
    p.status = 'archived';
    lost.push({ scope: 'product', subject: name, code: 'promo_unreadable' });
  }
  return p;
}

interface Price {
  cents: number | null;
  /** the struck-through price under a standing promotion */
  was?: number;
  /** a promotion with its own hours: the normal price comes, this is a note */
  later?: number;
  unreadable?: boolean;
}

/**
 * A size's price as the storefront shows it: the first promotion for the site channel that's
 * enabled and cheaper replaces it — always, or only in its own hours.
 */
function priced(v: Raw): Price {
  const cents = toCents(v.price ?? 0);
  const promo = list(v.promotions).find((g) => numOf(g.id_partner_sale) === SITE && g.enabled);
  if (!promo || cents === null) return { cents };
  // a flag we haven't seen as a boolean could be an "N" the storefront still reads as on
  if (typeof promo.enabled !== 'boolean') return { cents, unreadable: true };
  if (promo.price === null || promo.price === undefined) return { cents };
  const pc = toCents(promo.price);
  if (pc === null) return { cents, unreadable: true };
  if (pc >= cents) return { cents };
  if (list(promo.availabilities).length) return { cents, later: pc };
  return { cents: pc, was: cents };
}

/**
 * Sale windows, as the storefront reads them: rows for today's weekday (1 = Sunday); one whose
 * end is before its start covers that day's early hours and its evening, not the next morning.
 */
function windows(v: unknown): Map<number, [string, string][]> | null {
  const rows = list(v);
  if (!rows.length) return null;
  const out = new Map<number, [string, string][]>();
  for (let d = 0; d < 7; d++) out.set(d, []);
  for (const r of rows) {
    if (r.id_partner_sale !== null && r.id_partner_sale !== undefined) {
      if (numOf(r.id_partner_sale) !== SITE) continue;
    }
    const d = (numOf(r.day_week) ?? 0) - 1;
    const a = hhmm(r.start_time);
    const b = hhmm(r.end_time);
    if (d < 0 || d > 6 || !a || !b || a === b) continue;
    if (a < b) out.get(d)!.push([a, b]);
    else {
      if (b > '00:00') out.get(d)!.push(['00:00', b]);
      out.get(d)!.push([a, '23:59']);
    }
  }
  return out;
}

/**
 * An item: one size is the product; several are a "Tamanho" list, unless its options cost
 * differently per size — then one product per size ("Pizza — G"), each priced for it.
 */
function products(item: Raw, choices: Map<number, Raw>, lost: Lost[]): ImportProduct[] {
  const name = (str(item.desc_store_item_delivery) || str(item.desc_store_item)).trim();
  const label = (v: Raw) => {
    const d = isRaw(v.variation) ? v.variation : {};
    return (str(d.desc_store_variation_delivery) || str(d.desc_store_variation)).trim();
  };
  const all = list(item.variations).filter((v) => yes(v.enabled));
  // an internal "Único" size is skipped there when the item has others
  const sizes = all
    .filter((v) => all.length === 1 || label(v).toUpperCase() !== 'ÚNICO')
    .sort((a, b) => (numOf(a.order) ?? 0) - (numOf(b.order) ?? 0));
  if (!sizes.length) return [];
  // shown only while both its category's windows and its own hold
  const ci = isRaw(item.category_item) ? item.category_item : {};
  const days = intersectDays(windows(ci.availability), windows(item.availability));
  const sched = days ? scheduleOf(days) : undefined;
  if (sched === 'never') {
    lost.push({ scope: 'product', subject: name, code: 'never_available' });
    return [];
  }
  let out: ImportProduct[];
  if (sizes.length === 1) {
    const v = sizes[0]!;
    out = [forSize(item, name, priced(v), numOf(v.id_store_variation), choices, lost)];
  } else {
    const ids = sizes.map((v) => numOf(v.id_store_variation));
    const perSize = list(item.choices).some((ref) => {
      const c = choices.get(numOf(ref.id_store_choice) ?? -1);
      return list(c?.choice_items).some((o) => {
        const prices = ids.map((id) =>
          toCents(
            list(o.variations).find((x) => numOf(x.id_store_variation) === id)?.aditional_price ??
              0,
          ),
        );
        return new Set(prices).size > 1;
      });
    });
    if (perSize) {
      out = sizes.map((v) =>
        forSize(
          item,
          `${name} — ${label(v) || 'Tamanho'}`,
          priced(v),
          numOf(v.id_store_variation),
          choices,
          lost,
        ),
      );
    } else {
      const prices = sizes.map(priced);
      // the lists cost the same for every size: price them for the first, lift once below
      const p = forSize(item, name, { cents: 0 }, ids[0] ?? null, choices, lost, false);
      const later = prices.find((pr) => pr.later !== undefined)?.later;
      if (later !== undefined)
        lost.push({
          scope: 'product',
          subject: name,
          code: 'promo_schedule',
          detail: reais(later),
        });
      if (prices.some((pr) => pr.unreadable)) {
        p.status = 'archived';
        lost.push({ scope: 'product', subject: name, code: 'promo_unreadable' });
      }
      if (prices.some((pr) => pr.cents === null)) p.priceCents = -1;
      else {
        const g = sizeGroup(
          sizes.map((v, i) => ({ name: label(v) || `Opção ${i + 1}`, cents: prices[i]!.cents! })),
        )!;
        p.priceCents = g.baseCents;
        p.optionGroups.unshift(g.group);
        liftFloor(p);
      }
      out = [p];
    }
  }
  if (sched) for (const p of out) p.availability = { ...sched, outside: 'hidden' };
  return out;
}

function payments(store: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  for (const t of list(store.site_payment_types)) {
    const sp = isRaw(t.store_payment_type) ? t.store_payment_type : {};
    if (sp.enabled !== undefined && !yes(sp.enabled)) continue;
    // the store's own label ("Crédito Amex") first: the platform's is sometimes just a brand
    const own = str(sp.desc_store_payment_type).trim();
    const site = str(
      isRaw(t.site_delivery_payment_type) ? t.site_delivery_payment_type.desc_payment_type : '',
    ).trim();
    const name = own || site;
    const method = methodOf(own) ?? methodOf(site);
    if (!method) {
      lost.push({ scope: 'store', code: 'payment_method', detail: name });
      continue;
    }
    if (!methods.includes(method)) methods.push(method);
  }
  if (store.pix_enabled === true || yes(store.enabled_payment_online))
    lost.push({ scope: 'store', code: 'online_payment' });
  // the payload carries no key
  if (methods.includes('pix')) lost.push({ scope: 'store', code: 'pix_unreadable' });
  return { methods };
}

function hours(store: Raw) {
  const ranges: { day: number; open: string; close: string }[] = [];
  for (const s of list(store.schedules_service)) {
    // 1 = Sunday (the storefront's weekday % 7 + 1)
    const day = (numOf(s.day_week) ?? 0) - 1;
    const open = hhmm(s.start_time);
    const close = hhmm(s.end_time);
    if (day >= 0 && day <= 6 && open && close) ranges.push({ day, open, close });
  }
  return windowsOf(ranges);
}

export const saipos: Adapter = {
  platform: 'saipos',
  hosts: { api: [API], images: ['static.saipos.com'] },

  match(url) {
    const host = url.hostname.toLowerCase();
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.saipos\.com$/.exec(host);
    if (!m || RESERVED.has(m[1]!)) return null;
    return { ref: host };
  },

  async read(ref: string, http: ImportHttp) {
    const filter = encodeURIComponent(JSON.stringify({ domain_name: ref }));
    const stores = await http.json(`https://${API}/v1/stores?filter=${filter}`);
    const store = Array.isArray(stores) ? stores.find(isRaw) : undefined;
    const id = store ? numOf(store.id_store) : null;
    if (!store || id === null) throw new ImportFailure('NOT_FOUND', 'no store');
    const view = await http.json(`https://${API}/v1/stores/${id}/sales/view-data`);
    if (!isRaw(view) || !Array.isArray(view.items))
      throw new ImportFailure('UNREADABLE', 'no items');
    return { store, items: view.items, choices: view.choices };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const store = isRaw(raw.store) ? raw.store : {};
    const lost: Lost[] = [];
    const choices = new Map(
      list(raw.choices).map((c) => [numOf(c.id_store_choice) ?? -1, c] as const),
    );

    // categories live on each item (its own and any extra ones), only the enabled ones; the
    // site may list the categories it shows as "id##NAME**id##NAME"
    const site = str(store.categories).trim();
    const shown = site
      ? site
          .split('**')
          .map((x) => Number((x.split('##')[0] ?? '').replace(/\D/g, '')))
          .filter(Boolean)
      : null;
    const byCat = new Map<
      number,
      { name: string; order: number; required: number; items: Raw[] }
    >();
    for (const item of list(raw.items)) {
      const places = [
        item.category_item,
        ...list(item.categories).map((c) => c.store_category_item),
      ].filter(isRaw);
      for (const ci of places) {
        if (!yes(ci.enabled)) continue;
        const id = numOf(ci.id_store_category_item) ?? -1;
        const c = byCat.get(id) ?? {
          name: str(ci.desc_store_category_item).trim(),
          order: numOf(ci.order) ?? 0,
          required: numOf(ci.id_store_item_required) ?? 0,
          items: [],
        };
        if (!c.items.includes(item)) c.items.push(item);
        byCat.set(id, c);
      }
    }
    // a list naming none of them is stale (that storefront shows no items): bring them all
    if (shown && [...byCat.keys()].some((id) => shown.includes(id))) {
      for (const id of [...byCat.keys()]) if (!shown.includes(id)) byCat.delete(id);
    } else if (shown && byCat.size) lost.push({ scope: 'store', code: 'site_categories_stale' });
    const names = new Map(
      list(raw.items).map((i) => [
        numOf(i.id_store_item),
        (str(i.desc_store_item_delivery) || str(i.desc_store_item)).trim(),
      ]),
    );
    // an item in two categories is read once and listed in both
    const read = new Map<Raw, ImportProduct[]>();
    const categories: ImportCategory[] = [...byCat.entries()]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, c]) => {
        // binds only when the category has something else to order
        const binds = c.items.some((i) => numOf(i.id_store_item) !== c.required);
        const need = c.required > 0 && binds ? (names.get(c.required) ?? '') : null;
        if (need !== null)
          lost.push({
            scope: 'category',
            subject: c.name,
            code: 'required_item',
            ...(need ? { detail: need } : {}),
          });
        return {
          name: c.name,
          products: [...c.items]
            .sort((a, b) => (numOf(a.order) ?? 0) - (numOf(b.order) ?? 0))
            .flatMap((i) => {
              const first = read.get(i);
              if (!first) {
                const ps = products(i, choices, lost);
                read.set(i, ps);
                return ps;
              }
              return first.map((p) => ({ ...structuredClone(p), ref: `${p.ref}@${id}` }));
            }),
        };
      });

    const delivery = yes(store.pickup_delivery);
    const pickup = yes(store.pickup_counter);
    if (delivery) {
      lost.push({ scope: 'store', code: 'delivery_by_address' });
      const free = positiveCents(store.free_shipping);
      if (free) lost.push({ scope: 'store', code: 'free_delivery_rule', detail: reais(free) });
    }
    if (store.enable_order_schedule === true) lost.push({ scope: 'store', code: 'time_slots' });
    const district = isRaw(store.district) ? store.district : {};
    const city = isRaw(district.city) ? district.city : {};
    const prep = numOf(pickup && !delivery ? store.pickup_time : store.delivery_time);

    return {
      v: 1,
      source,
      store: {
        name: str(store.trade_name) || str(store.store_name),
        address:
          store.show_store_address === false
            ? ''
            : [
                [str(store.address).trim(), str(store.address_number).trim()]
                  .filter(Boolean)
                  .join(', '),
                str(store.address_complement).trim(),
                str(district.desc_district).trim(),
              ]
                .filter(Boolean)
                .join(' - '),
        city: str(city.desc_city),
        logoUrl: image(store.photo_site_logo),
        coverUrl: image(store.photo_site_cover),
        ...((c) => (c ? { brandColor: c } : {}))(colour(store.primary_color)),
      },
      hours: hours(store),
      operations: {
        ...((m) => (m !== null ? { minOrderCents: m } : {}))(positiveCents(store.minimum_value)),
        ...(prep && prep > 0 ? { prepTimeMinutes: Math.round(prep) } : {}),
        pickup,
        // the fee is computed per address there: no zone to import
        delivery: false,
      },
      payments: payments(store, lost),
      categories,
      lost,
    };
  },
};
