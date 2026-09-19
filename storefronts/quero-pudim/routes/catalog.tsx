import { RefreshCw, Search, SearchX, ShoppingBag, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart, useCatalog, useKernel } from '@vendua/kernel';
import type { CatalogProduct } from '@vendua/kernel';
import { Price } from './_components/Price.tsx';
import { ProductFigure, type FigureVariant } from './_components/ProductFigure.tsx';
import { Skeleton } from './_components/Skeleton.tsx';
import { setLastSeenItem } from './_lib/lastSeen.ts';

/**
 * Nosso cardápio — ficha grid over a category tab bar, with diacritic-blind
 * search, #produto-<slug> deep links (scroll + highlight), the "Sob encomenda"
 * virtual tab when the platform exposes it, and the floating sacola bar.
 */

type ListedProduct = CatalogProduct & {
  figureVariant?: FigureVariant;
  imageUrl?: string | null;
  requiresPreorder?: boolean;
  stockQuantity?: number;
};

const PREORDER_TAB = 'sob-encomenda';
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

const formatAria = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

function CardImage({ product }: { product: ListedProduct }) {
  const [failed, setFailed] = useState(false);
  if (product.imageUrl && !failed) {
    return (
      <img
        src={product.imageUrl}
        alt={product.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="card-img"
      />
    );
  }
  return (
    <div className="card-figure">
      <ProductFigure variant={product.figureVariant ?? 'default'} title={product.name} />
    </div>
  );
}

function ProductCard({
  product,
  category,
  highlighted,
  onSeen,
}: {
  product: ListedProduct;
  category: string;
  highlighted: boolean;
  onSeen: () => void;
}) {
  const soldOut = product.status === 'sold_out';
  const preorder = product.requiresPreorder === true;
  const lowStock =
    !soldOut &&
    !preorder &&
    typeof product.stockQuantity === 'number' &&
    product.stockQuantity > 0 &&
    product.stockQuantity <= 5;
  return (
    <li
      id={`produto-${product.slug}`}
      data-item-card
      className={soldOut ? 'card--soldout' : undefined}
    >
      <Link
        to={`/produto/${product.slug}`}
        className="card-link"
        onClick={onSeen}
        aria-label={`${product.name}, ${formatAria(product.basePriceCents)}${soldOut ? ', esgotado' : preorder ? ', sob encomenda' : lowStock ? `, restam ${product.stockQuantity} unidades` : ''}`}
      >
        <div className={`print-frame${highlighted ? ' print-frame--hit' : ''}`}>
          <div className="card-frame">
            <CardImage product={product} />
            {soldOut ? <span className="soldout-flag">Esgotado hoje</span> : null}
            {!soldOut && preorder ? (
              <span className="soldout-flag soldout-flag--preorder">Sob encomenda</span>
            ) : null}
            {!soldOut && !preorder && lowStock ? (
              <span className="soldout-flag soldout-flag--low">Restam {product.stockQuantity}</span>
            ) : null}
          </div>
        </div>
        <p className="card-cat">{category}</p>
        <h3 className="card-name">{product.name}</h3>
        <div className="card-foot">
          <Price cents={product.basePriceCents} className="card-price" />
          <span className="card-cta">Ver produto</span>
        </div>
      </Link>
    </li>
  );
}

export function CatalogPage() {
  const { categories, loading, error } = useCatalog();
  const { cart } = useCart();
  const { invalidate } = useKernel();
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const hashDone = useRef(false);

  const allProducts = useMemo(
    () =>
      categories.flatMap((c) =>
        c.products.map((p) => ({ product: p as ListedProduct, category: c })),
      ),
    [categories],
  );
  const hasPreorder = allProducts.some(({ product }) => product.requiresPreorder === true);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return allProducts.filter(({ product, category: c }) => {
      const catOk =
        category === 'all'
          ? true
          : category === PREORDER_TAB
            ? product.requiresPreorder === true
            : c.id === category;
      if (!catOk) return false;
      if (!q) return true;
      return (
        normalize(product.name).includes(q) ||
        (product.description != null && normalize(product.description).includes(q))
      );
    });
  }, [allProducts, category, query]);

  // One-shot deep link: /catalog#produto-<slug> scrolls to + highlights the
  // card, pre-selecting its category tab if needed.
  useEffect(() => {
    if (hashDone.current || allProducts.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#produto-')) {
      if (hash === '#cardapio') {
        hashDone.current = true;
        document.getElementById('cardapio')?.scrollIntoView();
      }
      return;
    }
    const slug = hash.slice('#produto-'.length);
    const hit = allProducts.find(({ product }) => product.slug === slug);
    if (!hit) return;
    hashDone.current = true;
    if (hit.product.status !== 'archived') {
      setCategory(hit.product.requiresPreorder === true ? category : hit.category.id);
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(`produto-${slug}`);
      if (!el) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
      setHighlightedId(`produto-${slug}`);
      window.setTimeout(
        () => setHighlightedId((cur) => (cur === `produto-${slug}` ? null : cur)),
        2000,
      );
    });
  }, [allProducts, category]);

  const itemCount = cart?.totals.itemCount ?? 0;
  const hasFilters = query.trim() !== '' || category !== 'all';
  const showSkeleton = loading && categories.length === 0;

  return (
    <main>
      <section className="container" style={{ paddingBlock: '40px 32px' }}>
        <p className="eyebrow">Escolha o seu favorito</p>
        <h1 className="display display-lg" style={{ marginTop: 12 }}>
          Nosso cardápio
        </h1>
        <p className="lede small muted" style={{ marginTop: 12, maxWidth: '36rem' }}>
          Para um mimo só seu ou para dividir à mesa.
        </p>
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
            Buscar no cardápio
          </label>
          <input
            id="busca"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            className="search-input"
            placeholder="Qual sabor você procura?"
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
            <button
              type="button"
              className="cat-tab"
              aria-pressed={category === 'all'}
              data-active={category === 'all' || undefined}
              onClick={() => {
                hashDone.current = true;
                setCategory('all');
              }}
            >
              Todos os doces
            </button>
            {hasPreorder ? (
              <button
                type="button"
                className="cat-tab"
                aria-pressed={category === PREORDER_TAB}
                data-active={category === PREORDER_TAB || undefined}
                onClick={() => {
                  hashDone.current = true;
                  setCategory(PREORDER_TAB);
                }}
              >
                Sob encomenda
              </button>
            ) : null}
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cat-tab"
                aria-pressed={category === c.id}
                data-active={category === c.id || undefined}
                onClick={() => {
                  hashDone.current = true;
                  setCategory(c.id);
                }}
              >
                {c.name}
              </button>
            ))}
          </nav>
          <p role="status" className="small muted tnum" style={{ margin: 0, minHeight: 16 }}>
            {categories.length > 0
              ? `${filtered.length} ${filtered.length === 1 ? 'doce' : 'doces'}`
              : ''}
          </p>
        </div>

        <div style={{ marginTop: 40 }}>
          {showSkeleton ? (
            <div className="card-grid" aria-busy="true" aria-label="Carregando cardápio">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i}>
                  <Skeleton style={{ aspectRatio: '1', width: '100%' }} />
                  <div style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
                    <Skeleton style={{ height: 12, width: '45%' }} />
                    <Skeleton style={{ height: 22, width: '80%' }} />
                    <Skeleton style={{ height: 18, width: '55%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error && categories.length === 0 ? (
            <div role="alert" className="empty-state ficha-rule">
              <RefreshCw size={20} style={{ color: 'var(--brand-700)' }} aria-hidden="true" />
              <h3>O cardápio não carregou</h3>
              <p>{error.message}</p>
              <button type="button" className="btn" onClick={() => invalidate('catalog')}>
                Tentar novamente
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state ficha-rule">
              <SearchX size={20} style={{ color: 'var(--brand-700)' }} aria-hidden="true" />
              <h3>{hasFilters ? 'Esse sabor ainda não apareceu' : 'Novos doces vêm por aí'}</h3>
              <p>
                {hasFilters
                  ? `Nada encontrado para ${query.trim() ? `“${query.trim()}”` : 'esse filtro'}. Veja todos os doces do nosso cardápio.`
                  : 'Estamos preparando o cardápio. Volte daqui a pouco para escolher o seu favorito.'}
              </p>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  hasFilters ? (setQuery(''), setCategory('all')) : invalidate('catalog')
                }
              >
                {hasFilters ? 'Ver todos os doces' : 'Atualizar cardápio'}
              </button>
            </div>
          ) : (
            <ol className="card-grid">
              {filtered.map(({ product, category: cat }) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  category={cat.name}
                  highlighted={highlightedId === `produto-${product.slug}`}
                  onSeen={() =>
                    setLastSeenItem({
                      id: `produto-${product.slug}`,
                      slug: product.slug,
                      category: cat.id,
                    })
                  }
                />
              ))}
            </ol>
          )}
        </div>
      </section>

      {itemCount > 0 ? (
        <div className="floating-sacola">
          <Link to="/cart">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ShoppingBag size={16} aria-hidden="true" />
              {itemCount} {itemCount === 1 ? 'doce' : 'doces'} na sacola
            </span>
            <span style={{ fontWeight: 500 }}>Ver sacola</span>
          </Link>
        </div>
      ) : null}
    </main>
  );
}
