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
  type PixKeyType,
  type SourceInfo,
} from '../doc.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
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
const HHMM = /^([01]\d|2[0-3]):[0-5]\d/;

const hhmm = (v: unknown): string | null => {
  const m = HHMM.exec(str(v));
  return m ? m[0] : null;
};

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

const first = (o: Raw, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

const truthy = (v: unknown) =>
  v !== null &&
  v !== undefined &&
  v !== false &&
  v !== 0 &&
  v !== '0' &&
  v !== '' &&
  !(Array.isArray(v) && v.length === 0);

const intOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

/**
 * An add-on list (`complementos[]`): `min`, `max` (0 = no cap), `is_pizza` (the "Lista de
 * Sabores de Pizza": several flavours charge the dearest), `only_one` (each option once), and
 * its options in `complements[]` (`price` in reais, `max_quantity`, `is_invisible`, stock).
 * Field names confirmed on live stores (2026-10-01); a list that doesn't read hides the product.
 */
function optionGroup(c: Raw): ImportOptionGroup | 'empty' | null {
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
  return {
    name,
    min,
    // validateDoc caps it at what the options add up to
    max: max === 0 ? 1000 : max,
    ...(flag(c.is_pizza) && max !== 1 ? { pricingRule: 'most_expensive' as const } : {}),
    options,
  };
}

/** "40", "30-50", "30 a 50 min" → minutes; anything else none. */
function eta(v: unknown): { etaMin?: number; etaMax?: number } {
  const m = /^\s*(\d{1,4})(?:\s*(?:-|a|até)\s*(\d{1,4}))?\s*(?:min|minutos)?\s*$/i.exec(str(v));
  if (!m) return {};
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return lo <= hi && hi <= 1440 ? { etaMin: lo, etaMax: hi } : {};
}

const ADJUSTMENTS: [string, string][] = [
  ['pix_discount', 'Pix'],
  ['cash_discount', 'dinheiro'],
  ['debit_card_discount', 'cartão de débito'],
  ['debt_increment', 'cartão de débito'],
  ['credit_increment', 'cartão de crédito'],
  ['ticket_increment', 'vale-refeição'],
  ['takeaway_discount', 'retirada'],
  ['discount', 'pedido'],
];

function methodOf(name: string): PaymentMethod | null {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\bpix\b/.test(n)) return 'pix';
  if (/dinheiro|especie/.test(n)) return 'cash';
  if (/vale|ticket|sodexo|alelo|pluxee|\bvr\b|refeicao|alimentacao|\bben\b|flash|caju/.test(n))
    return 'meal_voucher';
  if (/cartao|credito|debito|maquin|\belo\b|visa|master/.test(n)) return 'card_on_delivery';
  return null;
}

function pixType(type: string, key: string): PixKeyType | null {
  const t = type.toLowerCase();
  const digits = key.replace(/\D/g, '');
  if (/mail/.test(t) || key.includes('@')) return 'email';
  if (/aleat|random|evp/.test(t) || /^[0-9a-f-]{36}$/i.test(key.trim())) return 'random';
  if (/telefone|celular|phone/.test(t)) return 'phone';
  if (/cpf|cnpj/.test(t) || /^[\d.\-/ ]+$/.test(key.trim())) {
    if (digits.length === 11) return 'cpf';
    if (digits.length === 14) return 'cnpj';
  }
  return null;
}

/** "#######" is the platform's "no colour"; anything else must be a 6-digit hex. */
const colour = (v: unknown): string | null => {
  const s = str(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return null;
};

function hours(times: unknown, alwaysOpen: boolean): ImportWindow[] {
  if (alwaysOpen) return [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }];
  const shifts = isRaw(times) ? Object.values(times) : Array.isArray(times) ? times : [];
  const byRange = new Map<string, Set<number>>();
  for (const t of shifts.flatMap((s) => list(s))) {
    const day = intOf(t.day);
    const open = hhmm(t.time_open);
    const close = hhmm(t.time_close);
    if (day === null || day < 0 || day > 6 || !open || !close || open === close) continue;
    const k = `${open}-${close}`;
    byRange.set(k, (byRange.get(k) ?? new Set()).add(day));
  }
  return [...byRange.entries()]
    .map(([k, days]) => {
      const [open, close] = k.split('-') as [string, string];
      return { days: [...days].sort((a, b) => a - b), open, close };
    })
    .sort((a, b) => a.days[0]! - b.days[0]! || a.open.localeCompare(b.open));
}

/**
 * Neighbourhood fees (`fees[]`: `name`, `price`, `estimate`) become one zone per fee and time;
 * km tiers (`feesKm[]`: `km`, `price`, `estimate`) become radius zones. Free-delivery rules and
 * "no delivery" tiers aren't copied (their exact meaning isn't confirmed): they're noted.
 */
function zones(raw: Raw, lost: Lost[]): ImportZone[] | undefined {
  const fees = list(raw.fees).filter((f) => !f.deleted_at);
  const km = list(raw.feesKm).filter((k) => !k.deleted_at);
  if (!fees.length && !km.length) return undefined;
  let rules = false;
  const byFee = new Map<string, { fee: number; t: ReturnType<typeof eta>; names: string[] }>();
  for (const f of fees) {
    const name = str(f.name).trim();
    const fee = toCents(f.price ?? 0);
    if (!name || fee === null) {
      lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
      return undefined;
    }
    if (truthy(f.free_delivery)) rules = true;
    const t = eta(f.estimate);
    const k = `${fee}|${t.etaMin ?? ''}|${t.etaMax ?? ''}`;
    const e = byFee.get(k) ?? { fee, t, names: [] };
    e.names.push(name);
    byFee.set(k, e);
  }
  const out: ImportZone[] = [...byFee.values()]
    .sort((a, b) => a.fee - b.fee)
    .map(({ fee, t, names }) => ({
      name: fee === 0 ? 'Entrega grátis' : `Taxa R$ ${(fee / 100).toFixed(2).replace('.', ',')}`,
      kind: 'neighborhood',
      neighborhoods: names,
      feeCents: fee,
      ...t,
    }));
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
    if (truthy(k.price_free)) rules = true;
    tiers.push({
      name: `Até ${String(dist).replace('.', ',')} km`,
      kind: 'radius',
      maxDistanceKm: dist,
      feeCents: fee,
      ...eta(k.estimate),
    });
  }
  // "no delivery" past the farthest tier is just where delivery ends; inside it, a hole a
  // straight-line radius can't express
  const far = Math.max(0, ...tiers.map((t) => t.maxDistanceKm!));
  for (const g of gaps.filter((d) => d < far).sort((a, b) => a - b))
    lost.push({ scope: 'store', code: 'delivery_gap', detail: String(g).replace('.', ',') });
  if (rules) lost.push({ scope: 'store', code: 'free_delivery_rule' });
  if (tiers.length) lost.push({ scope: 'store', code: 'delivery_distance_straight_line' });
  const all = [...out, ...tiers.sort((a, b) => a.maxDistanceKm! - b.maxDistanceKm!)];
  return all.length ? all : undefined;
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
  if (Number(item.item_discount) > 0) hide('promo_unreadable');

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
    p.optionGroups.push(g);
  }

  // "a partir de": the price lives in one required single-choice list — move its floor up
  if (p.priceCents === 0) {
    const req = p.optionGroups.find(
      (g) =>
        g.min >= 1 &&
        (g.max === 1 || g.pricingRule === 'most_expensive') &&
        g.options.every((o) => o.priceDeltaCents > 0),
    );
    if (req) {
      const floor = Math.min(...req.options.map((o) => o.priceDeltaCents));
      p.priceCents = floor;
      for (const o of req.options) o.priceDeltaCents -= floor;
    }
  }

  // a pizza category priced by size (size1/size2 with price1/price2), or a second price we
  // can't place: which one the old store charges depends on choices we don't carry over
  if (flag(group.is_pizza) && (group.size1 || group.size2 || intOf(group.size)))
    hide('pizza_sizes');
  else if ((toCents(item.price2) ?? 0) > 0 && toCents(item.price2) !== p.priceCents)
    hide('second_price');
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
    for (const m of list(raw.payment_methods)) {
      if (m.external_visible !== undefined && !flag(m.external_visible)) continue;
      const method = methodOf(str(m.name));
      if (method) {
        if (!methods.includes(method)) methods.push(method);
      } else lost.push({ scope: 'store', code: 'payment_method', detail: str(m.name) });
    }
    for (const [k, label] of ADJUSTMENTS)
      if (Number(raw[k]) > 0)
        lost.push({ scope: 'store', code: 'payment_adjustment', detail: label });

    const key = str(raw.pix).trim();
    const type = key ? pixType(str(raw.pix_type), key) : null;
    if (key && !type) lost.push({ scope: 'store', code: 'pix_unreadable' });

    const takeOut = flag(raw.take_out);
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
