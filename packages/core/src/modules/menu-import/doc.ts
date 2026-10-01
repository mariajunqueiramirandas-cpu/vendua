// The import document (docs/menu-import.md §4.3): what an adapter read, in Venduá's terms, and
// the one place Venduá's limits are applied to it. Money is integer cents from here on.

import {
  MAX_FIXED_CENTS,
  MAX_PERCENT_BPS,
  isPaymentMethod,
  type PaymentMethod,
} from '../payment-adjustments.ts';
import { instagramHandle, whatsappDigits } from '../store.ts';

export type { PaymentMethod };
// contacts take the store's own rules, so an import stores what /storefront/v1/store serves
export { instagramHandle, whatsappDigits as normalizeWhatsapp };

export const PLATFORMS = [
  'instadelivery',
  'cardapioweb',
  'olaclick',
  'deliverydireto',
  'takeat',
  'saipos',
  'goomer',
  'anotaai',
  'ifood',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Settings the merchant ticks; the catalog itself is always applied. */
export const SECTIONS = ['profile', 'hours', 'delivery', 'payments'] as const;
export type Section = (typeof SECTIONS)[number];

export const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

/** 0 = domingo … 6 = sábado; close < open runs past midnight (store hours only). */
export interface ImportWindow {
  days: number[];
  open: string;
  close: string;
}

export interface ImportZone {
  name: string;
  kind: 'neighborhood' | 'radius' | 'polygon';
  neighborhoods?: string[];
  maxDistanceKm?: number;
  /** [lat, lng] ring */
  polygon?: [number, number][];
  feeCents: number;
  feePerKmCents?: number;
  minOrderCents?: number;
  etaMin?: number;
  etaMax?: number;
  freeDeliveryOverCents?: number;
}

export interface ImportOption {
  name: string;
  priceDeltaCents: number;
  /** "2x coco"; default 1 */
  maxQty?: number;
  description?: string;
  /** source CDN; re-hosted by images.ts */
  imageUrl?: string;
  soldOut?: boolean;
}

export interface ImportOptionGroup {
  name: string;
  min: number;
  max: number;
  pricingRule?: 'sum' | 'average' | 'most_expensive';
  options: ImportOption[];
}

export interface ImportKit {
  slots: {
    name: string;
    min: number;
    max: number;
    qtyPerItem?: number;
    /** `ref` of another product in this document */
    items: { ref: string; priceDeltaCents?: number }[];
  }[];
}

export interface ImportSchedule {
  windows: { days: number[]; from?: string; to?: string }[];
  outside: 'unavailable' | 'hidden';
}

export interface ImportProduct {
  /** the source's id, for kit references; never shown */
  ref?: string;
  name: string;
  description?: string;
  /** the selling price: a promo price lands here */
  priceCents: number;
  /** the old, struck-through price; must be > priceCents */
  compareAtPriceCents?: number;
  /** badges: "Novidade", "Mais vendido", … */
  tags: string[];
  /** source CDN URLs, at most 12 */
  images: string[];
  status: 'active' | 'sold_out' | 'archived';
  /** null/absent = not tracked */
  stockQuantity?: number | null;
  availability?: ImportSchedule;
  /** a lower price on some weekdays and hours (store time); applies while below priceCents */
  promoSchedule?: { priceCents: number; windows: ImportSchedule['windows'] };
  requiresPreorder?: boolean;
  optionGroups: ImportOptionGroup[];
  kit?: ImportKit;
}

export interface ImportCategory {
  name: string;
  description?: string;
  products: ImportProduct[];
}

/** What didn't come over; the admin owns the pt-BR copy for each code. */
export interface Lost {
  scope: 'store' | 'category' | 'product';
  /** category or product name */
  subject?: string;
  code: string;
  detail?: string;
}

export interface SourceInfo {
  platform: Platform;
  url: string;
  ref: string;
  readAt: string;
}

export interface MenuImportV1 {
  v: 1;
  source: SourceInfo;
  store: {
    name?: string;
    tagline?: string;
    announcement?: { title: string; body?: string };
    whatsapp?: string;
    instagram?: string;
    address?: string;
    city?: string;
    coords?: { lat: number; lng: number };
    logoUrl?: string;
    coverUrl?: string;
    /** one colour; the token set is derived with paletteFrom */
    brandColor?: string;
  };
  hours?: ImportWindow[];
  operations?: {
    minOrderCents?: number;
    prepTimeMinutes?: number;
    pickup?: boolean;
    delivery?: boolean;
  };
  zones?: ImportZone[];
  payments?: {
    methods: PaymentMethod[];
    adjustments?: Partial<Record<PaymentMethod, { percentBps?: number; fixedCents?: number }>>;
    pix?: { key: string; type: PixKeyType; beneficiary: string; city?: string };
  };
  categories: ImportCategory[];
  lost: Lost[];
}

export interface ImportCounts {
  categories: number;
  products: number;
  hidden: number;
  photos: number;
  optionGroups: number;
  hours: number;
  zones: number;
  paymentMethods: number;
  pix: boolean;
  logo: boolean;
  cover: boolean;
  lost: number;
}

// ── money ───────────────────────────────────────────────────────────────────

/**
 * The only reais → cents conversion. Floats round (`12.9` → 1290); strings parse exactly
 * ("12.90", "12,90", "1.234,56"). null when it isn't a non-negative amount.
 */
export function toCents(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    return Math.round(v * 100);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^r\$\s*/i, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const at = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let whole = s;
  let frac = '';
  if (at >= 0) {
    const sep = s[at]!;
    const other = sep === '.' ? ',' : '.';
    const after = s.slice(at + 1);
    const seps = s.split(sep).length - 1;
    if (s.includes(other)) {
      // "1.234,56": the last separator is the decimal one, the other only groups thousands
      whole = s.slice(0, at);
      frac = after;
      if (!new RegExp(`^\\d{1,3}(\\${other}\\d{3})*$`).test(whole)) return null;
    } else if (seps > 1) {
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) return null;
    } else if (after.length === 3) {
      // "1.234" or "12,345": thousands or three decimals — not guessed
      return null;
    } else {
      whole = s.slice(0, at);
      frac = after;
    }
  }
  if (frac.length > 2 || (at >= 0 && frac === '' && whole !== s)) return null;
  const cents = Number(whole.replace(/[.,]/g, '')) * 100 + Number(frac.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

// ── limits (§4.6: truncate, don't fail) ─────────────────────────────────────

export const LIMITS = {
  products: 1000,
  docBytes: 2 * 1024 * 1024,
  categoryName: 60,
  categoryDescription: 500,
  productName: 120,
  productDescription: 1000,
  tags: 12,
  tag: 30,
  photos: 12,
  groups: 12,
  options: 100,
  groupName: 60,
  optionName: 60,
  optionDescription: 200,
  optionMaxQty: 20,
  price: 10_000_000,
  kitSlots: 8,
  kitSlotName: 80,
  kitItems: 40,
  kitDelta: 100_000,
  scheduleWindows: 7,
  hours: 28,
  neighborhoods: 200,
  zones: 100,
  zoneName: 80,
  neighborhood: 120,
  storeName: 80,
  tagline: 120,
  announcementTitle: 80,
  announcementBody: 200,
  instagram: 60,
  city: 80,
  address: 300,
  pixBeneficiary: 25,
  pixCity: 15,
  pixKey: 77,
  url: 1000,
} as const;

export class TooLarge extends Error {}

/** An upper bound on `octet_length(doc::text)`: UTF-8 bytes, plus the space jsonb's text form
 *  puts after every `:` and `,` (counting those inside strings too keeps it conservative). */
export function storedBytes(v: unknown): number {
  const json = JSON.stringify(v);
  let seps = 0;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    if (ch === 44 || ch === 58) seps++;
  }
  return Buffer.byteLength(json) + seps;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Collapses whitespace and strips tags/control characters a source may carry. */
export function clean(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]{0,200}>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A note quotes merchant-typed labels, where a CNPJ, phone or e-mail sometimes sits. */
const noIds = (s: string) =>
  s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '…')
    .replace(/[(+]?\d[\d.\-/() ]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '…' : m));

/** Cut to `max` characters, on a word boundary when one is near. */
export function cut(s: string, max: number, onWord = false): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  if (onWord) {
    const sp = out.lastIndexOf(' ');
    if (sp > max * 0.6) out = out.slice(0, sp);
    out = out.replace(/[\s,.;:–-]+$/, '');
    if (out.length < max) out += '…';
  }
  return out.trim();
}

export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMITS.url) return null;
  try {
    const u = new URL(v.trim());
    // the normalised form is what gets stored: percent-encoding can lengthen it
    return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= LIMITS.url
      ? u.href
      : null;
  } catch {
    return null;
  }
}

function validDays(days: unknown): number[] | null {
  if (!Array.isArray(days)) return null;
  const out = [...new Set(days)].filter(
    (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  return out.length ? out.sort((a, b) => a - b) : null;
}

function schedule(s: ImportSchedule | undefined): ImportSchedule | undefined | 'overflow' {
  if (!s) return undefined;
  const windows: ImportSchedule['windows'] = [];
  for (const w of s.windows) {
    const days = validDays(w.days);
    if (!days) continue;
    if (w.from === undefined && w.to === undefined) windows.push({ days });
    else if (w.from && w.to && HHMM.test(w.from) && HHMM.test(w.to) && w.from < w.to)
      windows.push({ days, from: w.from, to: w.to });
  }
  if (!windows.length) return undefined;
  if (windows.length > LIMITS.scheduleWindows) return 'overflow';
  return { windows, outside: s.outside === 'hidden' ? 'hidden' : 'unavailable' };
}

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Brings a document within Venduá's limits and records each cut in `lost`. A product whose
 * price Venduá would compute differently is kept but hidden (`archived`), never repriced.
 * Throws TooLarge only for an oversized store.
 */
export function validateDoc(input: MenuImportV1): { doc: MenuImportV1; counts: ImportCounts } {
  const lost: Lost[] = [];
  const note = (l: Lost) => {
    if (lost.length >= 500) return;
    const subject = l.subject ? cut(oneLine(clean(l.subject)), 120, true) : '';
    const detail = l.detail ? cut(oneLine(noIds(clean(l.detail))), 300, true) : '';
    lost.push({
      scope: l.scope,
      ...(subject ? { subject } : {}),
      code: l.code.slice(0, 60),
      ...(detail ? { detail } : {}),
    });
  };
  for (const l of input.lost) note(l);
  const total = input.categories.reduce((n, c) => n + c.products.length, 0);
  if (total > LIMITS.products) throw new TooLarge(`${total} products`);

  const refs = new Set(
    input.categories.flatMap((c) => c.products.map((p) => p.ref)).filter(Boolean),
  );

  const categories: ImportCategory[] = [];
  const catNames = new Map<string, number>();
  for (const c of input.categories) {
    let name = oneLine(clean(c.name));
    if (!name) name = 'Outros';
    if (name.length > LIMITS.categoryName) {
      note({ scope: 'category', subject: name, code: 'name_shortened' });
      name = cut(name, LIMITS.categoryName, true);
    }
    // two source categories with one name become one
    const seen = catNames.get(name.toLowerCase());
    const cat: ImportCategory =
      seen !== undefined ? categories[seen]! : { name, products: [] as ImportProduct[] };
    if (seen === undefined) {
      catNames.set(name.toLowerCase(), categories.length);
      categories.push(cat);
    }
    const desc = clean(c.description);
    if (desc && !cat.description) cat.description = cut(desc, LIMITS.categoryDescription, true);
    for (const p of c.products) cat.products.push(product(p));
  }

  function product(p: ImportProduct): ImportProduct {
    let name = oneLine(clean(p.name));
    const subject = () => name;
    if (name.length < 2) name = name ? `Produto ${name}` : 'Produto';
    if (name.length > LIMITS.productName) {
      note({ scope: 'product', subject: name, code: 'name_shortened' });
      name = cut(name, LIMITS.productName, true);
    }
    let hidden: string | null = null;
    const hide = (code: string, detail?: string) => {
      if (!hidden) hidden = code;
      note({ scope: 'product', subject: subject(), code, ...(detail ? { detail } : {}) });
    };

    let description = clean(p.description);
    if (description.length > LIMITS.productDescription) {
      note({ scope: 'product', subject: name, code: 'description_shortened' });
      description = cut(description, LIMITS.productDescription, true);
    }

    let priceCents = p.priceCents;
    if (!intIn(priceCents, 0, LIMITS.price)) {
      hide('price_out_of_range');
      priceCents = 0;
    }
    let compareAt = p.compareAtPriceCents;
    if (compareAt !== undefined && !(intIn(compareAt, 1, LIMITS.price) && compareAt > priceCents))
      compareAt = undefined;

    const tags = [
      ...new Set(
        p.tags.map((t) => cut(oneLine(clean(t)), LIMITS.tag, true)).filter((t) => t.length > 0),
      ),
    ];
    if (tags.length > LIMITS.tags) note({ scope: 'product', subject: name, code: 'tags_dropped' });

    const images = [...new Set(p.images.map(httpsUrl).filter((u): u is string => !!u))];
    if (images.length > LIMITS.photos)
      note({ scope: 'product', subject: name, code: 'photos_dropped' });

    if (p.optionGroups.length > LIMITS.groups) hide('too_many_option_groups');
    const optionGroups: ImportOptionGroup[] = [];
    for (const g of p.optionGroups.slice(0, LIMITS.groups)) {
      const gname = cut(oneLine(clean(g.name)) || 'Opções', LIMITS.groupName, true);
      if (g.options.length > LIMITS.options) hide('too_many_options', gname);
      const options: ImportOption[] = [];
      for (const o of g.options.slice(0, LIMITS.options)) {
        const oname = cut(oneLine(clean(o.name)) || 'Opção', LIMITS.optionName, true);
        if (!intIn(o.priceDeltaCents, -LIMITS.price, LIMITS.price)) {
          hide('price_out_of_range', oname);
          continue;
        }
        let maxQty = intIn(o.maxQty, 1, 1000) ? Math.min(o.maxQty, LIMITS.optionMaxQty) : 1;
        // a discount option can be picked once (Core refuses more)
        if (o.priceDeltaCents < 0) maxQty = 1;
        const opt: ImportOption = { name: oname, priceDeltaCents: o.priceDeltaCents };
        if (maxQty > 1) opt.maxQty = maxQty;
        const od = cut(clean(o.description), LIMITS.optionDescription, true);
        if (od) opt.description = od;
        const img = httpsUrl(o.imageUrl);
        if (img) opt.imageUrl = img;
        if (o.soldOut) opt.soldOut = true;
        options.push(opt);
      }
      if (!options.length) {
        hide('options_unreadable', gname);
        continue;
      }
      const units = options.reduce((n, o) => n + (o.maxQty ?? 1), 0);
      const cap = Math.min(40, units);
      let max = intIn(g.max, 1, 1000) ? Math.min(g.max, cap) : 1;
      let min = intIn(g.min, 0, 1000) ? g.min : 0;
      if (min > cap) {
        hide('options_unreadable', gname);
        min = cap;
      }
      if (max < min) max = min;
      const rule = g.pricingRule ?? 'sum';
      optionGroups.push({
        name: gname,
        min,
        max: Math.max(1, max),
        ...(rule !== 'sum' ? { pricingRule: rule } : {}),
        options,
      });
    }
    // the cheapest valid pick must not price the line below zero
    const floor = optionGroups.reduce((sum, g) => {
      const deltas = g.options.map((o) => o.priceDeltaCents).sort((a, b) => a - b);
      return sum + deltas.slice(0, g.min).reduce((s, d) => s + Math.min(d, 0), 0);
    }, priceCents);
    if (floor < 0) hide('price_mismatch');

    let kit: ImportKit | undefined;
    if (p.kit) {
      const slots = p.kit.slots
        .map((s) => ({
          name: cut(oneLine(clean(s.name)) || 'Escolha', LIMITS.kitSlotName, true),
          min: intIn(s.min, 0, 99) ? s.min : 1,
          max: intIn(s.max, 1, 99) ? s.max : Math.max(1, intIn(s.min, 1, 99) ? s.min : 1),
          qtyPerItem: intIn(s.qtyPerItem, 1, 99) ? s.qtyPerItem : 1,
          items: s.items
            .filter((i) => refs.has(i.ref) && i.ref !== p.ref)
            .map((i) => ({ ref: i.ref, priceDeltaCents: i.priceDeltaCents ?? 0 }))
            .slice(0, LIMITS.kitItems),
        }))
        .map((s) => ({ ...s, max: Math.max(s.max, s.min) }));
      const unresolved =
        p.kit.slots.length > LIMITS.kitSlots ||
        slots.some(
          (s, i) =>
            s.items.length === 0 ||
            s.items.length < p.kit!.slots[i]!.items.length ||
            s.items.some((it) => !intIn(it.priceDeltaCents, -LIMITS.kitDelta, LIMITS.kitDelta)),
        );
      if (unresolved) hide('kit_unresolved');
      else kit = { slots };
    }

    const sched = schedule(p.availability);
    if (sched === 'overflow')
      note({ scope: 'product', subject: name, code: 'availability_simplified' });
    let promo: ImportProduct['promoSchedule'];
    if (p.promoSchedule) {
      const ps = p.promoSchedule;
      const ws = schedule({ windows: ps.windows, outside: 'unavailable' });
      if (
        intIn(ps.priceCents, 0, LIMITS.price) &&
        ps.priceCents < priceCents &&
        ws &&
        ws !== 'overflow'
      )
        promo = { priceCents: ps.priceCents, windows: ws.windows };
      // a promotion Venduá can't hold as it was comes at the regular price, said so
      else note({ scope: 'product', subject: name, code: 'promo_schedule' });
    }

    let stock: number | null | undefined = p.stockQuantity;
    if (stock !== undefined && stock !== null) stock = intIn(stock, 0, 1_000_000) ? stock : null;

    const out: ImportProduct = {
      ...(p.ref ? { ref: p.ref } : {}),
      name,
      ...(description ? { description } : {}),
      priceCents,
      ...(compareAt !== undefined ? { compareAtPriceCents: compareAt } : {}),
      tags: tags.slice(0, LIMITS.tags),
      images: images.slice(0, LIMITS.photos),
      status: hidden ? 'archived' : p.status,
      ...(stock !== undefined ? { stockQuantity: stock } : {}),
      ...(sched && sched !== 'overflow' ? { availability: sched } : {}),
      ...(promo ? { promoSchedule: promo } : {}),
      ...(p.requiresPreorder ? { requiresPreorder: true } : {}),
      optionGroups,
      ...(kit ? { kit } : {}),
    };
    return out;
  }

  // empty categories stay out of the menu, but say why
  const kept = categories.filter((c) => {
    if (c.products.length) return true;
    if (!lost.some((l) => l.scope === 'category' && l.subject === c.name))
      note({ scope: 'category', subject: c.name, code: 'empty_category' });
    return false;
  });

  const store = storeOf(input.store, note);
  const hours = hoursOf(input.hours, note);
  const zones = zonesOf(input.zones, note);
  const payments = paymentsOf(input.payments, note);
  const operations = operationsOf(input.operations);

  const doc: MenuImportV1 = {
    v: 1,
    source: input.source,
    store,
    ...(hours ? { hours } : {}),
    ...(operations ? { operations } : {}),
    ...(zones ? { zones } : {}),
    ...(payments ? { payments } : {}),
    categories: kept,
    lost,
  };
  if (storedBytes(doc) > LIMITS.docBytes) throw new TooLarge('document over 2 MB');

  const products = kept.flatMap((c) => c.products);
  return {
    doc,
    counts: {
      categories: kept.length,
      products: products.length,
      hidden: products.filter((p) => p.status === 'archived').length,
      photos: products.reduce((n, p) => n + p.images.length, 0),
      optionGroups: products.reduce((n, p) => n + p.optionGroups.length, 0),
      hours: hours?.length ?? 0,
      zones: zones?.length ?? 0,
      paymentMethods: payments?.methods.length ?? 0,
      pix: !!payments?.pix,
      logo: !!store.logoUrl,
      cover: !!store.coverUrl,
      lost: lost.length,
    },
  };
}

type Note = (l: Lost) => void;

function storeOf(s: MenuImportV1['store'], note: Note): MenuImportV1['store'] {
  const out: MenuImportV1['store'] = {};
  const name = oneLine(clean(s.name));
  if (name.length >= 2) out.name = cut(name, LIMITS.storeName, true);
  const tagline = oneLine(clean(s.tagline));
  if (tagline) out.tagline = cut(tagline, LIMITS.tagline, true);
  if (s.announcement) {
    const title = oneLine(clean(s.announcement.title));
    if (title.length >= 2) {
      out.announcement = { title: cut(title, LIMITS.announcementTitle, true) };
      const body = oneLine(clean(s.announcement.body));
      if (body) {
        if (body.length > LIMITS.announcementBody)
          note({ scope: 'store', code: 'announcement_shortened' });
        out.announcement.body = cut(body, LIMITS.announcementBody, true);
      }
    }
  }
  if (s.whatsapp !== undefined) {
    const w = whatsappDigits(s.whatsapp);
    if (w) out.whatsapp = w;
    else note({ scope: 'store', code: 'whatsapp_invalid' });
  }
  const ig = instagramHandle(s.instagram);
  if (ig) out.instagram = ig;
  const address = oneLine(clean(s.address));
  if (address) out.address = cut(address, LIMITS.address, true);
  const city = oneLine(clean(s.city));
  if (city) out.city = cut(city, LIMITS.city, true);
  if (
    s.coords &&
    Number.isFinite(s.coords.lat) &&
    Number.isFinite(s.coords.lng) &&
    Math.abs(s.coords.lat) <= 90 &&
    Math.abs(s.coords.lng) <= 180 &&
    !(s.coords.lat === 0 && s.coords.lng === 0)
  )
    out.coords = { lat: s.coords.lat, lng: s.coords.lng };
  const logo = httpsUrl(s.logoUrl);
  if (logo) out.logoUrl = logo;
  const cover = httpsUrl(s.coverUrl);
  if (cover) out.coverUrl = cover;
  if (s.brandColor && /^#[0-9a-f]{6}$/i.test(s.brandColor))
    out.brandColor = s.brandColor.toUpperCase();
  return out;
}

function hoursOf(h: ImportWindow[] | undefined, note: Note): ImportWindow[] | undefined {
  if (!h) return undefined;
  const out: ImportWindow[] = [];
  for (const w of h) {
    const days = validDays(w.days);
    if (!days || !HHMM.test(w.open) || !HHMM.test(w.close) || w.open === w.close) continue;
    out.push({ days, open: w.open, close: w.close });
  }
  if (out.length > LIMITS.hours) note({ scope: 'store', code: 'hours_dropped' });
  return out.length ? out.slice(0, LIMITS.hours) : undefined;
}

function operationsOf(o: MenuImportV1['operations']): MenuImportV1['operations'] | undefined {
  if (!o) return undefined;
  const out: NonNullable<MenuImportV1['operations']> = {};
  if (intIn(o.minOrderCents, 0, 10_000_000)) out.minOrderCents = o.minOrderCents;
  if (intIn(o.prepTimeMinutes, 1, 600)) out.prepTimeMinutes = o.prepTimeMinutes;
  if (typeof o.pickup === 'boolean') out.pickup = o.pickup;
  if (typeof o.delivery === 'boolean') out.delivery = o.delivery;
  if (out.pickup === false && out.delivery === false) delete out.delivery;
  return Object.keys(out).length ? out : undefined;
}

function zonesOf(z: ImportZone[] | undefined, note: Note): ImportZone[] | undefined {
  if (!z) return undefined;
  const out: ImportZone[] = [];
  for (const zone of z) {
    if (!intIn(zone.feeCents, 0, 1_000_000)) {
      note({ scope: 'store', code: 'zone_dropped', detail: zone.name });
      continue;
    }
    const base: ImportZone = {
      name: cut(oneLine(clean(zone.name)) || 'Entrega', LIMITS.zoneName, true),
      kind: zone.kind,
      feeCents: zone.feeCents,
    };
    if (intIn(zone.feePerKmCents, 0, 100_000) && zone.feePerKmCents > 0)
      base.feePerKmCents = zone.feePerKmCents;
    if (intIn(zone.minOrderCents, 0, 10_000_000) && zone.minOrderCents > 0)
      base.minOrderCents = zone.minOrderCents;
    if (intIn(zone.etaMin, 0, 1440)) base.etaMin = zone.etaMin;
    if (intIn(zone.etaMax, 0, 1440)) base.etaMax = zone.etaMax;
    if (base.etaMin !== undefined && base.etaMax !== undefined && base.etaMin > base.etaMax)
      [base.etaMin, base.etaMax] = [base.etaMax, base.etaMin];
    if (intIn(zone.freeDeliveryOverCents, 1, 10_000_000))
      base.freeDeliveryOverCents = zone.freeDeliveryOverCents;
    if (zone.kind === 'radius') {
      const km = zone.maxDistanceKm;
      if (typeof km !== 'number' || !(km > 0 && km <= 500)) {
        note({ scope: 'store', code: 'zone_dropped', detail: zone.name });
        continue;
      }
      out.push({ ...base, maxDistanceKm: Math.round(km * 100) / 100 });
    } else if (zone.kind === 'polygon') {
      const ring = (zone.polygon ?? []).filter(
        (p) =>
          Array.isArray(p) &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          Math.abs(p[0]) <= 90 &&
          Math.abs(p[1]) <= 180,
      );
      if (ring.length < 3 || ring.length > 201) {
        note({ scope: 'store', code: 'zone_dropped', detail: zone.name });
        continue;
      }
      out.push({ ...base, polygon: ring });
    } else {
      const names = [
        ...new Set(
          (zone.neighborhoods ?? [])
            .map((n) => cut(oneLine(clean(n)), LIMITS.neighborhood, true))
            .filter(Boolean),
        ),
      ];
      if (!names.length) continue;
      // > 200 neighbourhoods: several zones with the same fee
      for (let i = 0; i < names.length; i += LIMITS.neighborhoods) {
        const part = Math.floor(i / LIMITS.neighborhoods);
        out.push({
          ...base,
          name: part ? cut(`${base.name} (${part + 1})`, LIMITS.zoneName) : base.name,
          neighborhoods: names.slice(i, i + LIMITS.neighborhoods),
        });
      }
    }
  }
  if (out.length > LIMITS.zones) note({ scope: 'store', code: 'zones_dropped' });
  return out.length ? out.slice(0, LIMITS.zones) : undefined;
}

function paymentsOf(p: MenuImportV1['payments'], note: Note): MenuImportV1['payments'] | undefined {
  if (!p) return undefined;
  const methods = [...new Set(p.methods)].filter(isPaymentMethod);
  const out: NonNullable<MenuImportV1['payments']> = { methods };
  if (p.adjustments) {
    const adj: NonNullable<typeof out.adjustments> = {};
    for (const m of methods) {
      const a = p.adjustments[m];
      if (!a) continue;
      const e: { percentBps?: number; fixedCents?: number } = {};
      if (intIn(a.percentBps, -MAX_PERCENT_BPS, MAX_PERCENT_BPS) && a.percentBps !== 0)
        e.percentBps = a.percentBps;
      if (intIn(a.fixedCents, -MAX_FIXED_CENTS, MAX_FIXED_CENTS) && a.fixedCents !== 0)
        e.fixedCents = a.fixedCents;
      if (Object.keys(e).length) adj[m] = e;
    }
    if (Object.keys(adj).length) out.adjustments = adj;
  }
  if (p.pix) {
    const key = p.pix.key.trim();
    let beneficiary = oneLine(clean(p.pix.beneficiary));
    if (key && key.length <= LIMITS.pixKey && beneficiary) {
      if (beneficiary.length > LIMITS.pixBeneficiary) {
        note({ scope: 'store', code: 'pix_beneficiary_shortened', detail: beneficiary });
        beneficiary = shortenName(beneficiary, LIMITS.pixBeneficiary);
      }
      const pix: NonNullable<typeof out.pix> = { key, type: p.pix.type, beneficiary };
      const city = oneLine(clean(p.pix.city));
      if (city) {
        if (city.length > LIMITS.pixCity) note({ scope: 'store', code: 'pix_city_shortened' });
        pix.city = cut(city, LIMITS.pixCity);
      }
      out.pix = pix;
      if (!methods.includes('pix')) out.methods.unshift('pix');
    }
  }
  return out.methods.length || out.pix ? out : undefined;
}

/** "Maria do Carmo Junqueira Miranda Silva" → "Maria C J M Silva" — first and last kept. */
export function shortenName(name: string, max: number): string {
  if (name.length <= max) return name;
  const parts = name.split(' ').filter(Boolean);
  if (parts.length > 2) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const middle = parts
      .slice(1, -1)
      .filter((p) => !/^(d[aeo]s?|e)$/i.test(p))
      .map((p) => p[0]!.toUpperCase());
    let out = [first, ...middle, last].join(' ');
    while (out.length > max && middle.length) {
      middle.pop();
      out = [first, ...middle, last].join(' ');
    }
    if (out.length <= max) return out;
  }
  return name.slice(0, max).trim();
}
