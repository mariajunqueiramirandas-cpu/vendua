import type { Sql } from '../../platform/db.ts';
import type { Scenario } from '../cliente-oculto.ts';

// The order-accuracy suite's stores (sales-agent.md §7): a pizzaria with halves and borda, a
// hamburgueria with combos, an açaí with many add-ons, a padaria with encomendas and a
// marmitaria with a daily menu. Synthetic data only; real conversations need an owner decision.

interface Opt {
  name: string;
  delta: number;
}
interface Group {
  name: string;
  required: boolean;
  min: number;
  max: number;
  rule?: 'sum' | 'average' | 'most_expensive';
  options: Opt[];
}
interface Prod {
  slug: string;
  name: string;
  price: number;
  description?: string;
  groups?: Group[];
  preorderDays?: number;
}
export interface StoreFixture {
  key: string;
  name: string;
  categories: { slug: string; name: string; products: Prod[] }[];
  zones: { name: string; neighborhoods: string[]; fee: number }[];
  preordersWhileClosed?: boolean;
  scenarios: Omit<Scenario, 'check'>[];
}

const borda: Group = {
  name: 'Borda',
  required: true,
  min: 1,
  max: 1,
  options: [
    { name: 'Sem borda', delta: 0 },
    { name: 'Catupiry', delta: 900 },
    { name: 'Cheddar', delta: 900 },
  ],
};
const sabores = (names: string[]): Group => ({
  name: 'Sabores',
  required: true,
  min: 1,
  max: 2,
  rule: 'most_expensive',
  options: names.map((n) => ({ name: n, delta: n === 'Frango c/ Catupiry' ? 400 : 0 })),
});

export const FIXTURES: StoreFixture[] = [
  {
    key: 'pizzaria',
    name: 'Forno da Vila',
    categories: [
      {
        slug: 'pizzas',
        name: 'Pizzas',
        products: [
          {
            slug: 'pizza-g',
            name: 'Pizza G',
            price: 5200,
            description: '8 fatias, 35 cm',
            groups: [
              sabores(['Calabresa', 'Mussarela', 'Frango c/ Catupiry', 'Portuguesa']),
              borda,
            ],
          },
          {
            slug: 'pizza-broto',
            name: 'Pizza Broto',
            price: 2900,
            description: '4 fatias, 25 cm',
            groups: [sabores(['Calabresa', 'Mussarela']), borda],
          },
        ],
      },
      {
        slug: 'bebidas',
        name: 'Bebidas',
        products: [
          { slug: 'coca-2l', name: 'Coca-Cola 2 L', price: 1400 },
          { slug: 'guarana-2l', name: 'Guaraná 2 L', price: 1200 },
        ],
      },
    ],
    zones: [{ name: 'Centro', neighborhoods: ['Centro', 'Vila Nova'], fee: 700 }],
    scenarios: [
      {
        name: 'meia calabresa meia frango com borda de catupiry + coca, entrega',
        persona: 'Você é a Júlia, direta, escreve rápido.',
        target: {
          lines: [
            {
              productId: '',
              name: 'Pizza G',
              qty: 1,
              options: ['Calabresa', 'Frango c/ Catupiry', 'Catupiry'],
            },
            { productId: '', name: 'Coca-Cola 2 L', qty: 1, options: [] },
          ],
          mode: 'delivery',
          neighborhood: 'Centro',
          payment: 'pix',
        },
        expect: 'order',
      },
      {
        name: 'duas brotos de mussarela sem borda, retirada, dinheiro',
        persona: 'Você é o Seu Antônio, educado, escreve frases completas.',
        target: {
          lines: [
            { productId: '', name: 'Pizza Broto', qty: 2, options: ['Mussarela', 'Sem borda'] },
          ],
          mode: 'pickup',
          neighborhood: null,
          payment: 'cash',
        },
        expect: 'order',
      },
    ],
  },
  {
    key: 'hamburgueria',
    name: 'Brasa Burger',
    categories: [
      {
        slug: 'burgers',
        name: 'Burgers',
        products: [
          {
            slug: 'x-salada',
            name: 'X-Salada',
            price: 2600,
            groups: [
              {
                name: 'Ponto da carne',
                required: true,
                min: 1,
                max: 1,
                options: [
                  { name: 'Ao ponto', delta: 0 },
                  { name: 'Bem passado', delta: 0 },
                ],
              },
              {
                name: 'Adicionais',
                required: false,
                min: 0,
                max: 3,
                options: [
                  { name: 'Bacon', delta: 500 },
                  { name: 'Ovo', delta: 300 },
                ],
              },
            ],
          },
          {
            slug: 'x-bacon',
            name: 'X-Bacon',
            price: 3100,
            groups: [
              {
                name: 'Ponto da carne',
                required: true,
                min: 1,
                max: 1,
                options: [
                  { name: 'Ao ponto', delta: 0 },
                  { name: 'Bem passado', delta: 0 },
                ],
              },
            ],
          },
        ],
      },
      {
        slug: 'acompanhamentos',
        name: 'Acompanhamentos',
        products: [{ slug: 'batata', name: 'Batata frita', price: 1500 }],
      },
    ],
    zones: [{ name: 'Bairros próximos', neighborhoods: ['Jardim', 'Centro'], fee: 600 }],
    scenarios: [
      {
        name: '2 X-Salada ao ponto, um com bacon, e uma batata',
        persona: 'Você é o Léo, manda várias mensagens curtas seguidas.',
        target: {
          lines: [
            { productId: '', name: 'X-Salada', qty: 1, options: ['Ao ponto', 'Bacon'] },
            { productId: '', name: 'X-Salada', qty: 1, options: ['Ao ponto'] },
            { productId: '', name: 'Batata frita', qty: 1, options: [] },
          ],
          mode: 'delivery',
          neighborhood: 'Jardim',
          payment: 'card_on_delivery',
        },
        expect: 'order',
      },
    ],
  },
  {
    key: 'acai',
    name: 'Açaí do Porto',
    categories: [
      {
        slug: 'acai',
        name: 'Açaí',
        products: [
          {
            slug: 'acai-500',
            name: 'Açaí 500 ml',
            price: 2200,
            groups: [
              {
                name: 'Complementos',
                required: false,
                min: 0,
                max: 5,
                options: ['Granola', 'Banana', 'Leite em pó', 'Paçoca', 'Morango', 'Nutella'].map(
                  (n) => ({ name: n, delta: n === 'Nutella' ? 500 : n === 'Morango' ? 300 : 0 }),
                ),
              },
            ],
          },
        ],
      },
    ],
    zones: [{ name: 'Orla', neighborhoods: ['Orla', 'Centro'], fee: 500 }],
    scenarios: [
      {
        name: 'açaí 500 com granola, banana e nutella, retirada',
        persona: 'Você é a Bia, indecisa: pergunta preços antes de escolher.',
        target: {
          lines: [
            {
              productId: '',
              name: 'Açaí 500 ml',
              qty: 1,
              options: ['Granola', 'Banana', 'Nutella'],
            },
          ],
          mode: 'pickup',
          neighborhood: null,
          payment: 'pix',
        },
        expect: 'order',
      },
    ],
  },
  {
    key: 'padaria',
    name: 'Padaria Trigo Bom',
    preordersWhileClosed: true,
    categories: [
      {
        slug: 'encomendas',
        name: 'Encomendas',
        products: [
          {
            slug: 'bolo-festa',
            name: 'Bolo de festa 2 kg',
            price: 12000,
            preorderDays: 2,
            groups: [
              {
                name: 'Sabor',
                required: true,
                min: 1,
                max: 1,
                options: [
                  { name: 'Chocolate', delta: 0 },
                  { name: 'Ninho com morango', delta: 1500 },
                ],
              },
            ],
          },
        ],
      },
      {
        slug: 'paes',
        name: 'Pães',
        products: [{ slug: 'pao-frances', name: 'Pão francês (10 un)', price: 900 }],
      },
    ],
    zones: [],
    scenarios: [
      {
        name: 'bolo de festa ninho com morango, encomenda para retirar',
        persona: 'Você é a Dona Célia, quer um bolo para o aniversário da neta daqui a 3 dias.',
        target: {
          lines: [
            { productId: '', name: 'Bolo de festa 2 kg', qty: 1, options: ['Ninho com morango'] },
          ],
          mode: 'pickup',
          neighborhood: null,
          payment: 'pix',
        },
        expect: 'order',
      },
    ],
  },
  {
    key: 'marmitaria',
    name: 'Marmitaria da Ju',
    categories: [
      {
        slug: 'hoje',
        name: 'Cardápio de hoje',
        products: [
          {
            slug: 'marmita-g',
            name: 'Marmita grande',
            price: 2400,
            description: 'arroz, feijão, salada e uma carne',
            groups: [
              {
                name: 'Carne',
                required: true,
                min: 1,
                max: 1,
                options: [
                  { name: 'Frango grelhado', delta: 0 },
                  { name: 'Bife acebolado', delta: 300 },
                ],
              },
            ],
          },
          { slug: 'suco', name: 'Suco natural 500 ml', price: 800 },
        ],
      },
    ],
    zones: [{ name: 'Empresas do centro', neighborhoods: ['Centro'], fee: 300 }],
    scenarios: [
      {
        name: '3 marmitas de bife para o escritório, entrega, Pix',
        persona: 'Você é o Carlos, pedindo para a equipe do escritório no Centro.',
        target: {
          lines: [{ productId: '', name: 'Marmita grande', qty: 3, options: ['Bife acebolado'] }],
          mode: 'delivery',
          neighborhood: 'Centro',
          payment: 'pix',
        },
        expect: 'order',
      },
      {
        name: 'pede para falar com uma pessoa',
        persona: 'Você quer falar com a dona sobre um pedido para 60 pessoas.',
        target: null,
        expect: 'handoff',
      },
    ],
  },
];

/** A fresh store with this fixture's menu, zones and an enabled Vendedor (coverage: always). */
export async function createFixtureStore(sql: Sql, f: StoreFixture): Promise<string> {
  const slug = `sim-${f.key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const [t] = await sql<
    { id: string }[]
  >`insert into tenants (slug, name) values (${slug}, ${f.name}) returning id`;
  const tenantId = t!.id;
  await sql`insert into store_settings ${sql({
    tenant_id: tenantId,
    hours: sql.json({
      timezone: 'America/Sao_Paulo',
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
    }),
    prep_time_minutes: 30,
    min_order_cents: 0,
    currency: 'BRL',
    vocabulary: sql.json({}),
    pickup_enabled: true,
    delivery_enabled: f.zones.length > 0,
    payment_methods: ['pix', 'cash', 'card_on_delivery'],
    preorders_while_closed: f.preordersWhileClosed ?? false,
  })}`;
  for (const [ci, c] of f.categories.entries()) {
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name, sort) values (${tenantId}, ${c.slug}, ${c.name}, ${ci}) returning id`;
    for (const [pi, p] of c.products.entries()) {
      const [prod] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents, description, sort,
          requires_preorder, preorder_lead_days)
        values (${tenantId}, ${cat!.id}, ${p.slug}, ${p.name}, ${p.price}, ${p.description ?? null}, ${pi},
          ${!!p.preorderDays}, ${p.preorderDays ?? 0})
        returning id`;
      for (const [gi, g] of (p.groups ?? []).entries()) {
        const [grp] = await sql<{ id: string }[]>`
          insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
          values (${tenantId}, ${prod!.id}, ${g.name}, ${g.required}, ${g.min}, ${g.max}, ${gi}) returning id`;
        if (g.rule)
          await sql`update modifier_groups set pricing_rule = ${g.rule} where id = ${grp!.id}`;
        for (const [oi, o] of g.options.entries())
          await sql`insert into modifiers (tenant_id, group_id, name, price_delta_cents, sort)
            values (${tenantId}, ${grp!.id}, ${o.name}, ${o.delta}, ${oi})`;
      }
    }
  }
  for (const z of f.zones)
    await sql`insert into delivery_zones (tenant_id, name, kind, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, ${z.name}, 'neighborhood', ${z.neighborhoods}, ${z.fee}, 30, 50)`;
  await sql`insert into store_agent (tenant_id, enabled, settings) values (${tenantId}, true, ${sql.json({ coverage: 'always' })})`;
  return tenantId;
}
