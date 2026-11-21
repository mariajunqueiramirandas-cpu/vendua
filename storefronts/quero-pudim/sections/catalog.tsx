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
import { DIETARY_FILTERS } from '@vendua/kernel/rules';
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
    errorTitle: text({ max: 80, default: 'Não foi possível carregar o cardápio' }),
    noMatchTitle: text({ max: 80, default: 'Nada encontrado' }),
    resetLabel: text({ max: 40, default: 'Ver tudo' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

export default function CatalogBrowser({ settings: s }: SectionProps<typeof schema>) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [diet, setDiet] = useState<string[]>([]);
  // tabs: every category with something in it; the grid: the Kernel's search over the same menu
  const { categories, loading, error, refetch } = useMenu();
  const availableDiets = useMemo(() => {
    const present = new Set<string>();
    for (const c of categories)
      for (const p of c.products) for (const t of p.dietaryTags ?? []) present.add(t);
    return DIETARY_FILTERS.filter((f) => present.has(f.id));
  }, [categories]);
  const chosen = useMemo(
    () => diet.filter((id) => availableDiets.some((f) => f.id === id)),
    [diet, availableDiets],
  );
  const { categories: found } = useMenu({ query, dietary: chosen });
  const { vocabulary } = useCopy();
  const active = categories.some((c) => c.id === category) ? category : 'all';
  const shown = useMemo(
    () =>
      found
        .filter((c) => active === 'all' || c.id === active)
        .flatMap((c) => c.products.map((product) => ({ product, category: c }))),
    [found, active],
  );

  const hasFilters = query.trim() !== '' || active !== 'all' || chosen.length > 0;
  const toggleDiet = (id: string) =>
    setDiet((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

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
        {categories.length > 0 ? (
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
              {`${shown.length} ${plural(shown.length, s.itemSingular || vocabulary.itemSingular, s.itemPlural || vocabulary.itemPlural)}`}
            </p>
          </div>
        ) : null}
        {availableDiets.length > 0 ? (
          <div className="catalog-diets" role="group" aria-label="Filtros">
            {availableDiets.map((f) => {
              const on = chosen.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className="catalog-diet"
                  aria-pressed={on}
                  onClick={() => toggleDiet(f.id)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        ) : null}
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
              <h2>{s.errorTitle}</h2>
              <button type="button" className="btn" onClick={refetch}>
                Tentar novamente
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state">
              <SearchX size={20} aria-hidden="true" />
              <h2>{hasFilters ? s.noMatchTitle : s.emptyTitle}</h2>
              {!hasFilters && s.emptyText ? <p>{s.emptyText}</p> : null}
              {hasFilters ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                    setDiet([]);
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
                  anchor
                />
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}
