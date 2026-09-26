// dev tenants — idempotent wipe+recreate of catalog/settings (orders/carts preserved); quero-pudim :5174
import { createSql } from './db.ts';
import { log } from './log.ts';

const slog = log.child({ mod: 'seed' });

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
    // SEED_DOMAINS="slug:host1|host2,..." — registers real public domains (resolver routes on Host)
    const extra = (process.env.SEED_DOMAINS ?? '')
      .split(',')
      .map((e) => e.trim().split(':'))
      .filter(([slug]) => slug === t.slug)
      .flatMap(([, hosts]) => (hosts ?? '').split('|').filter(Boolean));
    for (const host of [...t.hosts, ...extra]) {
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
  slog.info({ slug: t.slug }, 'seeded tenant');
}

// CRM demo leads — wiped+recreated each seed (source='seed'); runs as table owner so no RLS GUC needed
{
  await sql`delete from leads where source = 'seed'`;
  const SEED_LEADS = [
    {
      name: 'Dona Mirtes',
      business: 'Doces da Mirtes',
      phone: '+5585988120001',
      email: 'mirtes@doces.com',
      city: 'Fortaleza',
      segment: 'doceria',
      state: 'contacted',
      agentMode: 'draft',
      tags: ['quente', 'indicacao'],
      deal: 490000,
      activity: 'Indicada pela Lia — vende brigadeiros por encomenda no IG, ~40 pedidos/semana.',
    },
    {
      name: 'Atelier do Brigadeiro',
      business: 'Atelier do Brigadeiro',
      phone: '+5585988120002',
      city: 'Fortaleza',
      segment: 'doceria',
      state: 'lead',
      agentMode: 'draft',
      discoveredVia: 'agente',
      tags: ['descoberto'],
      activity: 'Descoberto pelo agente via busca — IG ativo com 12k seguidores, sem loja online.',
    },
    {
      name: 'Seu Norberto',
      business: 'Marmitas do Norberto',
      phone: '+5585988120003',
      city: 'Caucaia',
      segment: 'marmitaria',
      state: 'invited',
      agentMode: 'auto',
      tags: ['almoço-corporativo'],
      deal: 890000,
      activity: 'Negociando plano anual — pediu proposta por escrito.',
    },
    {
      name: 'Café Serra Azul',
      business: 'Café Serra Azul',
      phone: '+5585988120004',
      city: 'Guaramiranga',
      segment: 'cafeteria',
      state: 'live',
      agentMode: 'off',
      tags: ['cliente'],
      deal: 590000,
      activity: 'Fechou! Loja no ar desde semana passada.',
    },
    {
      name: 'Padaria Trigo Real',
      business: 'Padaria Trigo Real',
      phone: '+5585988120005',
      city: 'Fortaleza',
      segment: 'padaria',
      state: 'contacted',
      agentMode: 'draft',
      lostReason: 'fechou contrato com concorrente',
      tags: ['perdido'],
      activity: 'Perdido — assinou com concorrente na sexta. Revisitar em 6 meses.',
    },
  ] as const;
  for (const l of SEED_LEADS) {
    const lead = (
      await sql<{ id: string }[]>`
        insert into leads (name, business_name, phone, email, city, segment, state, agent_mode,
          tags, deal_value_cents, discovered_via, lost_reason, source)
        values (${l.name}, ${l.business}, ${l.phone}, ${'email' in l ? l.email : null}, ${l.city},
          ${l.segment}, ${l.state}, ${l.agentMode}, ${l.tags as unknown as never[]},
          ${'deal' in l ? l.deal : null}, ${'discoveredVia' in l ? l.discoveredVia : null},
          ${'lostReason' in l ? l.lostReason : null}, 'seed')
        returning id
      `
    )[0]!;
    await sql`
      insert into lead_activities (lead_id, kind, body, created_by)
      values (${lead.id}, 'note', ${l.activity}, 'staff')
    `;
    // one history row per stage the lead passed through — everReached counts to_state rows
    const stages = ['lead', 'contacted', 'invited', 'live'] as const;
    for (const s of stages.slice(0, stages.indexOf(l.state) + 1)) {
      await sql`
        insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
        values (${lead.id}, null, ${s}, 'staff', ${'deal' in l ? l.deal : null})
      `;
    }
  }
  slog.info({ count: 5 }, 'seeded CRM leads');
}

await sql.end();
slog.info('done');
