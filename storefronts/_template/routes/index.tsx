import { Link } from 'react-router-dom';
import { formatCents, useCatalog, useKernel, useStore } from '@vendua/kernel';

/**
 * Catalog — the storefront's required index route. Renders Core's catalog
 * grouped by category; every card is a `data-vendua="product-link"` anchor so
 * the commerce flow is traceable from the grid to checkout.
 */
export function CatalogPage() {
  const { store } = useStore();
  const { categories, loading, error } = useCatalog();
  const { invalidate } = useKernel();

  return (
    <main className="container page">
      <header className="page-head">
        <h1>{store?.name ?? 'Cardápio'}</h1>
        {store?.tagline ? <p className="muted">{store.tagline}</p> : null}
      </header>

      {loading && categories.length === 0 ? (
        <div className="grid" aria-busy="true" aria-label="Carregando cardápio">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card card--skeleton" aria-hidden="true">
              <div className="card-figure" />
              <p className="sk-line" />
              <p className="sk-line sk-line--short" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty" role="alert">
          <p>O cardápio não carregou.</p>
          <p className="muted">{error.message}</p>
          <button type="button" className="btn" onClick={() => invalidate('catalog')}>
            Tentar novamente
          </button>
        </div>
      ) : categories.every((c) => c.products.length === 0) ? (
        <div className="empty">
          <p>O cardápio ainda está vazio.</p>
          <button type="button" className="btn-ghost" onClick={() => invalidate('catalog')}>
            Atualizar
          </button>
        </div>
      ) : (
        categories.map((c) =>
          c.products.length === 0 ? null : (
            <section key={c.id} aria-labelledby={`cat-${c.slug}`} className="cat-section">
              <h2 id={`cat-${c.slug}`}>{c.name}</h2>
              <ol className="grid">
                {c.products.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/produto/${p.slug}`}
                      className="card"
                      data-vendua="product-link"
                      data-status={p.status}
                      aria-label={
                        p.status === 'sold_out'
                          ? `${p.name}, esgotado`
                          : `${p.name}, ${formatCents(p.basePriceCents, store?.currency)}`
                      }
                    >
                      <div className="card-figure" aria-hidden="true" data-figure={p.figureVariant}>
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                      <p className="card-name">{p.name}</p>
                      {p.description ? <p className="card-desc muted">{p.description}</p> : null}
                      <p className="card-price">
                        {p.status === 'sold_out' ? (
                          <span className="flag">Esgotado</span>
                        ) : (
                          formatCents(p.basePriceCents, store?.currency)
                        )}
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ),
        )
      )}
    </main>
  );
}
