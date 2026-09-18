/**
 * Seed — Phase 0 dev tenants. Idempotent: wipes and recreates the spike
 * tenants' catalog/settings rows on each run (orders/carts are preserved for
 * whatever dev history exists; tenant wipe is scoped to catalog+settings).
 *
 * Tenant ↔ storefront mapping lives here because agents building
 * storefronts/<slug>/ must never need to touch packages/core.
 *
 *   slug          | dev hostnames                    | story exercised
 *   ------------- | -------------------------------- | ----------------------------
 *   quero-pudim   | quero-pudim.localhost, :5174     | modifiers, zones, promo
 *   brasa         | brasa.localhost, :5191           | required modifier groups
 *   forn          | forn.localhost, :5192            | closed hours → notice, pickup-only
 */
import { createSql } from './db.ts';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);

interface SeedZone {
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents?: number;
  etaMin: number;
  etaMax: number;
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
  };
  zones: SeedZone[];
  categories: SeedCategory[];
}

const ALL = [0, 1, 2, 3, 4, 5, 6];

const TENANTS: SeedTenant[] = [
  {
    slug: 'quero-pudim',
    name: 'Quero Pudim Gourmet',
    hosts: ['quero-pudim.localhost', 'localhost:5174', '127.0.0.1:5174'],
    settings: {
      tagline: 'Pudins sem furinhos e sacolés cremosos',
      description:
        'Pudins sem furinhos e sacolés bem cremosos, feitos à mão em Saquarema, RJ. Encomende para retirada ou entrega.',
      whatsapp: '5522999999999',
      instagram: '@queropudim_gourmet',
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
    },
    zones: [
      {
        name: 'Centro',
        neighborhoods: ['Centro', 'Bacaxá'],
        feeCents: 500,
        etaMin: 30,
        etaMax: 50,
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
            description: '12 doces à sua escolha — para a festa, o presente ou a semana.',
            groups: [
              {
                name: 'Sabores dos pudins',
                required: true,
                min: 2,
                max: 4,
                modifiers: [
                  { name: 'Tradicional' },
                  { name: 'Coco' },
                  { name: 'Doce de leite' },
                  { name: 'Maracujá' },
                ],
              },
            ],
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
  {
    slug: 'brasa',
    name: 'Brasa Burger',
    hosts: ['brasa.localhost', 'localhost:5191', '127.0.0.1:5191'],
    settings: {
      tagline: 'Smash na chapa. Fogo de verdade.',
      description:
        'Smash burgers prensados na chapa, pão de fermentação natural e batata rústica. Centro, entrega e retirada.',
      whatsapp: '5521988887777',
      instagram: '@brasa.burger',
      city: 'Rio de Janeiro · RJ',
      address: 'Av. Central, 880 — Centro',
      windows: [{ days: [2, 3, 4, 5, 6, 0], open: '18:00', close: '23:30' }],
      minOrderCents: 2500,
      prepTimeMinutes: 25,
    },
    zones: [
      {
        name: 'Centro',
        neighborhoods: ['Centro', 'Gamboa', 'Saúde'],
        feeCents: 600,
        etaMin: 25,
        etaMax: 45,
      },
      {
        name: 'Zona Portuária',
        neighborhoods: ['Santo Cristo', 'Caju'],
        feeCents: 900,
        minOrderCents: 3500,
        etaMin: 40,
        etaMax: 65,
      },
    ],
    categories: [
      {
        slug: 'smash',
        name: 'Smash burgers',
        sort: 1,
        products: [
          {
            slug: 'brasa-simples',
            name: 'Brasa Simples',
            priceCents: 2990,
            description:
              'Dois smash de 80g, cheddar, picles e maionese de alho no pão de fermentação natural.',
            groups: [
              {
                name: 'Ponto',
                required: true,
                min: 1,
                max: 1,
                modifiers: [{ name: 'Ao ponto' }, { name: 'Bem passado' }, { name: 'Mal passado' }],
              },
              {
                name: 'Adicionais',
                max: 6,
                modifiers: [
                  { name: 'Bacon crocante', deltaCents: 600 },
                  { name: 'Cheddar extra', deltaCents: 450 },
                  { name: 'Cebola caramelizada', deltaCents: 400 },
                  { name: 'Jalapeño', deltaCents: 350 },
                  { name: 'Ovo caipira', deltaCents: 400 },
                  { name: 'Smash extra 80g', deltaCents: 900 },
                ],
              },
            ],
          },
          {
            slug: 'brasa-dupla',
            name: 'Brasa Dupla',
            priceCents: 3690,
            description: 'Quatro carnes, dobro de cheddar, cebola crispy e o molho da casa.',
            groups: [
              {
                name: 'Ponto',
                required: true,
                min: 1,
                max: 1,
                modifiers: [{ name: 'Ao ponto' }, { name: 'Bem passado' }, { name: 'Mal passado' }],
              },
              {
                name: 'Adicionais',
                max: 6,
                modifiers: [
                  { name: 'Bacon crocante', deltaCents: 600 },
                  { name: 'Cheddar extra', deltaCents: 450 },
                  { name: 'Cebola caramelizada', deltaCents: 400 },
                  { name: 'Jalapeño', deltaCents: 350 },
                  { name: 'Molho brasa extra', deltaCents: 250 },
                ],
              },
            ],
          },
          {
            slug: 'brasa-veggie',
            name: 'Brasa Veggie',
            priceCents: 3190,
            description:
              'Smash de grão-de-bico e cogumelos, queijo vegetal, rúcula e maionese de ervas.',
          },
        ],
      },
      {
        slug: 'acompanhamentos',
        name: 'Acompanhamentos',
        sort: 2,
        products: [
          {
            slug: 'batata-rustica',
            name: 'Batata rústica',
            priceCents: 1490,
            figure: 'alt',
            description: 'Casca, páprica defumada, maionese da casa.',
          },
          {
            slug: 'onion-rings',
            name: 'Onion rings',
            priceCents: 1690,
            figure: 'alt',
            description: 'Empanados na hora, molho barbecue.',
          },
        ],
      },
      {
        slug: 'bebidas',
        name: 'Bebidas',
        sort: 3,
        products: [
          {
            slug: 'soda-artesanal',
            name: 'Soda artesanal',
            priceCents: 990,
            figure: 'alt',
            description: 'Sabores rotativos da casa.',
          },
          { slug: 'coca-lata', name: 'Coca-Cola lata', priceCents: 700, figure: 'alt' },
        ],
      },
    ],
  },
  {
    slug: 'forn',
    name: 'Forn do Bairro',
    hosts: ['forn.localhost', 'localhost:5192', '127.0.0.1:5192'],
    settings: {
      tagline: 'Pão de fermentação natural, todo dia de manhã',
      description:
        'Padoca de bairro: fermentação natural, fornadas da manhã, café coado. Retirada no balcão.',
      whatsapp: '5521977776666',
      instagram: '@forn.dobairro',
      city: 'Petrópolis · RJ',
      address: 'Rua do Forno, 45 — Valparaíso',
      // Morning bakery — closed most of the afternoon, exercises store_closed.
      windows: [{ days: ALL, open: '06:30', close: '11:30' }],
      minOrderCents: 0,
      prepTimeMinutes: 15,
      delivery: false,
    },
    zones: [
      {
        name: 'Balcão',
        neighborhoods: ['Valparaíso', 'Centro'],
        feeCents: 0,
        etaMin: 10,
        etaMax: 20,
      },
    ],
    categories: [
      {
        slug: 'paes',
        name: 'Pães',
        sort: 1,
        products: [
          {
            slug: 'pao-campanha',
            name: 'Pão de campanha',
            priceCents: 2400,
            description: 'Fermentação natural de 48h, casca grossa, miolo aberto.',
          },
          {
            slug: 'pao-de-milho',
            name: 'Pão de milho',
            priceCents: 1800,
            description: 'Milho verde e fubá — macio por dentro, dourado por fora.',
          },
          {
            slug: 'focaccia',
            name: 'Focaccia de alecrim',
            priceCents: 2100,
            description: 'Azeite, flor de sal e alecrim do quintal.',
            status: 'sold_out',
          },
        ],
      },
      {
        slug: 'doces',
        name: 'Doces de padoca',
        sort: 2,
        products: [
          {
            slug: 'bomba-de-chocolate',
            name: 'Bomba de chocolate',
            priceCents: 890,
            description: 'Choux recheado na hora.',
          },
          {
            slug: 'sonho-de-creme',
            name: 'Sonho de creme',
            priceCents: 690,
            description: 'Creme de confeiteiro e açúcar de verdade.',
          },
        ],
      },
      {
        slug: 'cafe',
        name: 'Café',
        sort: 3,
        products: [
          {
            slug: 'cafe-coado',
            name: 'Café coado',
            priceCents: 600,
            figure: 'alt',
            description: 'Grão da serra, passado na hora.',
          },
          { slug: 'cappuccino', name: 'Cappuccino', priceCents: 1100, figure: 'alt' },
        ],
      },
    ],
  },
];

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
    for (const host of t.hosts) {
      await tx`insert into domains (host, tenant_id) values (${host}, ${tid})`;
    }

    const s = t.settings;
    await tx`
      insert into store_settings (tenant_id, tagline, description, whatsapp, instagram, city, address,
        hours, prep_time_minutes, min_order_cents, pickup_enabled, delivery_enabled, promo, currency, vocabulary)
      values (${tid}, ${s.tagline ?? null}, ${s.description ?? null}, ${s.whatsapp ?? null}, ${s.instagram ?? null},
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

    await tx`delete from delivery_zones where tenant_id = ${tid}`;
    for (const z of t.zones) {
      await tx`
        insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes)
        values (${tid}, ${z.name}, ${tx.json(z.neighborhoods)}, ${z.feeCents}, ${z.minOrderCents ?? 0}, ${z.etaMin}, ${z.etaMax})
      `;
    }

    // Rebuild catalog rows for the spike tenants — deterministic reseed.
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
            insert into products (tenant_id, category_id, slug, name, description, base_price_cents, status, figure_variant)
            values (${tid}, ${catId}, ${p.slug}, ${p.name}, ${p.description ?? null}, ${p.priceCents}, ${p.status ?? 'active'}, ${p.figure ?? 'default'})
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
    return tid;
  });
  console.log(`seeded ${t.slug}`);
}

await sql.end();
console.log('done');
