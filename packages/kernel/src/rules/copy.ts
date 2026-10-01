import type { StoreProfile } from '../api.ts';

// The store's words for the things every store has (Core's `store.vocabulary`), over the
// Kernel's defaults.

export interface Vocabulary {
  itemSingular: string;
  itemPlural: string;
  bag: string;
  /** the add-to-bag button */
  cta: string;
  /** Kernel 1.14 — the bag word with its article (pt-BR nouns have a gender): `na sacola` /
   *  `no carrinho`, `à sacola` / `ao carrinho`, `da sacola` / `do carrinho`, `Sua sacola` /
   *  `Seu carrinho` */
  inBag: string;
  toBag: string;
  ofBag: string;
  yourBag: string;
  [word: string]: string;
}

const PHRASES = ['inBag', 'toBag', 'ofBag', 'yourBag'] as const;

/** The article-bearing phrases for a bag word: feminine when it ends in "a" (`sacola`,
 *  `cesta`), else masculine (`carrinho`). */
function bagPhrases(bag: string): Pick<Vocabulary, (typeof PHRASES)[number]> {
  const f = /a$/i.test(bag);
  return {
    inBag: `${f ? 'na' : 'no'} ${bag}`,
    toBag: `${f ? 'à' : 'ao'} ${bag}`,
    ofBag: `${f ? 'da' : 'do'} ${bag}`,
    yourBag: `${f ? 'Sua' : 'Seu'} ${bag}`,
  };
}

export const DEFAULT_VOCABULARY: Vocabulary = {
  itemSingular: 'item',
  itemPlural: 'itens',
  bag: 'sacola',
  cta: 'Adicionar à sacola',
  ...bagPhrases('sacola'),
};

/** The store's vocabulary over the defaults; blank or non-text entries are ignored. The bag
 *  phrases (and the default `cta`) follow the store's bag word unless the store set them. */
export function vocabularyOf(
  store: Pick<StoreProfile, 'vocabulary'> | null | undefined,
): Vocabulary {
  const own: Record<string, string> = {};
  for (const [k, v] of Object.entries(store?.vocabulary ?? {}))
    if (typeof v === 'string' && v.trim()) own[k] = v.trim().slice(0, 60);
  const phrases = bagPhrases(own.bag ?? DEFAULT_VOCABULARY.bag);
  return { ...DEFAULT_VOCABULARY, ...phrases, cta: `Adicionar ${phrases.toBag}`, ...own };
}
