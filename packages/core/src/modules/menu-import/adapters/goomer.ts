// Goomer: the store's info (settings as ~180 `mm_*` keys, many holding JSON strings), the menu
// URL it names, then one option-group request per product (docs/menu-import.md Appendix A,
// checked 2026-10-01). Reais as numbers. What shows follows its webmenu bundle, read 2026-10-01.

import {
  toCents,
  type ImportCategory,
  type ImportOptionGroup,
  type ImportProduct,
  type ImportZone,
  type Lost,
  type MenuImportV1,
  type PaymentMethod,
  type PixKeyType,
  type SourceInfo,
} from '../doc.ts';
import { ImportFailure, type ImportHttp } from '../http.ts';
import { normalizePixKey } from '../../pix.ts';
import {
  colour,
  liftFloor,
  numOf,
  pool,
  positiveCents,
  reais,
  sizeGroup,
  windowsOf,
} from './shared.ts';
import { isRaw, list, str, type Adapter, type Raw } from './types.ts';

const API = 'api-go.goomer.app';
const WWW = 'www.goomer.app';
const MOBILE = 'mobile.goomer.app';
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
// the platform's own hosts and pages, not a store
const RESERVED = new Set([
  'www',
  'api',
  'api-go',
  'mobile',
  'static',
  'ssr-api',
  'blog',
  'app',
  'admin',
  'painel',
  'ajuda',
  'help',
  'status',
  'webmenu',
  '_next',
]);
const RETRY_MS = 1_000;
const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
// the platform's default welcome, not the merchant's words
const DEFAULT_WELCOME = 'continue pedindo sua comida favorita!';

/** Settings hold booleans as "true"/"false" and objects as JSON strings. */
const on = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
const parsed = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  if (!v.trim()) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** "18:0" → "18:00", as the webmenu pads them. */
const clock = (v: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(str(v).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60
    ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    : null;
};

/**
 * Store hours as the webmenu reads them: a row covers a weekday range (wrapping past Saturday);
 * on each of those days it is open between `open` and `close`, or — when close comes first —
 * that day's early hours and its evening; 00:00–00:00 is all day. None at all: always open.
 */
function hours(rows: Raw[]) {
  if (!rows.length)
    return windowsOf([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '23:59' })));
  const ranges: { day: number; open: string; close: string }[] = [];
  for (const r of rows) {
    const from = DAYS.indexOf(str(r.from).toLowerCase().replace('á', 'a'));
    const to = DAYS.indexOf(str(r.to).toLowerCase().replace('á', 'a'));
    const open = clock(r.open);
    const close = clock(r.close);
    if (from < 0 || to < 0 || !open || !close) continue;
    const days: number[] = [];
    for (let d = from; ; d = (d + 1) % 7) {
      days.push(d);
      if (d === to) break;
    }
    for (const day of days) {
      if (open === '00:00' && close === '00:00') ranges.push({ day, open, close: '23:59' });
      else if (open < close) ranges.push({ day, open, close });
      else if (open > close) {
        if (close > '00:00') ranges.push({ day, open: '00:00', close });
        ranges.push({ day, open, close: '23:59' });
      }
    }
  }
  return windowsOf(ranges);
}

/**
 * A list: one pick when min and max are 1, a quantity per option when `repeat` (the units add
 * up to the max), else distinct options; every pick adds its price.
 */
function optionGroup(g: Raw): ImportOptionGroup | 'empty' | null {
  const name = str(g.name).trim();
  if (!name || !Array.isArray(g.options)) return null;
  const min = Math.max(0, Math.trunc(numOf(g.min) ?? 0));
  const rawMax = Math.trunc(numOf(g.max) ?? 0);
  const max = rawMax > 0 ? rawMax : 99;
  const repeat = on(g.repeat);
  const options: ImportOptionGroup['options'] = [];
  for (const o of list(g.options)) {
    const oname = str(o.name).trim();
    const cents = toCents(o.price ?? 0);
    if (!oname || cents === null) return null;
    options.push({
      name: oname,
      priceDeltaCents: cents,
      ...(repeat && max > 1 ? { maxQty: max } : {}),
    });
  }
  if (!options.length) return min > 0 ? null : 'empty';
  return { name, min, max, options };
}

function product(p: Raw, groups: unknown, lost: Lost[]): ImportProduct | null {
  const name = str(p.name).trim();
  if (!name) return null;
  const prices = list(p.prices);
  const cents = prices.map((x) => toCents(x.price ?? 0));
  const images = isRaw(p.images) ? p.images : {};
  const out: ImportProduct = {
    ref: str(p.id),
    name,
    description: str(p.description).trim(),
    priceCents: 0,
    tags: [],
    images: [str(images.large) || str(images.medium) || str(images.small)].filter(Boolean),
    status: 'active',
    optionGroups: [],
  };
  if (!prices.length || cents.some((c) => c === null)) {
    out.priceCents = -1;
  } else if (prices.length === 1) {
    out.priceCents = cents[0]!;
  } else {
    // several prices are one pick there, "Escolha 1 opção", each its whole price
    const g = sizeGroup(
      prices.map((x, i) => ({ name: str(x.name).trim() || `Opção ${i + 1}`, cents: cents[i]! })),
      'Escolha 1 opção',
    )!;
    out.priceCents = g.baseCents;
    out.optionGroups.push(g.group);
  }
  if (groups === null) {
    out.status = 'archived';
    lost.push({ scope: 'product', subject: name, code: 'options_unreadable' });
  }
  for (const g of list(groups)) {
    const r = optionGroup(g);
    if (r === 'empty') continue;
    if (!r) {
      out.status = 'archived';
      lost.push({
        scope: 'product',
        subject: name,
        code: 'options_unreadable',
        detail: str(g.name),
      });
      continue;
    }
    out.optionGroups.push(r);
  }
  liftFloor(out);
  // the webmenu asks "Maior de 18?" at checkout
  if (p.limit_age === true) lost.push({ scope: 'product', subject: name, code: 'adults_only' });
  return out;
}

/** A Pix key with no type beside it: only the shapes that can't be two things. */
function pixOf(info: unknown, city: string): NonNullable<MenuImportV1['payments']>['pix'] | null {
  const o = parsed(info);
  if (!isRaw(o)) return null;
  const key = str(o.key).trim();
  const digits = key.replace(/\D/g, '');
  let type: PixKeyType | null = null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) type = 'email';
  else if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)) type = 'random';
  else if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(key)) type = 'cpf';
  else if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(key)) type = 'cnpj';
  // eleven bare digits are a CPF or a mobile number: not guessed
  else if (
    /^\+?[\d\s().-]+$/.test(key) &&
    (key.startsWith('+') || key.includes('(') || digits.length !== 11)
  )
    type = 'phone';
  // and a key Venduá couldn't charge to never stands in for the store's
  if (!type || !normalizePixKey(key, type)) return null;
  return { key, type, beneficiary: str(o.accountName).trim(), ...(city ? { city } : {}) };
}

const fee = (v: unknown): number | 'free' | 'ask' | null => {
  const s = str(v).trim().toLowerCase();
  if (s === 'free') return 'free';
  if (s === 'ask') return 'ask';
  return toCents(v ?? 0);
};

function zones(
  s: Raw,
  extra: { minOrderCents?: number; freeOverCents?: number },
  lost: Lost[],
): ImportZone[] | undefined {
  const type = str(s.mm_delivery_zone_type) || 'static';
  if (type === 'static') {
    const st = parsed(s.mm_delivery_zone_options_static);
    // none set: the old single fee when it's on, else "taxa a combinar"
    const f =
      isRaw(st) && 'pricing' in st
        ? fee(st.pricing)
        : on(s.mm_delivery_fee_enabled)
          ? fee(s.mm_delivery_fee ?? 0)
          : 'ask';
    if (f === 'ask') lost.push({ scope: 'store', code: 'delivery_fee_later' });
    else if (f === null) lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
    else
      lost.push({
        scope: 'store',
        code: 'delivery_flat_fee',
        detail: f === 'free' || f === 0 ? 'grátis' : reais(f),
      });
    return undefined;
  }
  if (type !== 'dynamic') {
    // neighbourhoods are kept by an id of Goomer's own address lookup, not by name
    lost.push({ scope: 'store', code: 'delivery_by_address' });
    return undefined;
  }
  const out: ImportZone[] = [];
  for (const z of list(parsed(s.mm_delivery_zone_options_dynamic))) {
    if (!on(z.status)) continue;
    const km = numOf(z.radius);
    const f = fee(z.pricing);
    if (km === null || !(km > 0) || f === null || f === 'ask') {
      lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
      return undefined;
    }
    const cents = f === 'free' ? 0 : f;
    const t = isRaw(z.time) ? z.time : {};
    const lo = numOf(t.from);
    const hi = numOf(t.to);
    out.push({
      name: `Até ${String(km).replace('.', ',')} km`,
      kind: 'radius',
      maxDistanceKm: km,
      feeCents: cents,
      ...(!on(z.hide_time) && lo !== null && lo > 0 ? { etaMin: lo } : {}),
      ...(!on(z.hide_time) && hi !== null && hi > 0 ? { etaMax: hi } : {}),
      ...(extra.minOrderCents ? { minOrderCents: extra.minOrderCents } : {}),
      ...(extra.freeOverCents && cents > 0 ? { freeDeliveryOverCents: extra.freeOverCents } : {}),
    });
  }
  if (!out.length) {
    // every band switched off: nowhere to deliver to there either
    lost.push({ scope: 'store', code: 'delivery_fees_unreadable' });
    return undefined;
  }
  // there the distance is the route Goomer's server measures
  lost.push({ scope: 'store', code: 'delivery_distance_straight_line' });
  return out.sort((a, b) => a.maxDistanceKm! - b.maxDistanceKm!);
}

function payments(s: Raw, lost: Lost[]): NonNullable<MenuImportV1['payments']> {
  const methods: PaymentMethod[] = [];
  if (on(s.mm_payment_cash_enabled)) methods.push('cash');
  if (on(s.mm_payment_credit_enabled) || on(s.mm_payment_debit_enabled))
    methods.push('card_on_delivery');
  if (on(s.mm_payment_voucher_enabled)) methods.push('meal_voucher');
  let pix: NonNullable<MenuImportV1['payments']>['pix'] | null = null;
  if (on(s.mm_payment_pix_enabled)) {
    methods.push('pix');
    const a = isRaw(s.address) ? s.address : {};
    pix = pixOf(s.mm_payment_pix_info, str(a.city).trim());
    if (!pix) lost.push({ scope: 'store', code: 'pix_unreadable' });
  }
  if (
    [
      'mm_payment_mpago_checkout_enabled',
      'mm_payment_mpago_link_enabled',
      'mm_payment_mpago_qrcode_enabled',
      'mm_payment_tuna_credit_card_checkout_enabled',
      'mm_payment_tuna_pix_checkout_enabled',
      'mm_payment_vrpague_link_enabled',
    ].some((k) => on(s[k]))
  )
    lost.push({ scope: 'store', code: 'online_payment' });
  return { methods, ...(pix ? { pix } : {}) };
}

const slugOf = (url: URL): string | null => {
  const host = url.hostname.toLowerCase();
  const sub = /^([a-z0-9][a-z0-9-]*)\.goomer\.app$/.exec(host)?.[1];
  if (sub && sub !== 'www') return SLUG.test(sub) && !RESERVED.has(sub) ? sub : null;
  if (host !== WWW && host !== 'goomer.app') return null;
  const first = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  return SLUG.test(first) && !RESERVED.has(first) ? first : null;
};

export const goomer: Adapter = {
  platform: 'goomer',
  hosts: { api: [API, WWW, MOBILE], images: [WWW, 'static.goomer.app'] },
  // one request per product: a large menu needs more than the default minute
  limits: { importMs: 150_000, requests: 600 },

  match(url) {
    const slug = slugOf(url);
    return slug ? { ref: slug } : null;
  },

  async read(ref: string, http: ImportHttp) {
    const doc = await http.json(`https://${API}/v2/establishments/${encodeURIComponent(ref)}/info`);
    if (!isRaw(doc) || !isRaw(doc.info) || !isRaw(doc.settings))
      throw new ImportFailure('UNREADABLE', 'no info');
    const settings = doc.settings;
    // the newer menu answers on another API we haven't checked
    if (on(settings.is_abrahao)) throw new ImportFailure('UNREADABLE', 'new menu');
    const menuUrl = str(doc.info.menu) || str(settings.menu_url);
    const m = /^https:\/\/www\.goomer\.app\/webmenu\/([a-z0-9-]+)\/menu\/(\d+)$/i.exec(menuUrl);
    // many stores are dormant: no menu, or an empty one
    if (!m || !on(settings.mm_enabled ?? true)) throw new ImportFailure('NOT_FOUND', 'no menu');
    const slug = m[1]!.toLowerCase();
    const menu = await http.json(menuUrl);
    const products = isRaw(menu) ? list(menu.products) : [];
    if (!products.length) throw new ImportFailure('NOT_FOUND', 'empty menu');
    // no product says whether it has lists: ask for each, a few at a time within the pacing
    const groups = await pool(products, 5, async (p) => {
      const id = numOf(p.id);
      const version = str(p.version);
      if (id === null || !/^[0-9a-z]+$/i.test(version)) return null;
      const url = `https://${MOBILE}/webmenu/${slug}/product/${id}/optiongroups/${version}`;
      // a passing server error is asked once more; a block or the deadline ends the read
      for (let attempt = 0; ; attempt++) {
        try {
          const g = await http.json(url);
          return isRaw(g) && Array.isArray(g.option_groups) ? g.option_groups : null;
        } catch (e) {
          if (!(e instanceof ImportFailure)) throw e;
          if (e.code === 'UNREADABLE' && attempt === 0) {
            await new Promise((r) => setTimeout(r, RETRY_MS));
            continue;
          }
          if (e.code === 'NOT_FOUND' || e.code === 'UNREADABLE') return null;
          throw e;
        }
      }
    });
    return { info: doc.info, settings, products, groups };
  },

  map(input: unknown, source: SourceInfo): MenuImportV1 {
    const raw = isRaw(input) ? input : {};
    const info = isRaw(raw.info) ? raw.info : {};
    const s = isRaw(raw.settings) ? raw.settings : {};
    const groups = Array.isArray(raw.groups) ? raw.groups : [];
    const lost: Lost[] = [];

    // a flat list; its categories in the order they first appear
    const byGroup = new Map<string, ImportCategory>();
    let upsell = false;
    list(raw.products).forEach((p, i) => {
      const key = str(p.group_id) || str(p.group_name);
      const cat = byGroup.get(key) ?? { name: str(p.group_name).trim(), products: [] };
      byGroup.set(key, cat);
      const out = product(p, groups[i] ?? null, lost);
      if (out) cat.products.push(out);
      if (Array.isArray(p.suggestions) && p.suggestions.length) upsell = true;
    });

    const deliveryOn = on(s.mm_delivery_enabled);
    const min = on(s.mm_delivery_minimum_value_enabled)
      ? positiveCents(s.mm_delivery_minimum_value)
      : null;
    const free = on(s.mm_free_delivery_enabled)
      ? positiveCents(s.mm_free_delivery_minimum_value)
      : null;
    const zoneList = deliveryOn
      ? zones(
          s,
          {
            ...(min ? { minOrderCents: min } : {}),
            // strictly above it there: one cent past it in whole cents
            ...(free ? { freeOverCents: free + 1 } : {}),
          },
          lost,
        )
      : undefined;
    if (deliveryOn && !zoneList && min)
      lost.push({ scope: 'store', code: 'delivery_minimum', detail: reais(min) });
    if (deliveryOn && !zoneList && free)
      lost.push({ scope: 'store', code: 'free_delivery_rule', detail: reais(free) });
    const pickup = on(s.mm_takeaway_enabled);
    if (pickup && on(s.mm_takeaway_discount_enabled) && (numOf(s.mm_takeaway_discount) ?? 0) > 0)
      lost.push({ scope: 'store', code: 'payment_adjustment', detail: 'retirada' });
    if (on(s.mm_coupon_enabled) && list(info.coupons).length)
      lost.push({ scope: 'store', code: 'coupons' });
    if (on(s.mm_order_scheduling_enabled)) lost.push({ scope: 'store', code: 'time_slots' });
    if (on(s.mm_in_store_enabled)) lost.push({ scope: 'store', code: 'dine_in' });
    if (upsell) lost.push({ scope: 'store', code: 'upsell' });

    const a = isRaw(s.address) ? s.address : {};
    const lat = numOf(a.latitude);
    const lng = numOf(a.longitude);
    const welcome = str(info.welcome_message || s.mm_splash_screen_message).trim();
    const prep = numOf(s.mm_takeaway_time);

    return {
      v: 1,
      source,
      store: {
        name: str(info.name) || str(s.name),
        ...(welcome && welcome.toLowerCase() !== DEFAULT_WELCOME
          ? { announcement: { title: welcome } }
          : {}),
        ...((w) => (w ? { whatsapp: w } : {}))(
          str(s.mm_whatsapp_phone_number).trim() || str(info.order_phone).trim(),
        ),
        address: [
          [str(a.street).trim(), str(a.number).trim()].filter(Boolean).join(', '),
          str(a.complement).trim().length > 1 ? str(a.complement).trim() : '',
          str(a.neighborhood).trim(),
        ]
          .filter(Boolean)
          .join(' - '),
        city: str(a.city).trim(),
        ...(lat !== null && lng !== null && (lat !== 0 || lng !== 0)
          ? { coords: { lat, lng } }
          : {}),
        logoUrl: str(info.logo) || str(s.mm_logo_url),
        ...((c) => (c ? { brandColor: c } : {}))(colour(s.mm_main_color)),
      },
      hours: hours(list(info.hours)),
      operations: {
        ...(prep !== null && prep > 0 ? { prepTimeMinutes: Math.round(prep) } : {}),
        pickup,
        delivery: deliveryOn && !!zoneList,
      },
      ...(zoneList ? { zones: zoneList } : {}),
      payments: payments(s, lost),
      categories: [...byGroup.values()],
      lost,
    };
  },
};
