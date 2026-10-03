import type { Sql } from '../platform/db.ts';
import { fold } from './knowledge.ts';

// "Li sua loja" (UX §3.12, sales-agent.md §4.15): what isn't clear in the menu, computed by Core
// so the onboarding's interviewer only phrases it. Each gap deep-links to what fixes it.

export type GapKind =
  'size_unstated' | 'unpriced_option' | 'no_allergen_info' | 'duplicate_name' | 'empty_combo_slot';

export interface MenuGap {
  kind: GapKind;
  productId: string | null;
  categoryId: string | null;
  title: string;
  detail: string;
}

const SIZE_WORD = /\b(broto|pequena|pequeno|media|medio|grande|familia|gigante|mini|individual)\b/;
const SIZE_FACT = /\b(\d+\s*(cm|ml|l|g|kg|gramas|fatias|pedacos|pessoas|unidades|un)|serve\s+\d)\b/;

export async function menuGaps(tx: Sql, tenantId: string): Promise<MenuGap[]> {
  const products = await tx<
    {
      id: string;
      name: string;
      description: string | null;
      category_id: string;
      category: string;
      dietary: string[] | null;
      kind: string;
    }[]
  >`select p.id, p.name, p.description, p.category_id, c.name as category, p.dietary, p.kind
    from products p join categories c on c.id = p.category_id
    where p.tenant_id = ${tenantId} and p.status <> 'archived' order by c.sort, p.sort, p.name`;
  const gaps: MenuGap[] = [];

  for (const p of products) {
    const n = fold(p.name);
    if (SIZE_WORD.test(n) && !SIZE_FACT.test(fold(`${p.name} ${p.description ?? ''}`)))
      gaps.push({
        kind: 'size_unstated',
        productId: p.id,
        categoryId: p.category_id,
        title: `${p.name}: qual o tamanho?`,
        detail: 'O nome diz o tamanho, mas não quanto é (cm, fatias, pessoas). Clientes perguntam.',
      });
  }

  const groups = await tx<
    { product_id: string; product: string; group: string; zero: number; priced: number }[]
  >`
    select g.product_id, p.name as product, g.name as group,
           count(*) filter (where m.price_delta_cents = 0)::int as zero,
           count(*) filter (where m.price_delta_cents > 0)::int as priced
    from modifier_groups g join modifiers m on m.group_id = g.id join products p on p.id = g.product_id
    where g.tenant_id = ${tenantId} and p.status <> 'archived'
    group by g.id, g.product_id, p.name, g.name`;
  for (const g of groups)
    if (g.zero > 0 && g.priced > 0 && g.zero < g.priced)
      gaps.push({
        kind: 'unpriced_option',
        productId: g.product_id,
        categoryId: null,
        title: `${g.product}: opção sem preço em "${g.group}"`,
        detail: `${g.zero} opção(ões) de "${g.group}" saem de graça enquanto as outras custam. É isso mesmo?`,
      });

  const byCategory = new Map<string, { name: string; any: boolean; n: number }>();
  for (const p of products) {
    const c = byCategory.get(p.category_id) ?? { name: p.category, any: false, n: 0 };
    c.n += 1;
    if ((p.dietary ?? []).some((d) => /gluten|lactose/.test(d))) c.any = true;
    byCategory.set(p.category_id, c);
  }
  for (const [id, c] of byCategory)
    if (!c.any && c.n > 0)
      gaps.push({
        kind: 'no_allergen_info',
        productId: null,
        categoryId: id,
        title: `${c.name}: nada sobre glúten ou lactose`,
        detail: 'Sem essa informação a Ana não afirma nada e chama você quando perguntarem.',
      });

  const seen = new Map<string, string>();
  for (const p of products) {
    const k = fold(p.name);
    const first = seen.get(k);
    if (first)
      gaps.push({
        kind: 'duplicate_name',
        productId: p.id,
        categoryId: p.category_id,
        title: `Dois produtos chamados "${p.name}"`,
        detail: 'Com o mesmo nome a Ana não sabe qual o cliente quer.',
      });
    else seen.set(k, p.id);
  }

  const empty = await tx<{ product_id: string; product: string; slot: string }[]>`
    select s.product_id, p.name as product, s.name as slot
    from combo_slots s join products p on p.id = s.product_id
    where s.tenant_id = ${tenantId} and p.status <> 'archived'
      and not exists (select 1 from combo_slot_items i where i.slot_id = s.id)`;
  for (const e of empty)
    gaps.push({
      kind: 'empty_combo_slot',
      productId: e.product_id,
      categoryId: null,
      title: `${e.product}: "${e.slot}" está vazio`,
      detail: 'Um combo com uma parte sem opções não pode ser pedido.',
    });

  return gaps.slice(0, 50);
}
