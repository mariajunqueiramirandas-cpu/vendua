import { RefreshCw, Search, SearchX, ShoppingBag, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlockArea,
  CartTrigger,
  ProductLink,
  defineSection,
  number,
  text,
  useCart,
  useCatalog,
  type CatalogProduct,
  type SectionProps,
} from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';
import { Skeleton } from './_shared/Skeleton.tsx';
import { formatBRL } from './_shared/format.ts';

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
    bagLabel: text({ max: 30, default: 'Ver sacola' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function Card({
  product,
  category,
  highlighted,
  s,
}: {
  product: CatalogProduct;
  category: string;
  highlighted: boolean;
  s: SectionProps<typeof schema>['settings'];
}) {
  const soldOut = product.status === 'sold_out';
  const stock = product.stockQuantity;
  // Core's lowStock (the merchant's threshold) wins; the section setting covers older Cores
  const low =
    !soldOut &&
    (product.lowStock ?? (typeof stock === 'number' && stock > 0 && stock <= s.lowStockThreshold));
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <li
      id={`produto-${product.slug}`}
      data-item-card
      className={soldOut ? 'card--soldout' : undefined}
    >
      <ProductLink product={product} asChild>
        <a
          className="card-link"
          aria-label={`${product.name}, ${formatBRL(product.basePriceCents)}${soldOut ? `, ${s.soldOutLabel}` : ''}`}
        >
          <div className={`print-frame${highlighted ? ' print-frame--hit' : ''}`}>
            <div className="card-frame">
              {product.imageUrl && !imgFailed ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setImgFailed(true)}
                  className="card-img"
                />
              ) : (
                <div className="card-figure">
                  <ProductFigure variant={product.figureVariant} title={product.name} />
                </div>
              )}
              {soldOut ? <span className="soldout-flag">{s.soldOutLabel}</span> : null}
              {low ? <span className="soldout-flag soldout-flag--low">Restam {stock}</span> : null}
              {!soldOut && product.requiresPreorder ? (
                <span className="soldout-flag soldout-flag--low">Encomenda</span>
              ) : null}
            </div>
          </div>
          <p className="card-cat">{category}</p>
          <h3 className="card-name">{product.name}</h3>
          <div className="card-foot">
            <span className="card-price">{formatBRL(product.basePriceCents)}</span>
            <span className="card-cta">{s.cardCta}</span>
          </div>
        </a>
      </ProductLink>
    </li>
  );
}

export default function CatalogBrowser({ settings: s }: SectionProps<typeof schema>) {
  const { categories, loading, error, refetch } = useCatalog();
  const { cart } = useCart();
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

  const itemCount = cart?.status === 'open' ? cart.totals.itemCount : 0;
  const hasFilters = query.trim() !== '' || category !== 'all';

  return (
    <>
      <section className="container" style={{ paddingBlock: '40px 32px' }}>
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        <h1 className="display display-lg" style={{ marginTop: 12 }}>
          {s.title}
        </h1>
        {s.lede ? (
          <p className="lede small muted" style={{ marginTop: 12, maxWidth: '36rem' }}>
            {s.lede}
          </p>
        ) : null}
        <form
          role="search"
          className="search-wrap"
          style={{ marginTop: 28 }}
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

      <section
        id="cardapio"
        className="container"
        style={{ paddingBottom: 80, scrollMarginTop: 120 }}
      >
        <div className="ficha-rule" style={{ paddingTop: 12 }} />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
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
          <p role="status" className="small muted tnum" style={{ margin: 0, minHeight: 16 }}>
            {categories.length > 0
              ? `${filtered.length} ${filtered.length === 1 ? s.itemSingular : s.itemPlural}`
              : ''}
          </p>
        </div>
        <BlockArea name="before-grid" />

        <div style={{ marginTop: 40 }}>
          {loading && categories.length === 0 ? (
            <div className="card-grid" aria-busy="true" aria-label="Carregando cardápio">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i}>
                  <Skeleton style={{ aspectRatio: '1', width: '100%' }} />
                  <div style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
                    <Skeleton style={{ height: 12, width: '45%' }} />
                    <Skeleton style={{ height: 22, width: '80%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error && categories.length === 0 ? (
            <div role="alert" className="empty-state ficha-rule">
              <RefreshCw size={20} aria-hidden="true" />
              <h3>{s.emptyTitle}</h3>
              <button type="button" className="btn" onClick={refetch}>
                Tentar novamente
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state ficha-rule">
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
                <Card
                  key={product.id}
                  product={product}
                  category={c.name}
                  highlighted={highlighted === `produto-${product.slug}`}
                  s={s}
                />
              ))}
            </ol>
          )}
        </div>
      </section>

      {itemCount > 0 ? (
        <div className="floating-sacola">
          <CartTrigger asChild>
            <button type="button">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ShoppingBag size={16} aria-hidden="true" />
                {itemCount} {itemCount === 1 ? s.itemSingular : s.itemPlural}
              </span>
              <span style={{ fontWeight: 500 }}>{s.bagLabel}</span>
            </button>
          </CartTrigger>
        </div>
      ) : null}
    </>
  );
}
