// QA fixtures seeded as the owner role (bypasses RLS); idempotent — each run
// wipes mutable state and rewrites domains/settings/zones/catalog. qa-closed's
// window is computed at seed time so it never flakes on wall-clock.
import postgres from 'postgres';

export const QA_SLUGS = ['qa-open', 'qa-paused', 'qa-closed', 'qa-edge'] as const;
export type QaSlug = (typeof QA_SLUGS)[number];

interface SeedZone {
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents?: number;
  etaMin: number;
  etaMax: number;
}
interface SeedGroup {
  name: string;
  required?: boolean;
  min?: number;
  max?: number;
  modifiers: { name: string; deltaCents?: number }[];
}
interface SeedProduct {
  slug: string;
  name: string;
  description?: string;
  priceCents: number;
  status?: 'active' | 'sold_out';
  groups?: SeedGroup[];
}
interface SeedCategory {
  slug: string;
  name: string;
  sort: number;
  products: SeedProduct[];
}

const ALL = [0, 1, 2, 3, 4, 5, 6];
const TZ = 'America/Sao_Paulo';

function nowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

const hhmm = (mins: number) => {
  const v = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

function catalog(): SeedCategory[] {
  return [
    {
      slug: 'qa-cardapio',
      name: 'QA Cardápio',
      sort: 1,
      products: [
        {
          slug: 'qa-modular',
          name: 'QA Item Modular',
          priceCents: 1500,
          description: 'Produto com grupo obrigatório e opcional — exercita C02.',
          groups: [
            {
              name: 'Tamanho',
              required: true,
              min: 1,
              max: 1,
              modifiers: [
                { name: 'Pequeno' },
                { name: 'Médio', deltaCents: 500 },
                { name: 'Grande', deltaCents: 1200 },
              ],
            },
            {
              name: 'Extras',
              max: 2,
              modifiers: [
                { name: 'Extra A', deltaCents: 200 },
                { name: 'Extra B', deltaCents: 300 },
              ],
            },
          ],
        },
        {
          slug: 'qa-simples',
          name: 'QA Item Simples',
          priceCents: 900,
          description: 'Produto sem modificadores — happy path.',
        },
        {
          slug: 'qa-esgotado',
          name: 'QA Item Esgotado',
          priceCents: 1100,
          status: 'sold_out',
          description: 'Sempre esgotado — exercita SOLD_OUT.',
        },
      ],
    },
  ];
}

const ZONES: SeedZone[] = [
  // 'Nowhere-land' is never seeded — typing it must yield OUT_OF_ZONE.
  {
    name: 'Centro',
    neighborhoods: ['Centro', 'Bacaxá'],
    feeCents: 500,
    minOrderCents: 500,
    etaMin: 30,
    etaMax: 50,
  },
  {
    name: 'Vilatur',
    neighborhoods: ['Vilatur'],
    feeCents: 900,
    minOrderCents: 2000,
    etaMin: 50,
    etaMax: 80,
  },
];

export interface QaSeedOptions {
  databaseUrl?: string;
  /** seeded for this port AND the bare hostname so the Host resolver matches either */
  previewPort?: number;
}

export async function seedQaTenants(opts: QaSeedOptions = {}): Promise<void> {
  const url =
    opts.databaseUrl ??
    process.env.DATABASE_URL ??
    'postgres://vendua:vendua@localhost:5433/vendua';
  const port = opts.previewPort ?? Number(process.env.VENDUA_PREVIEW_PORT ?? 5199);
  const sql = postgres(url, { max: 4 });

  const closedNow = nowMinutes();
  const closedWindow = { days: ALL, open: hhmm(closedNow - 120), close: hhmm(closedNow - 30) };

  try {
    for (const slug of QA_SLUGS) {
      const name = `QA ${slug.replace('qa-', '')} (conformance)`;
      const hosts = [`${slug}.localhost`, `${slug}.localhost:${port}`];

      const settings = {
        tagline: `Fixture ${slug}`,
        description: 'Tenant de QA do pacote @vendua/conformance — dados determinísticos.',
        city: 'Cidade QA',
        address: 'Rua Fixture, 1 — Centro',
        windows:
          slug === 'qa-closed' ? [closedWindow] : [{ days: ALL, open: '00:00', close: '23:59' }],
        minOrderCents: 0,
        prepTimeMinutes: 20,
        promo:
          slug === 'qa-open'
            ? { title: 'QA Promo', body: 'Banner promocional fixture.' }
            : undefined,
        statusOverride: slug === 'qa-paused' ? ('paused' as const) : null,
        resumesAt: slug === 'qa-paused' ? new Date(Date.now() + 3 * 3600_000).toISOString() : null,
      };

      await sql.begin(async (tx) => {
        const tid = (
          await tx<{ id: string }[]>`
            insert into tenants (slug, name) values (${slug}, ${name})
            on conflict (slug) do update set name = excluded.name
            returning id
          `
        )[0]!.id;

        // Wipe mutable state so re-runs are deterministic.
        await tx`delete from order_events where tenant_id = ${tid}`;
        await tx`delete from orders where tenant_id = ${tid}`;
        await tx`delete from outbox where tenant_id = ${tid}`;
        await tx`delete from cart_items where tenant_id = ${tid}`;
        await tx`delete from carts where tenant_id = ${tid}`;
        await tx`delete from idempotency_keys where tenant_id = ${tid}`;
        await tx`delete from domains where tenant_id = ${tid}`;
        await tx`delete from delivery_zones where tenant_id = ${tid}`;
        await tx`delete from categories where tenant_id = ${tid}`;

        for (const host of hosts) {
          await tx`insert into domains (host, tenant_id) values (${host}, ${tid})`;
        }

        await tx`
          insert into store_settings (tenant_id, tagline, description, whatsapp, instagram, city, address,
            hours, prep_time_minutes, min_order_cents, pickup_enabled, delivery_enabled, promo, currency, vocabulary,
            status_override, resumes_at)
          values (${tid}, ${settings.tagline}, ${settings.description}, null, null,
            ${settings.city}, ${settings.address}, ${tx.json({ timezone: TZ, windows: settings.windows })},
            ${settings.prepTimeMinutes}, ${settings.minOrderCents}, true, true,
            ${settings.promo ? tx.json(settings.promo) : null}, 'BRL', ${tx.json({})},
            ${settings.statusOverride}, ${settings.resumesAt})
          on conflict (tenant_id) do update set
            tagline = excluded.tagline, description = excluded.description, whatsapp = excluded.whatsapp,
            instagram = excluded.instagram, city = excluded.city, address = excluded.address,
            hours = excluded.hours, prep_time_minutes = excluded.prep_time_minutes,
            min_order_cents = excluded.min_order_cents, pickup_enabled = excluded.pickup_enabled,
            delivery_enabled = excluded.delivery_enabled, promo = excluded.promo,
            currency = excluded.currency, vocabulary = excluded.vocabulary,
            status_override = excluded.status_override, resumes_at = excluded.resumes_at
        `;

        for (const z of ZONES) {
          await tx`
            insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes)
            values (${tid}, ${z.name}, ${tx.json(z.neighborhoods)}, ${z.feeCents}, ${z.minOrderCents ?? 0}, ${z.etaMin}, ${z.etaMax})
          `;
        }

        for (const cat of catalog()) {
          const catId = (
            await tx<{ id: string }[]>`
              insert into categories (tenant_id, slug, name, sort) values (${tid}, ${cat.slug}, ${cat.name}, ${cat.sort}) returning id
            `
          )[0]!.id;
          for (const p of cat.products) {
            const pid = (
              await tx<{ id: string }[]>`
                insert into products (tenant_id, category_id, slug, name, description, base_price_cents, status, figure_variant)
                values (${tid}, ${catId}, ${p.slug}, ${p.name}, ${p.description ?? null}, ${p.priceCents}, ${p.status ?? 'active'}, 'default')
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
              for (const [mi, mo] of g.modifiers.entries()) {
                await tx`
                  insert into modifiers (tenant_id, group_id, name, price_delta_cents, sort)
                  values (${tid}, ${gid}, ${mo.name}, ${mo.deltaCents ?? 0}, ${mi})
                `;
              }
            }
          }
        }
      });
    }
  } finally {
    await sql.end();
  }
}
