import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { getCatalogView, type ProductSummary } from './catalog.ts';

// "Tem brigadeiro?", "quais doces sem lactose" — a shopper's words against the menu. Accents,
// case and the common Portuguese plurals fold away; the store's vocabulary ("doces") matches
// everything weakly, so a generic question still lists the menu.

export type CatalogMatch = 'name' | 'description' | 'category' | 'modifier' | 'vocabulary';

export interface CatalogHit {
  product: ProductSummary;
  score: number;
  matched: CatalogMatch;
}

export const SEARCH_MAX_QUERY = 100;
export const SEARCH_MAX_LIMIT = 20;

const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'um',
  'uma',
  'uns',
  'umas',
  'para',
  'pra',
  'pro',
  'por',
  'que',
  'tem',
  'quero',
  'voce',
  'voces',
]);

/** lowercase, accents off, anything but letters and digits a space */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Singular of a folded word, near enough that both forms meet: pudins→pudim, pastéis→pastel,
 *  limões→limão, pães→pão, flores→flor, doces→doce. */
export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('oes') || w.endsWith('aes')) return w.slice(0, -3) + 'ao';
  if (w.endsWith('ns')) return w.slice(0, -2) + 'm';
  if (/[aeou]is$/.test(w)) return w.slice(0, -2) + 'l';
  if (/[rzs]es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function searchTokens(s: string): string[] {
  return foldText(s)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map(singular);
}

/** ≤ 1 edit between two words (a typo), for words long enough that it isn't another word */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** how well one query word meets one field's words: 1 exact, 0.8 a prefix, 0.6 a typo */
function tokenFit(q: string, words: readonly string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if (q.length >= 3 && w.startsWith(q)) best = Math.max(best, 0.8);
    else if (q.length >= 5 && nearly(q, w)) best = Math.max(best, 0.6);
  }
  return best;
}

export interface SearchFields {
  name: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  modifiers?: readonly string[] | undefined;
}

const WEIGHT: Record<Exclude<CatalogMatch, 'vocabulary'>, number> = {
  name: 40,
  category: 30,
  modifier: 25,
  description: 20,
};

/**
 * The pure score of one product for a query (already `searchTokens`): 100 the exact name, 80
 * a name that starts with the query, else each query word's best field (name 40 > category 30 >
 * option 25 > description 20; a prefix 0.8 of that, a typo 0.6) averaged over the words;
 * only the store's own word for its items (`vocabulary`) scores 5.
 * Null when nothing meets.
 */
export function scoreProduct(
  query: readonly string[],
  fields: SearchFields,
  vocabulary: ReadonlySet<string> = new Set(),
): { score: number; matched: CatalogMatch } | null {
  if (!query.length) return null;
  const name = searchTokens(fields.name);
  const joined = query.join(' ');
  const nameJoined = name.join(' ');
  if (nameJoined === joined) return { score: 100, matched: 'name' };
  if (joined.length >= 3 && nameJoined.startsWith(joined)) return { score: 80, matched: 'name' };
  const words: Record<keyof typeof WEIGHT, string[]> = {
    name,
    category: fields.category ? searchTokens(fields.category) : [],
    modifier: (fields.modifiers ?? []).flatMap(searchTokens),
    description: fields.description ? searchTokens(fields.description) : [],
  };
  let total = 0;
  let generic = 0;
  const byField: Record<string, number> = {};
  for (const q of query) {
    let best = 0;
    let where: keyof typeof WEIGHT | null = null;
    for (const f of Object.keys(WEIGHT) as (keyof typeof WEIGHT)[]) {
      const v = tokenFit(q, words[f]) * WEIGHT[f];
      if (v > best) {
        best = v;
        where = f;
      }
    }
    if (where) {
      total += best;
      byField[where] = (byField[where] ?? 0) + best;
    } else if (vocabulary.has(q)) generic++;
  }
  if (total > 0) {
    const matched = Object.entries(byField).sort((x, y) => y[1] - x[1])[0]![0] as CatalogMatch;
    // a word that met nothing counts as zero: "bolo de fubá" ranks the fubá cake over any bolo
    return { score: Math.max(1, Math.round(total / (query.length - generic))), matched };
  }
  return generic === query.length ? { score: 5, matched: 'vocabulary' } : null;
}

/** available now (not sold out, not outside its hours) */
const available = (p: ProductSummary) => p.status === 'active';

/** The menu ranked for a shopper's words: available first, then the score, then what sold
 *  most in the last 60 days. Hidden-by-schedule and archived products never show. */
export async function searchCatalog(
  tx: Sql,
  tenantId: string,
  query: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<CatalogHit[]> {
  if (typeof query !== 'string' || query.length > SEARCH_MAX_QUERY)
    throw new HttpError(422, 'BAD_REQUEST', `query must be at most ${SEARCH_MAX_QUERY} chars`, {
      field: 'query',
    });
  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? 10)));
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const now = opts.now ?? new Date();
  const [view, modifiers, sales, settings] = await Promise.all([
    getCatalogView(tx, tenantId, now),
    tx<{ product_id: string; name: string }[]>`
      select g.product_id, m.name from modifiers m join modifier_groups g on g.id = m.group_id
      where m.tenant_id = ${tenantId}
    `,
    tx<{ product_id: string; qty: number }[]>`
      select i.product_id, sum(i.qty)::int as qty
      from order_items i join orders o on o.id = i.order_id
      where i.tenant_id = ${tenantId} and o.tenant_id = ${tenantId}
        and o.placed_at > ${now}::timestamptz - interval '60 days'
        and o.state not in ('cancelled', 'refunded') and i.product_id is not null
      group by i.product_id
    `,
    tx<{ vocabulary: Record<string, unknown> | null }[]>`
      select vocabulary from store_settings where tenant_id = ${tenantId}
    `,
  ]);
  const optionsOf = new Map<string, string[]>();
  for (const m of modifiers) {
    const list = optionsOf.get(m.product_id) ?? [];
    list.push(m.name);
    optionsOf.set(m.product_id, list);
  }
  const sold = new Map(sales.map((s) => [s.product_id, s.qty]));
  const vocab = settings[0]?.vocabulary ?? {};
  const vocabulary = new Set(
    [vocab.itemSingular, vocab.itemPlural]
      .filter((v): v is string => typeof v === 'string')
      .flatMap(searchTokens),
  );
  const hits: (CatalogHit & { sold: number })[] = [];
  for (const cat of view.categories)
    for (const product of cat.products) {
      const s = scoreProduct(
        tokens,
        {
          name: product.name,
          description: product.description,
          category: cat.name,
          modifiers: optionsOf.get(product.id),
        },
        vocabulary,
      );
      if (s) hits.push({ product, ...s, sold: sold.get(product.id) ?? 0 });
    }
  hits.sort(
    (a, b) =>
      Number(available(b.product)) - Number(available(a.product)) ||
      b.score - a.score ||
      b.sold - a.sold ||
      a.product.name.localeCompare(b.product.name, 'pt-BR'),
  );
  return hits.slice(0, limit).map(({ product, score, matched }) => ({ product, score, matched }));
}
