import { RefreshCw, Search, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlockArea,
  defineSection,
  number,
  text,
  useCatalog,
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
    itemSingular: text({ max: 20, default: 'item' }),
    itemPlural: text({ max: 20, default: 'itens' }),
    cardCta: text({ max: 30, default: 'Ver produto' }),
    soldOutLabel: text({ max: 30, default: 'Esgotado hoje' }),
    lowStockThreshold: number({ min: 1, max: 20, default: 5 }),
    emptyTitle: text({ max: 80, default: 'Nada por aqui ainda' }),
    emptyText: text({ max: 200, default: '' }),
    noMatchTitle: text({ max: 80, default: 'Nada encontrado' }),
    resetLabel: text({ max: 40, default: 'Ver tudo' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

export default function CatalogBrowser({ settings: s }: SectionProps<typeof schema>) {
  const { categories, loading, error, refetch } = useCatalog();
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const hashDone = useRef(false);

  const all = useMemo(
    () =>
      categories.flatMap((c) =>
        c.products.filter((p) => p.status !== 'archived').map((p) => ({ product: p, category: c })),
      ),
    [categories],
  );
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return all.filter(
      ({ product, category: c }) =>
        (category === 'all' || c.id === category) &&
        (!q ||
          normalize(product.name).includes(q) ||
          normalize(product.description ?? '').includes(q)),
    );
  }, [all, category, query]);

  // one-shot #produto-<slug> deep link — scrolls to and highlights the card
  useEffect(() => {
    if (hashDone.current || all.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#produto-')) return;
    hashDone.current = true;
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
      setHighlighted(id);
      window.setTimeout(() => setHighlighted((cur) => (cur === id ? null : cur)), 2000);
    });
  }, [all]);

  const hasFilters = query.trim() !== '' || category !== 'all';

  return (
    <>
      <section className="container catalog-head">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        <h1 className="display display-lg">
          {s.title}
        </h1>
        {s.lede ? (
          <p className="lede">
            {s.lede}
          </p>
        ) : null}
        <form
          role="search"
          className="search-wrap"
          onSubmit={(e) => e.preventDefault()}
        >
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
                aria-pressed={category === c.id}
                data-active={category === c.id || undefined}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </nav>
          <p role="status" className="catalog-count tnum">
            {categories.length > 0
              ? `${filtered.length} ${filtered.length === 1 ? s.itemSingular : s.itemPlural}`
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
          ) : filtered.length === 0 ? (
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
              {filtered.map(({ product, category: c }) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  eyebrow={c.name}
                  cta={s.cardCta}
                  soldOutLabel={s.soldOutLabel}
                  lowStockThreshold={s.lowStockThreshold}
                  highlighted={highlighted === `produto-${product.slug}`}
                />
              ))}
            </ol>
          )}
        </div>
      </section>

    </>
  );
}
