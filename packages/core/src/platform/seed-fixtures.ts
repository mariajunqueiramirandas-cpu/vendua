// CI/fleet fixtures — NOT the dev seed (that one is blank: `bun run seed`). Fills quero-pudim with a menu, zones, coupons, Pix and
// loyalty, plus the canary tenants that `vendua train` / template migrations run over. Idempotent wipe+recreate (orders/carts preserved).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTemplatesDir } from '@vendua/templates/node';
import { createSql } from './db.ts';
import { log } from './log.ts';
import { isPublicHost } from './store-origin.ts';
import { instagramHandle, whatsappDigits } from '../modules/store.ts';

const slog = log.child({ mod: 'seed' });

// it deletes and recreates stores by slug, and signup lets a real store take any of those slugs
if (process.env.NODE_ENV === 'production')
  throw new Error('seed:fixtures is for CI and dev databases — refusing with NODE_ENV=production');

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);
const REPO = join(import.meta.dir, '../../../..');

interface SeedZone {
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents?: number;
  etaMin: number;
  etaMax: number;
  /** radius zone: serves addresses within this distance of the store */
  maxDistanceKm?: number;
  feePerKmCents?: number;
  freeDeliveryOverCents?: number;
}
interface SeedComboSlot {
  name: string;
  min: number;
  max: number;
  qtyPerItem?: number;
  items: { slug: string; deltaCents?: number }[];
}
interface SeedModifier {
  name: string;
  deltaCents?: number;
}
interface SeedGroup {
  name: string;
  required?: boolean;
  min?: number;
  max?: number;
  modifiers: SeedModifier[];
}
interface SeedProduct {
  slug: string;
  name: string;
  description?: string;
  priceCents: number;
  status?: 'active' | 'sold_out';
  figure?: 'default' | 'alt';
  groups?: SeedGroup[];
  stock?: number;
  lowStockThreshold?: number;
  /** encomenda: lead days before the scheduled date */
  preorderDays?: number;
  /** kit: the customer picks items per slot (roadmap 2b combos) */
  combo?: SeedComboSlot[];
}
interface SeedCategory {
  slug: string;
  name: string;
  sort: number;
  products: SeedProduct[];
}
interface SeedTenant {
  slug: string;
  name: string;
  hosts: string[];
  /** repo storefront whose templates/ seed the store's composition (v1 in Core) */
  storefront?: string;
  /** the merchant admin owner — phone as national digits (DDD + number) */
  owner?: { name: string; phone: string; email: string | null };
  ring?: 'canary' | 'early' | 'stable';
  settings: {
    tagline?: string;
    description?: string;
    whatsapp?: string;
    instagram?: string;
    city?: string;
    address?: string;
    windows: { days: number[]; open: string; close: string }[];
    minOrderCents?: number;
    prepTimeMinutes?: number;
    pickup?: boolean;
    delivery?: boolean;
    promo?: { title: string; body?: string };
    currency?: string;
    vocabulary?: Record<string, string>;
    pix?: {
      key: string;
      keyType: 'email' | 'phone' | 'cpf' | 'cnpj' | 'random';
      beneficiary: string;
      city: string;
    };
    loyalty?: {
      stampsRequired: number;
      minOrderCents: number;
      reward: { kind: 'percent' | 'fixed' | 'free_delivery'; value: number; label: string };
      rewardValidDays: number;
    };
    location?: { latitude: number; longitude: number };
  };
  zones: SeedZone[];
  coupons?: {
    code: string;
    kind: 'percent' | 'fixed' | 'free_delivery';
    value?: number;
    label?: string;
    minSubtotalCents?: number;
    firstOrderOnly?: boolean;
    perPhoneLimit?: number;
  }[];
  categories: SeedCategory[];
}

const ALL = [0, 1, 2, 3, 4, 5, 6];

const TENANTS: SeedTenant[] = [
  {
    slug: 'quero-pudim',
    name: 'Quero Pudim Gourmet',
    hosts: ['quero-pudim.localhost', 'localhost:5174', '127.0.0.1:5174'],
    storefront: 'storefronts/quero-pudim',
    owner: { name: 'Dono Dev', phone: '22999990001', email: 'dono@example.com' },
    ring: 'canary',
    settings: {
      tagline: 'Pudins sem furinhos e sacolés cremosos',
      description:
        'Pudins sem furinhos e sacolés bem cremosos, feitos à mão em Saquarema, RJ. Encomende para retirada ou entrega.',
      whatsapp: '5522999999999',
      instagram: 'queropudim_gourmet',
      city: 'Saquarema · RJ',
      address: 'Rua das Amendoeiras, 120 — Centro, Saquarema',
      windows: [{ days: ALL, open: '09:00', close: '22:00' }],
      minOrderCents: 1000,
      prepTimeMinutes: 40,
      promo: { title: 'Semana do pudim', body: '10% off em todos os kits até domingo.' },
      vocabulary: {
        itemSingular: 'doce',
        itemPlural: 'doces',
        bag: 'sacola',
        cta: 'Escolher meu doce',
      },
      pix: {
        key: 'pedidos@queropudim.com.br',
        keyType: 'email',
        beneficiary: 'Quero Pudim Gourmet',
        city: 'Saquarema',
      },
      loyalty: {
        stampsRequired: 8,
        minOrderCents: 2500,
        reward: { kind: 'fixed', value: 1890, label: '1 pudim tradicional grátis' },
        rewardValidDays: 60,
      },
      location: { latitude: -22.9292, longitude: -42.4906 },
    },
    coupons: [
      {
        code: 'BEMVINDO',
        kind: 'percent',
        value: 10,
        label: '10% no primeiro pedido',
        firstOrderOnly: true,
      },
      {
        code: 'FRETEGRATIS',
        kind: 'free_delivery',
        label: 'Entrega grátis acima de R$ 80',
        minSubtotalCents: 8000,
        perPhoneLimit: 3,
      },
    ],
    zones: [
      {
        name: 'Centro',
        neighborhoods: ['Centro', 'Bacaxá'],
        feeCents: 500,
        etaMin: 30,
        etaMax: 50,
        freeDeliveryOverCents: 12000,
      },
      { name: 'Itaúna', neighborhoods: ['Itaúna'], feeCents: 700, etaMin: 40, etaMax: 60 },
      {
        name: 'Vilatur / Gravatá',
        neighborhoods: ['Vilatur', 'Gravatá'],
        feeCents: 900,
        minOrderCents: 2000,
        etaMin: 50,
        etaMax: 80,
      },
      // everything else nearby: priced by distance from the kitchen
      {
        name: 'Até 12 km',
        neighborhoods: [],
        feeCents: 400,
        feePerKmCents: 90,
        maxDistanceKm: 12,
        minOrderCents: 3000,
        etaMin: 45,
        etaMax: 90,
      },
    ],
    categories: [
      {
        slug: 'pudins',
        name: 'Pudins',
        sort: 1,
        products: [
          {
            slug: 'pudim-tradicional',
            name: 'Pudim tradicional',
            priceCents: 1890,
            stock: 14,
            lowStockThreshold: 4,
            description: 'O clássico: lisinho, sem furinho, calda dourada de caramelo.',
            groups: [
              {
                name: 'Tamanho',
                required: true,
                min: 1,
                max: 1,
                modifiers: [
                  { name: 'Individual — 120g' },
                  { name: 'Médio — 400g', deltaCents: 1600 },
                  { name: 'Grande — 800g', deltaCents: 3900 },
                ],
              },
              {
                name: 'Cobertura extra',
                max: 2,
                modifiers: [
                  { name: 'Calda extra', deltaCents: 300 },
                  { name: 'Coco fresco', deltaCents: 400 },
                ],
              },
            ],
          },
          {
            slug: 'pudim-coco',
            name: 'Pudim de coco',
            priceCents: 1990,
            description: 'Coco de verdade na massa e na cobertura. Textura firme, sabor de festa.',
          },
          {
            slug: 'pudim-doce-de-leite',
            name: 'Pudim de doce de leite',
            priceCents: 2190,
            description: 'Doce de leite caseiro no lugar da calda — mais escuro, mais profundo.',
          },
          {
            slug: 'pudim-maracuja',
            name: 'Pudim de maracujá',
            priceCents: 2090,
            description: 'Azedinho do maracujá cortando o doce do leite condensado.',
            status: 'sold_out',
          },
        ],
      },
      {
        slug: 'sacoles',
        name: 'Sacolés',
        sort: 2,
        products: [
          {
            slug: 'sacole-coco',
            name: 'Sacolé de coco',
            priceCents: 700,
            stock: 3,
            lowStockThreshold: 5,
            figure: 'alt',
            description: 'Cremoso de verdade — leite de coco fresco.',
          },
          {
            slug: 'sacole-morango',
            name: 'Sacolé de morango',
            priceCents: 750,
            figure: 'alt',
            description: 'Morango maduro, batido na hora.',
          },
          {
            slug: 'sacole-chocolate',
            name: 'Sacolé de chocolate',
            priceCents: 750,
            figure: 'alt',
            description: 'Cacau 50%, denso e gelado.',
          },
        ],
      },
      {
        slug: 'kits',
        name: 'Kits',
        sort: 3,
        products: [
          {
            slug: 'kit-festa',
            name: 'Kit festa',
            priceCents: 5990,
            figure: 'alt',
            description:
              '4 pudins e 2 sacolés à sua escolha — para a festa, o presente ou a semana.',
            combo: [
              {
                name: 'Pudins',
                min: 4,
                max: 4,
                qtyPerItem: 2,
                items: [
                  { slug: 'pudim-tradicional' },
                  { slug: 'pudim-coco' },
                  { slug: 'pudim-doce-de-leite', deltaCents: 200 },
                  { slug: 'pudim-maracuja' },
                ],
              },
              {
                name: 'Sacolés',
                min: 2,
                max: 2,
                qtyPerItem: 2,
                items: [
                  { slug: 'sacole-coco' },
                  { slug: 'sacole-morango' },
                  { slug: 'sacole-chocolate' },
                ],
              },
            ],
          },
          {
            slug: 'pudim-gigante',
            name: 'Pudim gigante (encomenda)',
            priceCents: 12900,
            figure: 'default',
            description:
              '2 kg, serve 20 pessoas. Feito sob encomenda — peça com 2 dias de antecedência.',
            preorderDays: 2,
          },
          {
            slug: 'kit-semana',
            name: 'Kit da semana',
            priceCents: 4490,
            figure: 'alt',
            description: '6 pudins individuais — um para cada dia útil e um de bônus.',
          },
        ],
      },
    ],
  },
];

// Every in-repo storefront has a dev tenant, so fleet operations (template
// migrations by ring, trains) run over all of them. quero-pudim and the scaffold
// baseline are the canary ring.
const quero = TENANTS[0]!;
TENANTS.push({
  ...quero,
  slug: 'loja-modelo',
  name: 'Loja Modelo',
  hosts: ['loja-modelo.localhost', 'localhost:5175', '127.0.0.1:5175'],
  storefront: 'storefronts/_template',
  ring: 'canary',
  settings: (({ promo: _promo, ...rest }) => ({
    ...rest,
    tagline: 'A base de todo vendua scaffold',
  }))(quero.settings),
});

// A store the site builder generates (ADR 0039) lands as storefronts/<slug>/ in its own PR, which
// may touch nothing else, so it can't add itself above. It gets the same fixture menu, on the
// dev hosts `vendua new` registers for its port, so the fleet trains it like any other store.
const covered = new Set(TENANTS.map((t) => t.storefront));
const { owner: _owner, ...generated } = quero;
for (const dir of readdirSync(join(REPO, 'storefronts'), { withFileTypes: true })) {
  const rel = `storefronts/${dir.name}`;
  if (!dir.isDirectory() || covered.has(rel) || !existsSync(join(REPO, rel, 'package.json')))
    continue;
  const vite = join(REPO, rel, 'vite.config.ts');
  const port = existsSync(vite)
    ? /\bport:\s*(\d+)/.exec(readFileSync(vite, 'utf8'))?.[1]
    : undefined;
  if (!port) {
    slog.warn({ storefront: rel }, 'no dev port in vite.config.ts: no fixture tenant');
    continue;
  }
  TENANTS.push({
    ...generated,
    slug: dir.name,
    name: dir.name,
    hosts: [`${dir.name}.localhost`, `localhost:${port}`, `127.0.0.1:${port}`],
    storefront: rel,
    ring: 'stable',
    settings: (({ promo: _promo, ...rest }) => rest)(quero.settings),
  });
}

// demo storefronts removed from the repo; drop their tenants from already-seeded DBs (FKs cascade)
await sql`delete from tenants where slug in ('brasa', 'forn', 'example-quero-pudim')`;

for (const t of TENANTS) {
  await sql.begin(async (tx) => {
    const tenant = (
      await tx<{ id: string }[]>`
        insert into tenants (slug, name) values (${t.slug}, ${t.name})
        on conflict (slug) do update set name = excluded.name
        returning id
      `
    )[0]!;
    const tid = tenant.id;

    await tx`delete from domains where tenant_id = ${tid}`;
    // SEED_DOMAINS="slug:host1|host2,..." — registers real public domains (resolver routes on Host)
    const extra = (process.env.SEED_DOMAINS ?? '')
      .split(',')
      .map((e) => e.trim().split(':'))
      .filter(([slug]) => slug === t.slug)
      .flatMap(([, hosts]) => (hosts ?? '').split('|').filter(Boolean));
    // the first public SEED_DOMAINS host is the address every admin link uses
    const primary = extra.find(isPublicHost);
    for (const host of [...t.hosts, ...extra]) {
      await tx`insert into domains (host, tenant_id, is_primary) values (${host}, ${tid}, ${host === primary})`;
    }

    const s = t.settings;
    await tx`
      insert into store_settings (tenant_id, tagline, description, whatsapp, instagram, city, address,
        hours, prep_time_minutes, min_order_cents, pickup_enabled, delivery_enabled, promo, currency, vocabulary)
      values (${tid}, ${s.tagline ?? null}, ${s.description ?? null}, ${whatsappDigits(s.whatsapp)}, ${instagramHandle(s.instagram)},
        ${s.city ?? null}, ${s.address ?? null}, ${tx.json({ timezone: 'America/Sao_Paulo', windows: s.windows })},
        ${s.prepTimeMinutes ?? 30}, ${s.minOrderCents ?? 0}, ${s.pickup ?? true}, ${s.delivery ?? true},
        ${s.promo ? tx.json(s.promo) : null}, ${s.currency ?? 'BRL'}, ${tx.json(s.vocabulary ?? {})})
      on conflict (tenant_id) do update set
        tagline = excluded.tagline, description = excluded.description, whatsapp = excluded.whatsapp,
        instagram = excluded.instagram, city = excluded.city, address = excluded.address,
        hours = excluded.hours, prep_time_minutes = excluded.prep_time_minutes,
        min_order_cents = excluded.min_order_cents, pickup_enabled = excluded.pickup_enabled,
        delivery_enabled = excluded.delivery_enabled, promo = excluded.promo,
        currency = excluded.currency, vocabulary = excluded.vocabulary
    `;
    await tx`
      update store_settings set
        pix_key = ${s.pix?.key ?? null}, pix_key_type = ${s.pix?.keyType ?? null},
        pix_beneficiary = ${s.pix?.beneficiary ?? null}, pix_city = ${s.pix?.city ?? null},
        loyalty = ${s.loyalty ? tx.json(s.loyalty) : null},
        latitude = ${s.location?.latitude ?? null}, longitude = ${s.location?.longitude ?? null}
      where tenant_id = ${tid}
    `;
    // the store's owner in the merchant admin (dev codes print in the log, or come back
    // in the response with VENDUA_ADMIN_DEV_OTP=1); the old placeholder owner is retired
    if (t.owner) {
      await tx`delete from merchant_users where tenant_id = ${tid} and phone = '22999990000'`;
      await tx`
        insert into merchant_users (tenant_id, name, phone, email, role)
        values (${tid}, ${t.owner.name}, ${t.owner.phone}, ${t.owner.email}, 'owner')
        on conflict (tenant_id, phone) do update
          set name = excluded.name, email = excluded.email, role = 'owner', status = 'active'
      `;
    }
    for (const c of t.coupons ?? []) {
      await tx`
        insert into coupons (tenant_id, code, kind, value, label, min_subtotal_cents, first_order_only, per_phone_limit)
        values (${tid}, ${c.code}, ${c.kind}, ${c.value ?? 0}, ${c.label ?? null}, ${c.minSubtotalCents ?? 0},
                ${c.firstOrderOnly ?? false}, ${c.perPhoneLimit ?? null})
        on conflict (tenant_id, code) do update set kind = excluded.kind, value = excluded.value,
          label = excluded.label, min_subtotal_cents = excluded.min_subtotal_cents,
          first_order_only = excluded.first_order_only, per_phone_limit = excluded.per_phone_limit, active = true
      `;
    }

    await tx`delete from delivery_zones where tenant_id = ${tid}`;
    for (const z of t.zones) {
      await tx`
        insert into delivery_zones (tenant_id, name, kind, neighborhoods, fee_cents, min_order_cents, eta_min_minutes,
                                    eta_max_minutes, max_distance_km, fee_per_km_cents, free_delivery_over_cents)
        values (${tid}, ${z.name}, ${z.maxDistanceKm ? 'radius' : 'neighborhood'}, ${tx.json(z.neighborhoods)}, ${z.feeCents},
                ${z.minOrderCents ?? 0}, ${z.etaMin}, ${z.etaMax}, ${z.maxDistanceKm ?? null}, ${z.feePerKmCents ?? 0},
                ${z.freeDeliveryOverCents ?? null})
      `;
    }

    // drop cart_items first — preserved carts FK-reference products this delete cascades away
    await tx`delete from cart_items where tenant_id = ${tid}`;
    await tx`delete from categories where tenant_id = ${tid}`;
    for (const cat of t.categories) {
      const catId = (
        await tx<{ id: string }[]>`
          insert into categories (tenant_id, slug, name, sort) values (${tid}, ${cat.slug}, ${cat.name}, ${cat.sort}) returning id
        `
      )[0]!.id;
      for (const p of cat.products) {
        const pid = (
          await tx<{ id: string }[]>`
            insert into products (tenant_id, category_id, slug, name, description, base_price_cents, status, figure_variant,
                                  stock_quantity, low_stock_threshold, requires_preorder, preorder_lead_days, kind)
            values (${tid}, ${catId}, ${p.slug}, ${p.name}, ${p.description ?? null}, ${p.priceCents}, ${p.status ?? 'active'},
                    ${p.figure ?? 'default'}, ${p.stock ?? null}, ${p.lowStockThreshold ?? null},
                    ${p.preorderDays !== undefined}, ${p.preorderDays ?? 0}, ${p.combo ? 'combo' : 'simple'})
            returning id
          `
        )[0]!.id;
        for (const [gi, g] of (p.groups ?? []).entries()) {
          const gid = (
            await tx<{ id: string }[]>`
              insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
              values (${tid}, ${pid}, ${g.name}, ${g.required ?? false}, ${g.min ?? 0}, ${g.max ?? 1}, ${gi})
              returning id
            `
          )[0]!.id;
          for (const [mi, m] of g.modifiers.entries()) {
            await tx`
              insert into modifiers (tenant_id, group_id, name, price_delta_cents, sort)
              values (${tid}, ${gid}, ${m.name}, ${m.deltaCents ?? 0}, ${mi})
            `;
          }
        }
      }
    }
    // kits last: their slots point at products created above
    for (const p of t.categories.flatMap((c) => c.products).filter((p) => p.combo)) {
      const kitId = (
        await tx<
          { id: string }[]
        >`select id from products where tenant_id = ${tid} and slug = ${p.slug}`
      )[0]!.id;
      for (const [si, slot] of p.combo!.entries()) {
        const slotId = (
          await tx<{ id: string }[]>`
            insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
            values (${tid}, ${kitId}, ${slot.name}, ${slot.min}, ${slot.max}, ${slot.qtyPerItem ?? 1}, ${si})
            returning id
          `
        )[0]!.id;
        for (const [ii, item] of slot.items.entries()) {
          await tx`
            insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
            select ${tid}, ${slotId}, id, ${item.deltaCents ?? 0}, ${ii} from products
            where tenant_id = ${tid} and slug = ${item.slug}
          `;
        }
      }
    }
    await tx`select set_config('vendua.tenant_id', ${tid}, true)`;
    await tx`
      insert into storefront_ops (tenant_id, ring) values (${tid}, ${t.ring ?? 'stable'})
      on conflict (tenant_id) do update set ring = excluded.ring
    `;
    // composition: repo templates become v1 — never over an existing history
    const dir = t.storefront ? join(REPO, t.storefront, 'templates') : null;
    if (dir && existsSync(dir)) {
      const have = await tx`select 1 from storefront_templates where tenant_id = ${tid} limit 1`;
      if (!have[0])
        for (const [page, template] of Object.entries(readTemplatesDir(dir)))
          await tx`
            insert into storefront_templates (tenant_id, page, version, template, source)
            values (${tid}, ${page}, 1, ${tx.json(template as never)}, 'seed')
          `;
    }
    return tid;
  });
  slog.info({ slug: t.slug }, 'seeded tenant');
}

// CRM: no demo pipeline — one real customer record for the store this repo ships.
// Re-seeds replace it (source='seed'); leads you create by hand are never touched.
{
  await sql`delete from leads where source = 'seed'`;
  const lead = (
    await sql<{ id: string }[]>`
      insert into leads (name, business_name, phone, whatsapp, instagram, city, segment, state,
        agent_mode, tags, source)
      values ('Quero Pudim Gourmet', 'Quero Pudim Gourmet', '+5522999999999', '+5522999999999',
        '@queropudim_gourmet', 'Saquarema', 'doceria', 'live', 'off',
        ${['cliente'] as unknown as never[]}, 'seed')
      returning id
    `
  )[0]!;
  await sql`
    insert into lead_activities (lead_id, kind, body, created_by)
    values (${lead.id}, 'note', 'Cliente: loja no ar em storefronts/quero-pudim (tenant quero-pudim).', 'staff')
  `;
  // one history row per stage — everReached counts to_state rows
  for (const s of ['lead', 'contacted', 'invited', 'live'] as const) {
    await sql`
      insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
      values (${lead.id}, null, ${s}, 'staff', null)
    `;
  }
  slog.info('seeded CRM customer: Quero Pudim Gourmet');
}

await sql.end();
slog.info('done');
