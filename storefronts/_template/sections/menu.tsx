import { RefreshCw, Search, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlockArea,
  defineSection,
  text,
  useCatalog,
  usePageContext,
  useStore,
  type SectionProps,
} from '@vendua/kernel';
import { DishRow, type DishLabels } from './_shared/Dish.tsx';

// The menu as a delivery app lays it out: search, a sticky strip of categories that follows the
// scroll, and every category as a list of dishes with the photo on the right.
export const schema = defineSection({
  type: 'store:menu',
  settings: {
    title: text({ max: 60 }),
    searchLabel: text({ max: 60, default: 'Buscar no cardápio' }),
    searchPlaceholder: text({ max: 60, default: 'Buscar no cardápio' }),
    categoriesLabel: text({ max: 40, default: 'Categorias do cardápio' }),
    addLabel: text({ max: 30, default: 'adicionar' }),
    soldOutLabel: text({ max: 30, default: 'esgotado' }),
    lowStockLabel: text({ max: 30, default: 'restam' }),
    preorderLabel: text({ max: 30, default: 'sob encomenda' }),
    inBagLabel: text({ max: 30, default: 'na sacola' }),
    allInBagLabel: text({ max: 30, default: 'tudo na sacola' }),
    resultsLabel: text({ max: 40, default: 'Resultados' }),
    emptyTitle: text({ max: 80, default: 'O cardápio está quase pronto' }),
    emptyText: text({ max: 200, default: 'Volte daqui a pouco para ver as novidades.' }),
    noMatchTitle: text({ max: 80, default: 'Nada com esse nome por aqui' }),
    resetLabel: text({ max: 40, default: 'limpar busca' }),
    errorTitle: text({ max: 80, default: 'Não deu para carregar o cardápio' }),
    retryLabel: text({ max: 40, default: 'tentar de novo' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Menu({ settings: s }: SectionProps<typeof schema>) {
  const { categories, loading, error, refetch } = useCatalog();
  const { store } = useStore();
  const { page } = usePageContext();
  const currency = store?.currency ?? 'BRL';
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hashDone = useRef(false);
  const jumping = useRef(false);

  const labels: DishLabels = {
    add: s.addLabel,
    soldOut: s.soldOutLabel,
    lowStock: s.lowStockLabel,
    preorder: s.preorderLabel,
    inBag: s.inBagLabel,
    allInBag: s.allInBagLabel,
  };

  // sold-out dishes sink to the end of their category
  const menu = useMemo(
    () =>
      categories
        .map((c) => ({
          ...c,
          products: c.products
            .filter((p) => p.status !== 'archived')
            .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active')),
        }))
        .filter((c) => c.products.length > 0),
    [categories],
  );

  const q = normalize(query.trim());
  const results = useMemo(
    () =>
      q
        ? menu.flatMap((c) =>
            c.products
              .filter(
                (p) =>
                  normalize(p.name).includes(q) ||
                  normalize(p.description ?? '').includes(q) ||
                  normalize(c.name).includes(q),
              )
              .map((p) => ({ product: p, category: c.name })),
          )
        : [],
    [menu, q],
  );

  // scroll-spy: the category nearest the top of the viewport lights its tab
  useEffect(() => {
    if (q || menu.length === 0) return;
    const els = menu
      .map((c) => document.getElementById(`cat-${c.slug}`))
      .filter((el): el is HTMLElement => !!el);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = els.find((el) => seen.get(el.id));
        // a tapped tab owns the highlight until its scroll lands
        if (first && !jumping.current) setActive(first.id.slice(4));
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [menu, q]);

  // keep the lit tab in view inside the strip, without moving the page
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.clientWidth / 2 + tab.clientWidth / 2;
    strip.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  // one-shot #produto-<slug> deep link: scroll to the dish and light it up
  useEffect(() => {
    if (hashDone.current || menu.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#produto-')) return;
    hashDone.current = true;
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      setHighlighted(id);
      window.setTimeout(() => setHighlighted((cur) => (cur === id ? null : cur)), 2200);
    });
  }, [menu]);

  const goTo = (slug: string) => {
    setQuery('');
    setActive(slug);
    jumping.current = true;
    const release = () => {
      jumping.current = false;
      window.removeEventListener('scrollend', release);
    };
    window.addEventListener('scrollend', release);
    // browsers without scrollend (and a jump that doesn't move) still hand the strip back
    window.setTimeout(release, 1200);
    requestAnimationFrame(() =>
      document
        .getElementById(`cat-${slug}`)
        ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }),
    );
  };

  const Title = page === 'catalog' ? 'h1' : 'h2';

  return (
    <section id="cardapio" className="menu" aria-label={s.title || s.categoriesLabel}>
      {s.title ? <Title className="menu-title">{s.title}</Title> : null}

      <div className="menu-bar">
        <form role="search" className="menu-search" onSubmit={(e) => e.preventDefault()}>
          <Search size={18} aria-hidden="true" className="menu-search-icon" />
          <label htmlFor="menu-busca" className="sr-only">
            {s.searchLabel}
          </label>
          <input
            ref={searchRef}
            id="menu-busca"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={80}
            placeholder={s.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="menu-search-clear"
              aria-label={s.resetLabel}
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </form>

        {menu.length > 1 ? (
          <nav className="menu-tabs" aria-label={s.categoriesLabel}>
            <div className="menu-tabs-strip" ref={tabsRef}>
              {menu.map((c) => (
                <a
                  key={c.id}
                  href={`#cat-${c.slug}`}
                  data-cat={c.slug}
                  className="menu-tab"
                  aria-current={!q && active === c.slug ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(c.slug);
                  }}
                >
                  {c.name}
                </a>
              ))}
            </div>
          </nav>
        ) : null}
      </div>

      <BlockArea name="before-grid" className="menu-blocks" />

      {loading && categories.length === 0 ? (
        <div className="menu-cat" aria-busy="true">
          <span className="skel skel-title" />
          <ol className="menu-list">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="dish dish-skel">
                <span className="dish-text">
                  <span className="skel" style={{ width: '60%' }} />
                  <span className="skel" style={{ width: '90%' }} />
                  <span className="skel" style={{ width: '30%' }} />
                </span>
                <span className="skel skel-media" />
              </li>
            ))}
          </ol>
        </div>
      ) : error && categories.length === 0 ? (
        <div role="alert" className="menu-empty">
          <RefreshCw size={24} aria-hidden="true" />
          <p className="menu-empty-title">{s.errorTitle}</p>
          <button type="button" className="menu-pill" onClick={refetch}>
            {s.retryLabel}
          </button>
        </div>
      ) : q ? (
        results.length ? (
          <div className="menu-cat">
            <h3 className="menu-cat-title">
              {s.resultsLabel} <span className="menu-count tnum">{results.length}</span>
            </h3>
            <ol className="menu-list">
              {results.map(({ product, category }) => (
                <DishRow
                  key={product.id}
                  product={product}
                  category={category}
                  currency={currency}
                  labels={labels}
                />
              ))}
            </ol>
          </div>
        ) : (
          <div className="menu-empty" role="status">
            <SearchX size={24} aria-hidden="true" />
            <p className="menu-empty-title">{s.noMatchTitle}</p>
            <button type="button" className="menu-pill" onClick={() => setQuery('')}>
              {s.resetLabel}
            </button>
          </div>
        )
      ) : menu.length === 0 ? (
        <div className="menu-empty">
          <p className="menu-empty-title">{s.emptyTitle}</p>
          {s.emptyText ? <p>{s.emptyText}</p> : null}
        </div>
      ) : (
        menu.map((c) => (
          <section
            key={c.id}
            id={`cat-${c.slug}`}
            className="menu-cat"
            aria-labelledby={`cat-${c.slug}-h`}
          >
            <h3 id={`cat-${c.slug}-h`} className="menu-cat-title">
              {c.name} <span className="menu-count tnum">{c.products.length}</span>
            </h3>
            <ol className="menu-list">
              {c.products.map((p) => (
                <DishRow
                  key={p.id}
                  product={p}
                  category={c.name}
                  currency={currency}
                  labels={labels}
                  highlighted={highlighted === `produto-${p.slug}`}
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}
