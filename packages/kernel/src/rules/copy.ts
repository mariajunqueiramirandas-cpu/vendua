import type { StoreProfile } from '../api.ts';

// The store's words for the things every store has (Core's `store.vocabulary`), over the
// Kernel's defaults.

export interface Vocabulary {
  itemSingular: string;
  itemPlural: string;
  bag: string;
  /** the add-to-bag button */
  cta: string;
  [word: string]: string;
}

export const DEFAULT_VOCABULARY: Vocabulary = {
  itemSingular: 'item',
  itemPlural: 'itens',
  bag: 'sacola',
  cta: 'Adicionar à sacola',
};

/** The store's vocabulary over the defaults; blank or non-text entries are ignored. */
export function vocabularyOf(
  store: Pick<StoreProfile, 'vocabulary'> | null | undefined,
): Vocabulary {
  const out: Vocabulary = { ...DEFAULT_VOCABULARY };
  for (const [k, v] of Object.entries(store?.vocabulary ?? {}))
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 60);
  return out;
}
