// Cardápio Web: the store profile, then the whole menu with options inline (docs/menu-import.md
// Appendix A, checked 2026-10-01). Reais as numbers; delivery fees exist only per address.

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
  colour,
  hhmm,
  intersectDays,
  liftFloor,
  numOf,
  pixType,
  positiveCents,
  reais,
  scheduleOf,
  windowsOf,
} from './shared.ts';
import { flag, isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'integracao.cardapioweb.com';

// the first label of the host picks the menu mode; any of them serves the same store
const HOST = /^(?:www\.)?(?:app|menu|mesa|balcao|entrega|local|delivery)\.cardapioweb\.com$/;

const RESERVED = new Set([
  'api',
  'admin',
  'login',
  'cadastro',
  'entrar',
  'painel',
  'planos',
  'precos',
  'blog',
  'ajuda',
  'suporte',
  'termos',
  'privacidade',
  'contato',
]);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const dayOf = (v: unknown) => WEEKDAYS.indexOf(str(v).toLowerCase());

const BADGES: Record<string, string> = {
  best_seller: 'Mais vendido',
  new_item: 'Novidade',
  recommended: 'Recomendado',
  limited_edition: 'Edição limitada',
  offer: 'Oferta',
};

/** `allowed_times[]` ({weekday, start_at, end_at}) → windows per day; [] = always (null). */
function allowedTimes(v: unknown): Map<number, [string, string][]> | null {
  const rows = list(v);
  if (!rows.length) return null;
  const out = new Map<number, [string, string][]>();
  for (const r of rows) {
    const d = dayOf(r.weekday);
    const a = hhmm(r.start_at);
    const b = hhmm(r.end_at);
    if (d < 0 || !a || !b) continue;
    out.set(d, [...(out.get(d) ?? []), [a, b]]);
  }
  return out;
}

/**
 * The promo runs only on its schedule (`promotional_price_schedules`, else
 * `promotional_price_availability`); Venduá has no promo schedule, so a promo counts only when it
 * runs every day, all day.
 */
function promoEveryDay(item: Raw): boolean {
  const sched = Array.isArray(item.promotional_price_schedules)
    ? list(item.promotional_price_schedules)
    : [];
  if (sched.length) {
    const days = new Set<number>();
    for (const s of sched) {
      const start = hhmm(s.start);
      const end = hhmm(s.end);
      // a time window inside the day is a promo of some hours
      if ((start || end) && !(start === '00:00' && (end === '23:59' || !end))) return false;
      days.add(dayOf(s.day));
    }
    return WEEKDAYS.every((_, i) => days.has(i));
  }
  const avail = Array.isArray(item.promotional_price_availability)
    ? item.promotional_price_availability.map(dayOf)
    : [];
  return WEEKDAYS.every((_, i) => avail.includes(i));
}

/**
 * An add-on list: SINGLE (one option), MULTIPLE (each option at most once), SUMMABLE (a quantity
 * per option, capped by the option's `max_quantity` and the group's maximum). The group's price
 * is SUM, MEAN (average over the units picked, rounded half up like the storefront's
 * `_.round(x, 2)`), MAX (the dearest) or MIN (the cheapest, which Venduá has no rule for).
 */
function optionGroup(g: Raw): { group: ImportOptionGroup; exact: boolean } | 'empty' | null {
  const name = str(g.name).trim();
  if (!name || !Array.isArray(g.subitems)) return null;
  const kind = str(g.choice_type).toUpperCase();
  const min = Math.max(0, Math.trunc(numOf(g.minimum_quantity) ?? 0));
  const rawMax = Math.trunc(numOf(g.maximum_quantity) ?? 0);
  const max = kind === 'SINGLE' ? 1 : rawMax > 0 ? rawMax : 1000;
  const options: ImportOptionGroup['options'] = [];
  for (const o of [...list(g.subitems)].sort(
    (a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0),
  )) {
    const status = str(o.status).toUpperCase();
    if (status && status !== 'ACTIVE' && status !== 'MISSING') continue;
    const oname = str(o.name).trim();
    const cents = toCents(o.price ?? 0);
    if (!oname || cents === null) return null;
    const opt: ImportOptionGroup['options'][number] = { name: oname, priceDeltaCents: cents };
    if (kind === 'SUMMABLE') {
      const q = Math.trunc(numOf(o.max_quantity) ?? max);
      if (q > 1) opt.maxQty = Math.min(q, max);
    }
    const d = str(o.description).trim();
    if (d) opt.description = d;
    const img = str(o.image_url);
    if (img) opt.imageUrl = img;
    const outOfStock = flag(o.active_stock_control) && !((numOf(o.stock) ?? 0) > 0);
    if (status === 'MISSING' || outOfStock) opt.soldOut = true;
    options.push(opt);
  }
  if (!options.length) return min > 0 ? null : 'empty';
  const calc = str(g.price_calculation_type).toUpperCase();
  const rule =
    calc === 'MEAN'
      ? ('average' as const)
      : calc === 'MAX'
        ? ('most_expensive' as const)
        : undefined;
  return {
    group: { name, min, max, ...(rule && max > 1 ? { pricingRule: rule } : {}), options },
    // MIN (the cheapest) or a rule we don't know: no equivalent here
    exact: ['', 'SUM', 'MEAN', 'MAX'].includes(calc) || max === 1,
  };
}

const requiredAddOn = (item: Raw) =>
  list(item.add_ons).some((g) => (numOf(g.minimum_quantity) ?? 0) > 0);

function product(
  item: Raw,
  cat: Map<number, [string, string][]> | null,
  byId: Map<string, Raw>,
  lost: Lost[],
  now: number,
): ImportProduct | null {
  const name = str(item.name).trim();
  const status = str(item.status).toUpperCase();
  if (status && status !== 'ACTIVE' && status !== 'MISSING') return null;
  const channels = Array.isArray(item.available_for) ? item.available_for.map(str) : [];
  const types = Array.isArray(item.available_order_types)
    ? item.available_order_types.map(str)
    : [];
  if (
    (channels.length && !channels.includes('delivery')) ||
    (types.length && !types.includes('delivery') && !types.includes('takeout'))
  ) {
    lost.push({ scope: 'product', subject: name, code: 'dine_in_only' });
    return null;
  }
  const days = intersectDays(cat, allowedTimes(item.allowed_times));
  const sched = days ? scheduleOf(days) : undefined;
  if (sched === 'never') {
    lost.push({ scope: 'product', subject: name, code: 'never_available' });
    return null;
  }

  const price = toCents(item.price ?? 0);
  const p: ImportProduct = {
    ref: str(item.id),
    name,
    description: str(item.description),
    priceCents: price ?? -1,
    tags: [],
    images: [
      str(item.image_url),
      ...list(item.extra_images).map((x) => str(x.image_url)),
      ...(Array.isArray(item.extra_images)
        ? item.extra_images.filter((x) => typeof x === 'string')
        : []),
    ].filter(Boolean),
    status: status === 'MISSING' ? 'sold_out' : 'active',
    optionGroups: [],
  };
  const hide = (code: string, detail?: string) => {
    p.status = 'archived';
    lost.push({ scope: 'product', subject: name, code, ...(detail ? { detail } : {}) });
  };

  // always null on the stores checked; a minimum we can't see the rule of isn't guessed
  if ((numOf(item.minimum_price) ?? 0) > 0) hide('price_unreadable');

  const promo = toCents(item.promotional_price);
  if (flag(item.promotional_price_active) && promo !== null && price !== null && promo < price) {
    if (promoEveryDay(item)) {
      p.priceCents = promo;
      p.compareAtPriceCents = price;
    } else
      lost.push({ scope: 'product', subject: name, code: 'promo_schedule', detail: reais(promo) });
  }

  const badge = BADGES[str(item.badge)];
  if (badge) p.tags.push(badge);
  if (flag(item.highlighted)) p.tags.push('Destaque');
  const newUntil = Date.parse(str(item.highlight_as_new_until));
  if (Number.isFinite(newUntil) && newUntil > now && !p.tags.includes('Novidade'))
    p.tags.push('Novidade');

  if (flag(item.active_stock_control))
    p.stockQuantity = Math.max(0, Math.floor(numOf(item.stock) ?? 0));
  if (sched) p.availability = sched;
  const timings = Array.isArray(item.available_order_timings)
    ? item.available_order_timings.map(str)
    : [];
  if (timings.length && !timings.includes('immediate')) p.requiresPreorder = true;
  if (types.length && !types.includes('delivery'))
    lost.push({ scope: 'product', subject: name, code: 'pickup_only' });
  if (flag(item.adults_only)) lost.push({ scope: 'product', subject: name, code: 'adults_only' });
  if (/^(kg|g|gr|grama|quilo)/i.test(str(item.unit_type))) hide('sold_by_weight');

  for (const g of list(item.add_ons)) {
    const s = str(g.status).toUpperCase();
    if (s && s !== 'ACTIVE') continue;
    const r = optionGroup(g);
    if (r === 'empty') continue;
    if (!r) {
      hide('options_unreadable', str(g.name) || undefined);
      continue;
    }
    if (!r.exact) hide('pizza_pricing', r.group.name);
    // a required list with nothing to pick: the old store shows the item as unavailable
    if (r.group.min > 0 && r.group.options.every((o) => o.soldOut) && p.status !== 'archived')
      p.status = 'sold_out';
    p.optionGroups.push(r.group);
  }

  // a combo: one pick per step, each step's price plus the pick's extra; the pick's own add-ons
  // are chosen there and can't be here, so a component with a required one doesn't resolve
  if (str(item.kind) === 'combo') {
    const steps = list(item.combo_steps);
    let base = 0;
    let ok = steps.length > 0;
    const slots: NonNullable<ImportProduct['kit']>['slots'] = [];
    for (const s of steps) {
      const stepPrice = toCents(s.price ?? 0);
      if (stepPrice === null) ok = false;
      else base += stepPrice;
      const items = list(s.combo_step_items).map((ci) => {
        const extra = toCents(ci.additional_price ?? 0);
        const target = byId.get(str(ci.item_id));
        if (extra === null || !target || requiredAddOn(target)) ok = false;
        return { ref: str(ci.item_id), priceDeltaCents: extra ?? 0 };
      });
      slots.push({ name: str(s.name) || 'Escolha', min: 1, max: 1, items });
    }
    if (ok) {
      p.priceCents = base;
      p.kit = { slots };
    } else hide('kit_unresolved');
  }

  liftFloor(p);
  return p;
}

const PAYMENT: Record<string, PaymentMethod | null> = {
  money: 'cash',
  pix: 'pix',
  credit_card: 'card_on_delivery',
  debit_card: 'card_on_delivery',
  meal_voucher: 'meal_voucher',
  food_voucher: 'meal_voucher',
};
// paid inside the old platform or a marketplace's own wallet: nothing to carry over
const SKIPPED = new Set([
  'debt_book',
  'ifood',
  'ifood_voucher',
  'food99',
  'food99_voucher',
  'aiqfome',
]);

function payments(profile: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  let pix: NonNullable<MenuImportV1['payments']>['pix'];
  let online = false;
  for (const m of list(profile.payment_methods)) {
    if (m.available_on_menu !== undefined && !flag(m.available_on_menu)) continue;
    const kind = str(m.kind);
    if (SKIPPED.has(kind)) continue;
    if (kind === 'pix_auto' || kind === 'online_credit_card' || m.online_payment_provider) {
      online = true;
      continue;
    }
    const method = PAYMENT[kind];
    if (!method) {
      lost.push({ scope: 'store', code: 'payment_method', detail: str(m.name) || kind });
      continue;
    }
    if (!methods.includes(method)) methods.push(method);
    if ((numOf(m.percentual_fee) ?? 0) !== 0 || (numOf(m.fixed_fee) ?? 0) !== 0)
      lost.push({ scope: 'store', code: 'payment_adjustment', detail: str(m.name) || kind });
    if (method === 'pix' && !pix && str(m.observation)) {
      let o: unknown = null;
      try {
        o = JSON.parse(str(m.observation));
      } catch {
        // free text, not the key
      }
      const key = isRaw(o) ? str(o.key).trim() : '';
      const type = isRaw(o) && key ? pixType(str(o.type), key) : null;
      if (key && type)
        pix = {
          key,
          type,
          beneficiary: (isRaw(o) && str(o.name)) || str(profile.name),
          city: str(profile.city),
        };
      else if (key) lost.push({ scope: 'store', code: 'pix_unreadable' });
    }
  }
  if (online) lost.push({ scope: 'store', code: 'online_payment' });
  return { methods, ...(pix ? { pix } : {}) };
}

function storeLost(profile: Raw, lost: Lost[]) {
  const flags = isRaw(profile.flags) ? profile.flags : {};
  const loyalty = isRaw(profile.loyalty_program_setting) ? profile.loyalty_program_setting : null;
  if (loyalty && (numOf(loyalty.points_per_currency_unit) ?? 0) > 0)
    lost.push({ scope: 'store', code: 'loyalty' });
  if (list(profile.coupons).length) lost.push({ scope: 'store', code: 'coupons' });
  if (list(profile.item_suggestions).length) lost.push({ scope: 'store', code: 'upsell' });
  const slot = isRaw(profile.schedule_setting)
    ? numOf(profile.schedule_setting.time_interval)
    : null;
  if (flag(flags.work_with_scheduled_order) && slot && slot > 0)
    lost.push({ scope: 'store', code: 'time_slots', detail: String(slot) });
  if (flag(flags.work_with_onsite)) lost.push({ scope: 'store', code: 'dine_in' });
  if (flag(flags.work_with_delivery)) {
    const names = list(profile.delivery_only_for_neighborhoods)
      .map((n) => str(n.name).trim())
      .filter(Boolean);
    lost.push({
      scope: 'store',
      code: 'delivery_by_address',
      ...(names.length ? { detail: names.join(', ') } : {}),
    });
    const free = positiveCents(profile.free_delivery_from);
    if (free) lost.push({ scope: 'store', code: 'free_delivery_rule', detail: reais(free) });
  }
}

function hours(profile: Raw) {
  const bh = isRaw(profile.business_hours) ? profile.business_hours : {};
  const ranges: { day: number; open: string; close: string }[] = [];
  WEEKDAYS.forEach((d, day) => {
    for (const r of Array.isArray(bh[d]) ? bh[d] : []) {
      if (!Array.isArray(r)) continue;
      const open = hhmm(r[0]);
      const close = hhmm(r[1]);
      if (open && close) ranges.push({ day, open, close });
    }
  });
  return windowsOf(ranges);
}

export const cardapioweb: Adapter = {
  platform: 'cardapioweb',
  // the platform's own bucket on a host every Google Cloud bucket shares
  hosts: {
    api: [API],
    images: ['storage.googleapis.com/prod-cardapio-web/', 'cdn.cardapioweb.com.br'],
  },

  match(url) {
    if (!HOST.test(url.hostname.toLowerCase())) return null;
    const slug = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (!slug || !/^[a-z0-9_][a-z0-9_.-]{1,99}$/.test(slug) || RESERVED.has(slug)) return null;
    return { ref: slug };
  },

  async read(ref: string, http: ImportHttp) {
    const base = `https://${API}/api/menu/company`;
    const profile = await http.json(`${base}/profile?company=${encodeURIComponent(ref)}`);
    if (!isRaw(profile) || numOf(profile.id) === null)
      throw new ImportFailure('NOT_FOUND', 'no store');
    const categories = await http.json(`${base}/categories?only_available_for=delivery`, {
      'company-id': String(numOf(profile.id)),
      company: str(profile.url_name) || ref,
    });
    if (!Array.isArray(categories)) throw new ImportFailure('UNREADABLE', 'no categories');
    return { profile, categories };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const profile = isRaw(raw.profile) ? raw.profile : {};
    const flags = isRaw(profile.flags) ? profile.flags : {};
    const lost: Lost[] = [];

    const cats = [...list(raw.categories)].sort(
      (a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0),
    );
    const byId = new Map(cats.flatMap((c) => list(c.items)).map((i) => [str(i.id), i]));
    const categories: ImportCategory[] = [];
    for (const c of cats) {
      const status = str(c.status).toUpperCase();
      if (status && status !== 'ACTIVE') continue;
      const name = str(c.name).trim();
      const times = allowedTimes(c.allowed_times);
      const products = [...list(c.items)]
        .sort((a, b) => (numOf(a.position) ?? 0) - (numOf(b.position) ?? 0))
        .map((i) => product(i, times, byId, lost, Date.parse(source.readAt)))
        .filter((p): p is ImportProduct => p !== null);
      if (str(c.image_url)) lost.push({ scope: 'category', subject: name, code: 'category_image' });
      categories.push({ name, description: str(c.description), products });
    }

    storeLost(profile, lost);
    const pay = payments(profile, lost);
    const lat = numOf(profile.latitude);
    const lng = numOf(profile.longitude);
    const street = str(profile.street).trim();
    const address = flag(flags.hide_company_address)
      ? ''
      : [
          [street, str(profile.address_number).trim()].filter(Boolean).join(', '),
          str(profile.address_complement).trim(),
          str(profile.neighborhood).trim(),
        ]
          .filter(Boolean)
          .join(' - ');
    const prep = numOf(profile.preparation_time);

    return {
      v: 1,
      source,
      store: {
        name: str(profile.name),
        tagline: str(profile.description).split(/\r?\n/)[0] ?? '',
        whatsapp: str(profile.order_whatsapp) || str(profile.phone_number),
        instagram: str(profile.instagram),
        address,
        city: str(profile.city),
        ...(lat !== null && lng !== null ? { coords: { lat, lng } } : {}),
        logoUrl: str(profile.logo),
        coverUrl: str(profile.image),
        ...((c) => (c ? { brandColor: c } : {}))(colour(profile.color)),
      },
      hours: hours(profile),
      operations: {
        ...((m) => (m !== null ? { minOrderCents: m } : {}))(
          toCents(profile.minimum_order_value ?? 0),
        ),
        ...(prep && prep > 0 ? { prepTimeMinutes: Math.round(prep) } : {}),
        pickup: flag(flags.work_with_pick_up_store),
        // fees exist only per address there: no zone to import, the merchant draws them
        delivery: false,
      },
      payments: pay,
      categories,
      lost,
    };
  },
};
