// Instadelivery: one public GET returns the whole store (docs/menu-import.md Appendix A).
// Prices arrive as reais floats; hidden items are absent from the payload.

import {
  toCents,
  type ImportOptionGroup,
  type ImportProduct,
  type ImportSchedule,
  type ImportWindow,
  type ImportZone,
  type Lost,
  type MenuImportV1,
  type PaymentMethod,
  type SourceInfo,
} from '../doc.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
import { MAX_PERCENT_BPS } from '../../payment-adjustments.ts';
import {
  colour,
  eta,
  hhmm,
  intOf,
  liftFloor,
  methodOf,
  pixType,
  positiveCents,
  reais,
  windowsOf,
} from './shared.ts';
import { flag, isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'app.instadelivery.com.br';
const CDN = [
  'instadelivery-public.nyc3.cdn.digitaloceanspaces.com',
  'instadelivery-public.nyc3.digitaloceanspaces.com',
];

// first path segments that are the platform's own pages, not a store
const RESERVED = new Set([
  'api',
  'app',
  'admin',
  'blog',
  'login',
  'cadastro',
  'cadastre-se',
  'planos',
  'precos',
  'contato',
  'sobre',
  'termos',
  'privacidade',
  'ajuda',
  'suporte',
  'parceiros',
  'portal',
]);

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
function weekdays(o: Raw): number[] {
  return DAYS.map((d, i) => (o[d] === false || o[d] === 0 || o[d] === '0' ? -1 : i)).filter(
    (i) => i >= 0,
  );
}

/** item ∩ category weekdays and times → a schedule, or none when it's always on sale */
function availability(item: Raw, group: Raw): ImportSchedule | undefined | 'never' {
  const g = new Set(weekdays(group));
  const days = weekdays(item).filter((d) => g.has(d));
  if (!days.length) return 'never';
  const span = (o: Raw): [string, string] | null => {
    const a = hhmm(o.start_time);
    const b = hhmm(o.end_time);
    return a && b && a !== b ? [a, b] : null;
  };
  const si = span(item);
  const sg = span(group);
  let from: string | undefined;
  let to: string | undefined;
  if (si && sg) {
    from = si[0] > sg[0] ? si[0] : sg[0];
    to = si[1] < sg[1] ? si[1] : sg[1];
  } else if (si ?? sg) [from, to] = (si ?? sg)!;
  if (from !== undefined && to !== undefined && from >= to) {
    // past midnight: the part before midnight on the listed days, the rest the next morning
    const next = days.map((d) => (d + 1) % 7);
    const windows: ImportSchedule['windows'] = [{ days, from, to: '23:59' }];
    if (to > '00:00') windows.push({ days: next, from: '00:00', to });
    return { windows, outside: 'unavailable' };
  }
  if (days.length === 7 && from === undefined) return undefined;
  return {
    windows: [{ days, ...(from !== undefined && to !== undefined ? { from, to } : {}) }],
    outside: 'unavailable',
  };
}

/**
 * An add-on list (`complementos[]`): `min`, `max` (0 = no cap), `is_pizza` (the "Lista de
 * Sabores de Pizza"), `only_one` (each option once), and its options in `complements[]` (`price`
 * in reais, `max_quantity`, `is_invisible`, stock). Field names confirmed on live stores
 * (2026-10-01); a list that doesn't read hides the product.
 *
 * A pizza list charges every unit picked at the dearest pick's price (the storefront's item
 * total; ½ R$ 20 + ½ R$ 25,50 = R$ 51,00): n × dearest. Venduá's `most_expensive` charges the
 * dearest once, so it's exact only when n is fixed (min = max), with each price × n.
 */
function optionGroup(c: Raw): { group: ImportOptionGroup; exact: boolean } | 'empty' | null {
  const name = str(c.name).trim();
  if (!name || !Array.isArray(c.complements)) return null;
  const once = flag(c.only_one);
  const options: ImportOptionGroup['options'] = [];
  for (const o of [...list(c.complements)].sort(
    (a, b) => (intOf(a.order) ?? 0) - (intOf(b.order) ?? 0),
  )) {
    if (o.deleted_at || flag(o.is_invisible)) continue;
    const oname = str(o.name).trim();
    const cents = toCents(o.price ?? 0);
    if (!oname || cents === null) return null;
    const opt: ImportOptionGroup['options'][number] = { name: oname, priceDeltaCents: cents };
    // 0 or missing: we don't know it allows repeats, so it doesn't (never a price change)
    const qty = intOf(o.max_quantity);
    if (!once && qty !== null && qty > 1) opt.maxQty = qty;
    const d = str(o.description).trim();
    if (d) opt.description = d;
    const img = str(o.image);
    if (img) opt.imageUrl = img;
    if (flag(o.stock_control) && (intOf(o.stock) ?? 0) <= 0) opt.soldOut = true;
    options.push(opt);
  }
  const min = intOf(c.min) ?? 0;
  // every option hidden on the old store: an optional list just isn't there
  if (!options.length) return min > 0 ? null : 'empty';
  const max = intOf(c.max) ?? 0;
  if (min < 0 || max < 0) return null;
  const pizza = flag(c.is_pizza) && max !== 1;
  // max 0 is "no cap": the number of flavours varies
  const fixed = pizza && max > 0 && min === max;
  if (fixed) for (const o of options) o.priceDeltaCents *= min;
  return {
    group: {
      name,
      min,
      // validateDoc caps it at what the options add up to
      max: max === 0 ? 1000 : max,
      ...(pizza ? { pricingRule: 'most_expensive' as const } : {}),
      options,
    },
    exact: !pizza || fixed,
  };
}

// The storefront's checkout (its own code): one discount per order, the first that applies —
// store-wide `discount`, then `takeaway_discount` on pickup, then the payment's own; increments
// add on top. All are percents of the subtotal. Payment ids are the platform's fixed ones.
const CASH = [2];
const PIX = [1307, 46];
const DEBIT = [7];
const CREDIT = [8, 42, 49];
const VOUCHER = [45];

const LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'dinheiro',
  card_on_delivery: 'cartão',
  card_online: 'cartão online',
  meal_voucher: 'vale-refeição',
};

const pct = (raw: Raw, k: string) => {
  const n = Number(raw[k]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Per Venduá method, the signed percent every source method mapped to it carries; a method whose
 * source methods disagree, or that the old store priced in a way we can't repeat, is a note.
 */
function adjustments(
  raw: Raw,
  sources: { id: number; method: PaymentMethod }[],
  pickup: boolean,
  lost: Lost[],
): NonNullable<MenuImportV1['payments']>['adjustments'] {
  const storeWide = pct(raw, 'discount');
  const takeaway = pct(raw, 'takeaway_discount');
  // a pickup discount wins over the payment's own on pickup orders: the payment's isn't one rule
  const perMethod = storeWide === 0 && !(pickup && takeaway > 0);
  if (storeWide === 0 && pickup && takeaway > 0)
    lost.push({ scope: 'store', code: 'payment_adjustment', detail: 'retirada' });
  const discount = (id: number) =>
    storeWide > 0
      ? storeWide
      : !perMethod
        ? 0
        : CASH.includes(id)
          ? pct(raw, 'cash_discount')
          : PIX.includes(id)
            ? pct(raw, 'pix_discount')
            : DEBIT.includes(id)
              ? pct(raw, 'debit_card_discount')
              : 0;
  const increment = (id: number) =>
    DEBIT.includes(id)
      ? pct(raw, 'debt_increment')
      : CREDIT.includes(id)
        ? pct(raw, 'credit_increment')
        : VOUCHER.includes(id)
          ? pct(raw, 'ticket_increment')
          : 0;
  const missed = new Set<PaymentMethod>();
  // pickup orders got the pickup discount instead of these; a store-wide one replaces them always
  if (!perMethod && storeWide === 0)
    for (const { id, method } of sources)
      if (
        (CASH.includes(id) && pct(raw, 'cash_discount')) ||
        (PIX.includes(id) && pct(raw, 'pix_discount')) ||
        (DEBIT.includes(id) && pct(raw, 'debit_card_discount'))
      )
        missed.add(method);
  const net = new Map<PaymentMethod, Set<number>>();
  for (const { id, method } of sources) {
    const d = discount(id);
    const i = increment(id);
    // each is rounded on its own there; one net percent could land a cent apart
    if (d > 0 && i > 0) missed.add(method);
    // a percent finer than a basis point has no exact equivalent
    const bps = Math.round((i - d) * 100);
    if (Math.abs((i - d) * 100 - bps) > 1e-6) missed.add(method);
    const set = net.get(method) ?? new Set<number>();
    net.set(method, set.add(bps));
  }
  const out: NonNullable<MenuImportV1['payments']>['adjustments'] = {};
  for (const [method, set] of net) {
    const [bps] = [...set];
    if (missed.has(method) || set.size > 1 || Math.abs(bps!) > MAX_PERCENT_BPS)
      lost.push({ scope: 'store', code: 'payment_adjustment', detail: LABEL[method] });
    else if (bps) out[method] = { percentBps: bps };
  }
  return Object.keys(out).length ? out : undefined;
}

function hours(times: unknown, alwaysOpen: boolean): ImportWindow[] {
  if (alwaysOpen) return [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }];
  const shifts = isRaw(times) ? Object.values(times) : Array.isArray(times) ? times : [];
  const ranges: { day: number; open: string; close: string }[] = [];
  for (const t of shifts.flatMap((s) => list(s))) {
    const day = intOf(t.day);
    const open = hhmm(t.time_open);
    const close = hhmm(t.time_close);
    if (day !== null && open && close) ranges.push({ day, open, close });
  }
  return windowsOf(ranges);
}

const least = (...v: (number | null)[]) => {
  const xs = v.filter((x): x is number => x !== null);
  return xs.length ? Math.min(...xs) : null;
};

/**
 * `fee_type` picks the fee the storefront charges (its checkout code): −1 the neighbourhood
 * list (`fees[]`: `name`, `price`, `estimate`, `free_delivery`), −2 the km tiers (`feesKm[]`:
 * `km`, `price`, `estimate`, `price_free`, `no_delivery`), −3 a fee agreed after the order, any
 * other value a flat fee in reais. Stores keep the list they don't use, so only the live one is
 * read. Free delivery: subtotal ≥ a neighbourhood's `free_delivery`, subtotal > a tier's
 * `price_free`, or subtotal ≥ the store's `free_delivery`, whatever the fee.
 */
function zones(raw: Raw, lost: Lost[]): ImportZone[] | undefined {
  const fees = list(raw.fees).filter((f) => !f.deleted_at);
  const km = list(raw.feesKm).filter((k) => !k.deleted_at);
  const storeFree = positiveCents(raw.free_delivery);
  const type =
    raw.fee_type === null || raw.fee_type === undefined || raw.fee_type === ''
      ? null
      : Number(raw.fee_type);
  if (type === -3) {
    lost.push({ scope: 'store', code: 'delivery_fee_later' });
    return undefined;
  }
  if (type !== null && Number.isFinite(type) && type >= 0) {
    const fee = toCents(type);
    lost.push({
      scope: 'store',
      code: 'delivery_flat_fee',
      ...(fee !== null ? { detail: fee === 0 ? 'grátis' : reais(fee) } : {}),
    });
    return undefined;
  }
  // a store that predates fee_type: whichever list it has
  const useFees = type === -1 || (type === null && fees.length > 0);
  const useKm = type === -2 || (type === null && !fees.length);
  if (type !== null && !useFees && !useKm) {
    lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
    return undefined;
  }

  const out: ImportZone[] = [];
  if (useFees) {
    const byFee = new Map<
      string,
      { fee: number; free: number | null; t: ReturnType<typeof eta>; names: string[] }
    >();
    for (const f of fees) {
      const name = str(f.name).trim();
      const fee = toCents(f.price ?? 0);
      if (!name || fee === null) {
        lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
        return undefined;
      }
      const free = least(positiveCents(f.free_delivery), storeFree);
      const t = eta(f.estimate);
      const k = `${fee}|${free ?? ''}|${t.etaMin ?? ''}|${t.etaMax ?? ''}`;
      const e = byFee.get(k) ?? { fee, free, t, names: [] };
      e.names.push(name);
      byFee.set(k, e);
    }
    out.push(
      ...[...byFee.values()]
        .sort((a, b) => a.fee - b.fee || (a.free ?? 0) - (b.free ?? 0))
        .map(({ fee, free, t, names }) => ({
          name: fee === 0 ? 'Entrega grátis' : `Taxa ${reais(fee)}`,
          kind: 'neighborhood' as const,
          neighborhoods: names,
          feeCents: fee,
          ...t,
          ...(free !== null && fee > 0 ? { freeDeliveryOverCents: free } : {}),
        })),
    );
  }
  if (useKm) {
    const tiers: ImportZone[] = [];
    const gaps: number[] = [];
    for (const k of km) {
      const dist = Number(k.km);
      const fee = toCents(k.price ?? 0);
      if (!(dist > 0) || fee === null) {
        lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
        return out.length ? out : undefined;
      }
      if (flag(k.no_delivery)) {
        gaps.push(dist);
        continue;
      }
      // strictly above the tier's price_free: one cent past it in whole cents
      const tierFree = positiveCents(k.price_free);
      const free = least(tierFree === null ? null : tierFree + 1, storeFree);
      tiers.push({
        name: `Até ${String(dist).replace('.', ',')} km`,
        kind: 'radius',
        maxDistanceKm: dist,
        feeCents: fee,
        ...eta(k.estimate),
        ...(free !== null && fee > 0 ? { freeDeliveryOverCents: free } : {}),
      });
    }
    // "no delivery" past the farthest tier is just where delivery ends; inside it, a hole a
    // straight-line radius can't express
    const far = Math.max(0, ...tiers.map((t) => t.maxDistanceKm!));
    for (const g of gaps.filter((d) => d < far).sort((a, b) => a - b))
      lost.push({ scope: 'store', code: 'delivery_gap', detail: String(g).replace('.', ',') });
    if (tiers.length) lost.push({ scope: 'store', code: 'delivery_distance_straight_line' });
    out.push(...tiers.sort((a, b) => a.maxDistanceKm! - b.maxDistanceKm!));
  }
  return out.length ? out : undefined;
}

function product(item: Raw, group: Raw, lost: Lost[]): ImportProduct | null {
  if (item.deleted_at || flag(item.is_invisible)) return null;
  const name = str(item.name).trim();
  if (item.is_delivery === false || item.is_delivery === 0) {
    lost.push({ scope: 'product', subject: name, code: 'dine_in_only' });
    return null;
  }
  const sched = availability(item, group);
  if (sched === 'never') {
    lost.push({ scope: 'product', subject: name, code: 'never_available' });
    return null;
  }
  const p: ImportProduct = {
    ref: str(item.id),
    name,
    description: str(item.description),
    priceCents: toCents(item.price1 ?? 0) ?? -1,
    tags: [],
    images: [item.image, item.image_2, item.image_3, item.image_4, item.image_5]
      .map(str)
      .filter(Boolean),
    status: 'active',
    optionGroups: [],
  };
  const hide = (code: string, detail?: string) => {
    p.status = 'archived';
    lost.push({ scope: 'product', subject: name, code, ...(detail ? { detail } : {}) });
  };
  const strike = toCents(item.strike_price);
  if (strike !== null && strike > p.priceCents) p.compareAtPriceCents = strike;
  // a discount only through the item's own share link; the menu sells at price1
  if (Number(item.item_discount) > 0)
    lost.push({
      scope: 'product',
      subject: name,
      code: 'link_discount',
      detail: String(Number(item.item_discount)),
    });
  // type 2: price1 is per kg and the quantity in grams
  if (intOf(item.type) === 2) hide('sold_by_weight');

  if (flag(item.is_newest)) p.tags.push('Novidade');
  if (flag(item.is_best_seller)) p.tags.push('Mais vendido');
  if (flag(item.is_highlight)) p.tags.push('Destaque');
  for (const t of [item.custom_tag, item.custom_tag2, item.custom_tag3])
    if (str(t)) p.tags.push(str(t));

  if (flag(item.stock_control)) p.stockQuantity = Math.max(0, intOf(item.stock) ?? 0);
  if (sched) p.availability = sched;
  if (flag(item.requires_schedule)) p.requiresPreorder = true;
  if ((intOf(item.minimum_quantity) ?? 0) > 1)
    lost.push({
      scope: 'product',
      subject: name,
      code: 'minimum_quantity',
      detail: String(item.minimum_quantity),
    });
  if (flag(item.free_delivery))
    lost.push({ scope: 'product', subject: name, code: 'free_delivery' });

  for (const c of list(item.complementos)) {
    if (c.deleted_at) continue;
    const g = optionGroup(c);
    if (g === 'empty') continue;
    if (!g) {
      hide('options_unreadable', str(c.name) || undefined);
      continue;
    }
    // a pizza list where the number of flavours varies: n × dearest has no rule here
    if (!g.exact) hide('pizza_pricing', g.group.name);
    p.optionGroups.push(g.group);
  }

  liftFloor(p);

  // price2 and a pizza category's size1/size2 are never read by the storefront: it charges price1
  return p;
}

function storeLost(raw: Raw, lost: Lost[]) {
  const rewards = list(raw.rewards).length;
  if (flag(raw.loyalt_program) || rewards)
    lost.push({ scope: 'store', code: 'loyalty', ...(rewards ? { detail: String(rewards) } : {}) });
  if (flag(raw.cashback_program)) lost.push({ scope: 'store', code: 'cashback' });
  if (flag(raw.referrals)) lost.push({ scope: 'store', code: 'referral' });
  if ((intOf(raw.instagram_points) ?? 0) > 0)
    lost.push({ scope: 'store', code: 'instagram_points' });
  if (flag(raw.automation) && str(raw.automation_text))
    lost.push({ scope: 'store', code: 'birthday_message' });
  if (str(raw.miss_you_text)) lost.push({ scope: 'store', code: 'miss_you_message' });
  if (raw.upsell_item_id) lost.push({ scope: 'store', code: 'upsell' });
  const slot = intOf(raw.schedule_interval) ?? 0;
  if (slot > 0) lost.push({ scope: 'store', code: 'time_slots', detail: String(slot) });
  if ((intOf(raw.coupons) ?? 0) > 0) lost.push({ scope: 'store', code: 'coupons' });
  if (Number(raw.night_extra_value) > 0) lost.push({ scope: 'store', code: 'night_fee' });
  if (flag(raw.eat_inplace)) lost.push({ scope: 'store', code: 'dine_in' });
  if (isRaw(raw.has_mercadopago_active) && flag(raw.has_mercadopago_active.active))
    lost.push({ scope: 'store', code: 'online_payment' });
}

export const instadelivery: Adapter = {
  platform: 'instadelivery',
  hosts: { api: [API], images: CDN },

  match(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'instadelivery.com.br') return null;
    const slug = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (!slug || !/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(slug) || RESERVED.has(slug)) return null;
    return { ref: slug };
  },

  async read(ref: string, http: ImportHttp) {
    const raw = await http.json(`https://${API}/api/stores/by-slug/${encodeURIComponent(ref)}`);
    if (!isRaw(raw) || raw.id === undefined) throw new ImportFailure('NOT_FOUND', 'no store');
    if (!Array.isArray(raw.groups)) throw new ImportFailure('UNREADABLE', 'no groups');
    return raw;
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const lost: Lost[] = [];
    const design = isRaw(raw.design) ? raw.design : {};

    const welcome = (str(raw.public_message) || str(raw.top_message))
      .replace(/<br\s*\/?>/gi, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const categories = [...list(raw.groups)]
      .filter((g) => !g.deleted_at && !flag(g.is_invisible))
      .sort((a, b) => (intOf(a.order) ?? 0) - (intOf(b.order) ?? 0))
      .map((g) => {
        const name = str(g.name).trim();
        const items = [...list(g.itens)].sort(
          (a, b) => (intOf(a.order) ?? 0) - (intOf(b.order) ?? 0),
        );
        const products = items
          .map((i) => product(i, g, lost))
          .filter((p): p is ImportProduct => p !== null);
        if (!products.length)
          lost.push({
            scope: 'category',
            subject: name,
            code: 'hidden_items',
            ...(str(g.description) ? { detail: str(g.description) } : {}),
          });
        if (str(g.image)) lost.push({ scope: 'category', subject: name, code: 'category_image' });
        if (flag(g.is_pizza) && products.length)
          lost.push({ scope: 'category', subject: name, code: 'pizza_flavours' });
        return { name, description: str(g.description), products };
      });

    storeLost(raw, lost);

    const methods: PaymentMethod[] = [];
    const sources: { id: number; method: PaymentMethod }[] = [];
    for (const m of list(raw.payment_methods)) {
      if (m.external_visible !== undefined && !flag(m.external_visible)) continue;
      const method = methodOf(str(m.name));
      if (method) {
        if (!methods.includes(method)) methods.push(method);
        sources.push({ id: intOf(m.real_id) ?? intOf(m.id) ?? 0, method });
      } else lost.push({ scope: 'store', code: 'payment_method', detail: str(m.name) });
    }

    const key = str(raw.pix).trim();
    const type = key ? pixType(str(raw.pix_type), key) : null;
    if (key && !type) lost.push({ scope: 'store', code: 'pix_unreadable' });

    const takeOut = flag(raw.take_out);
    const adjusted = adjustments(raw, sources, takeOut, lost);
    const zoneList = zones(raw, lost);
    const prep =
      intOf(takeOut && !zoneList ? raw.wait_time_takeaway : raw.wait_time) || intOf(raw.wait_time);

    return {
      v: 1,
      source,
      store: {
        name: str(raw.name),
        tagline: str(raw.type_name),
        ...(welcome.length
          ? { announcement: { title: welcome[0]!, body: welcome.slice(1).join(' ') } }
          : {}),
        whatsapp: str(raw.whatsapp) || str(raw.phone),
        instagram: str(raw.instagram_nickname) || str(raw.instagram),
        address: str(raw.address),
        city: str(raw.city),
        logoUrl: str(design.logo),
        coverUrl: str(design.background),
        ...((c) => (c ? { brandColor: c } : {}))(
          colour(design.buttons_color) ??
            colour(design.groups_header_color) ??
            colour(design.groups_title_color),
        ),
      },
      hours: hours(raw.times, flag(raw.always_open)),
      operations: {
        ...((m) => (m !== null ? { minOrderCents: m } : {}))(toCents(raw.minimum_order ?? 0)),
        ...(prep && prep > 0 ? { prepTimeMinutes: prep } : {}),
        pickup: takeOut,
        delivery: !!zoneList?.length,
      },
      ...(zoneList ? { zones: zoneList } : {}),
      payments: {
        methods,
        ...(adjusted ? { adjustments: adjusted } : {}),
        ...(key && type
          ? {
              pix: {
                key,
                type,
                beneficiary: str(raw.pix_infos) || str(raw.name),
                city: str(raw.city),
              },
            }
          : {}),
      },
      categories,
      lost,
    };
  },
};
