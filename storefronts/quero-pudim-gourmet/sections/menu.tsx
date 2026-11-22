import { RefreshCw, Search, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlockArea,
  defineSection,
  text,
  useCopy,
  useMenu,
  usePageContext,
  useReducedMotion,
  useScrollSpy,
  type SectionProps,
} from '@vendua/kernel';
import { DIETARY_FILTERS, DIETARY_LABEL } from '@vendua/kernel/rules';
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
    inBagLabel: text({ max: 30, default: '' }),
    allInBagLabel: text({ max: 30, default: '' }),
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

// a category lights its tab once its top passes under the header and the tab strip
const SPY_MARGIN = '-140px 0px -55% 0px';

export default function Menu({ settings: s }: SectionProps<typeof schema>) {
  const [query, setQuery] = useState('');
  const [diet, setDiet] = useState<string[]>([]);
  // the whole menu feeds the tab strip; the searched/filtered one, the results
  const { categories: menu, loading, error, refetch } = useMenu();
  const availableDiets = useMemo(() => {
    const present = new Set<string>();
    for (const c of menu)
      for (const p of c.products) for (const t of p.dietary ?? []) present.add(t);
    return DIETARY_FILTERS.filter((tag) => present.has(tag));
  }, [menu]);
  const chosen = useMemo(
    () => diet.filter((id) => availableDiets.includes(id)),
    [diet, availableDiets],
  );
  const found = useMenu({ query, dietary: chosen });
  const { page } = usePageContext();
  const { vocabulary } = useCopy();
  const still = useReducedMotion();
  const q = query.trim();
  const narrowed = q !== '' || chosen.length > 0;
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const jumping = useRef(false);
  const jumpCleanup = useRef<(() => void) | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);

  const labels: DishLabels = {
    add: s.addLabel,
    soldOut: s.soldOutLabel,
    lowStock: s.lowStockLabel,
    preorder: s.preorderLabel,
    inBag: s.inBagLabel || vocabulary.inBag,
    allInBag: s.allInBagLabel || `tudo ${vocabulary.inBag}`,
  };

  const results = narrowed
    ? found.categories.flatMap((c) => c.products.map((p) => ({ product: p, category: c.name })))
    : [];

  const spied = useScrollSpy(narrowed ? [] : menu.map((c) => `cat-${c.slug}`), {
    rootMargin: SPY_MARGIN,
  });
  // a tapped tab owns the highlight until its scroll lands and the reading moves on
  useEffect(() => {
    if (!jumping.current) setTapped(null);
  }, [spied]);
  useEffect(() => () => jumpCleanup.current?.(), []);
  const active = tapped ?? spied?.slice(4) ?? null;

  // keep the lit tab in view inside the strip, without moving the page
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = active
      ? Array.from(strip?.querySelectorAll<HTMLElement>('[data-cat]') ?? []).find(
          (el) => el.dataset.cat === active,
        )
      : null;
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.clientWidth / 2 + tab.clientWidth / 2;
    strip.scrollTo({ left, behavior: still ? 'auto' : 'smooth' });
  }, [active, still]);

  const goTo = (slug: string) => {
    jumpCleanup.current?.();
    setQuery('');
    setDiet([]);
    setTapped(slug);
    jumping.current = true;
    const release = () => {
      jumping.current = false;
      window.removeEventListener('scrollend', release);
      window.clearTimeout(timer);
      if (jumpCleanup.current === release) jumpCleanup.current = null;
    };
    window.addEventListener('scrollend', release);
    // browsers without scrollend (and a jump that doesn't move) still hand the strip back
    const timer = window.setTimeout(release, 1200);
    jumpCleanup.current = release;
    requestAnimationFrame(() =>
      document
        .getElementById(`cat-${slug}`)
        ?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' }),
    );
  };

  const toggleDiet = (id: string) =>
    setDiet((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const Title = page === 'catalog' ? 'h1' : 'h2';
  const CatTitle = s.title ? (page === 'catalog' ? 'h2' : 'h3') : 'h2';
  const bare = !loading && !error && menu.length === 0;

  return (
    <section id="cardapio" className="menu" aria-label={s.title || s.categoriesLabel}>
      {s.title ? <Title className="menu-title">{s.title}</Title> : null}

      <div className="menu-bar" hidden={bare || undefined}>
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

        {availableDiets.length > 0 ? (
          <div className="menu-diets" role="group" aria-label={s.categoriesLabel}>
            {availableDiets.map((tag) => {
              const on = chosen.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className="menu-diet"
                  aria-pressed={on}
                  onClick={() => toggleDiet(tag)}
                >
                  {DIETARY_LABEL[tag]}
                </button>
              );
            })}
          </div>
        ) : null}

        {menu.length > 1 ? (
          <nav className="menu-tabs" aria-label={s.categoriesLabel}>
            <div className="menu-tabs-strip" ref={tabsRef}>
              {menu.map((c) => (
                <a
                  key={c.id}
                  href={`#cat-${c.slug}`}
                  data-cat={c.slug}
                  className="menu-tab"
                  aria-current={!narrowed && active === c.slug ? 'true' : undefined}
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

      {loading && menu.length === 0 ? (
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
      ) : error && menu.length === 0 ? (
        <div role="alert" className="menu-empty">
          <RefreshCw size={24} aria-hidden="true" />
          <p className="menu-empty-title">{s.errorTitle}</p>
          <button type="button" className="menu-pill" onClick={refetch}>
            {s.retryLabel}
          </button>
        </div>
      ) : narrowed ? (
        results.length ? (
          <div className="menu-cat">
            <CatTitle className="menu-cat-title">
              {s.resultsLabel} <span className="menu-count tnum">{results.length}</span>
            </CatTitle>
            <ol className="menu-list">
              {results.map(({ product, category }) => (
                <DishRow key={product.id} product={product} category={category} labels={labels} />
              ))}
            </ol>
          </div>
        ) : (
          <div className="menu-empty" role="status">
            <SearchX size={24} aria-hidden="true" />
            <p className="menu-empty-title">{s.noMatchTitle}</p>
            <button
              type="button"
              className="menu-pill"
              onClick={() => {
                setQuery('');
                setDiet([]);
              }}
            >
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
            <CatTitle id={`cat-${c.slug}-h`} className="menu-cat-title">
              {c.name} <span className="menu-count tnum">{c.products.length}</span>
            </CatTitle>
            {c.description ? <p className="menu-cat-desc">{c.description}</p> : null}
            <ol className="menu-list">
              {c.products.map((p) => (
                <DishRow key={p.id} product={p} category={c.name} labels={labels} />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}
