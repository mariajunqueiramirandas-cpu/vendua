import { RefreshCw, Search, SearchX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  BlockArea,
  defineSection,
  plural,
  text,
  useCopy,
  useMenu,
  type SectionProps,
} from '@vendua/kernel';
import { ProductCard } from './_shared/ProductCard.tsx';
import { Skeleton } from './_shared/Skeleton.tsx';

// The brand's catalog: search, category tabs, print-frame cards, a floating bag.
export const schema = defineSection({
  type: 'store:catalog-browser',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 60, default: '' }),
    lede: text({ max: 160 }),
    searchLabel: text({ max: 60, default: 'Buscar no cardápio' }),
    searchPlaceholder: text({ max: 60, default: '' }),
    allLabel: text({ max: 40, default: 'Todos' }),
    /** empty = the store's vocabulary */
    itemSingular: text({ max: 20, default: '' }),
    itemPlural: text({ max: 20, default: '' }),
    cardCta: text({ max: 30, default: 'Ver produto' }),
    soldOutLabel: text({ max: 30, default: 'Esgotado hoje' }),
    emptyTitle: text({ max: 80, default: 'Nada por aqui ainda' }),
    emptyText: text({ max: 200, default: '' }),
    noMatchTitle: text({ max: 80, default: 'Nada encontrado' }),
    resetLabel: text({ max: 40, default: 'Ver tudo' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

export default function CatalogBrowser({ settings: s }: SectionProps<typeof schema>) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  // tabs: every category with something in it; the grid: the Kernel's search over the same menu
  const { categories, loading, error, refetch } = useMenu();
  const { categories: found } = useMenu({ query });
  const { vocabulary } = useCopy();
  const active = categories.some((c) => c.id === category) ? category : 'all';
  const shown = useMemo(
    () =>
      found
        .filter((c) => active === 'all' || c.id === active)
        .flatMap((c) => c.products.map((product) => ({ product, category: c }))),
    [found, active],
  );

  const hasFilters = query.trim() !== '' || active !== 'all';

  return (
    <>
      <section className="container catalog-head">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        <h1 className="display display-lg">{s.title}</h1>
        {s.lede ? <p className="lede">{s.lede}</p> : null}
        <form role="search" className="search-wrap" onSubmit={(e) => e.preventDefault()}>
          <span className="search-icon">
            <Search size={16} aria-hidden="true" />
          </span>
          <label htmlFor="busca" className="sr-label">
            {s.searchLabel}
          </label>
          <input
            id="busca"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={80}
            className="search-input"
            placeholder={s.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Limpar busca"
              onClick={() => setQuery('')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </form>
      </section>

      <section id="cardapio" className="container catalog-body">
        <div className="catalog-bar">
          <nav className="cat-tabs" aria-label="Categorias">
            {[{ id: 'all', name: s.allLabel }, ...categories].map((c) => (
              <button
                key={c.id}
                type="button"
                className="cat-tab"
                aria-pressed={active === c.id}
                data-active={active === c.id || undefined}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </nav>
          <p role="status" className="catalog-count tnum">
            {categories.length > 0
              ? `${shown.length} ${plural(shown.length, s.itemSingular || vocabulary.itemSingular, s.itemPlural || vocabulary.itemPlural)}`
              : ''}
          </p>
        </div>
        <BlockArea name="before-grid" />

        <div className="catalog-grid-wrap">
          {loading && categories.length === 0 ? (
            <div className="card-grid" aria-busy="true" aria-label="Carregando cardápio">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i}>
                  <Skeleton style={{ aspectRatio: '1', width: '100%', borderRadius: 24 }} />
                  <div style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
                    <Skeleton style={{ height: 12, width: '45%' }} />
                    <Skeleton style={{ height: 22, width: '80%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error && categories.length === 0 ? (
            <div role="alert" className="empty-state">
              <RefreshCw size={20} aria-hidden="true" />
              <h3>{s.emptyTitle}</h3>
              <button type="button" className="btn" onClick={refetch}>
                Tentar novamente
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state">
              <SearchX size={20} aria-hidden="true" />
              <h3>{hasFilters ? s.noMatchTitle : s.emptyTitle}</h3>
              {!hasFilters && s.emptyText ? <p>{s.emptyText}</p> : null}
              {hasFilters ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                  }}
                >
                  {s.resetLabel}
                </button>
              ) : null}
            </div>
          ) : (
            <ol className="card-grid">
              {shown.map(({ product, category: c }) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  eyebrow={c.name}
                  cta={s.cardCta}
                  soldOutLabel={s.soldOutLabel}
                />
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}
