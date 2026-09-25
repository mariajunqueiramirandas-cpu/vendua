import { Link } from 'react-router-dom';
import { SurfaceRegion, useCatalog, useStore } from '@vendua/kernel';
import { BoardError, cents, closedDays, ManifestCode, SkeletonRows, windowLines } from './_ui';

// The menu as a night-shift dispatch manifest — no hero, no cards; the list IS the idea.
export function Board() {
  const { store, status } = useStore();
  const { categories, loading, error } = useCatalog();
  const closed = closedDays(store?.hours.windows ?? []);

  return (
    <main className="board">
      <div className="shift-strip">
        <span className="tag">{store?.name ?? 'Brasa Burger'}</span>
        <span>{store?.address ?? 'Zona Portuária'}</span>
        <span>{(store?.hours.windows ?? []).map((w) => `${w.open}–${w.close}`).join('  ·  ')}</span>
        {closed.length ? <span>sem chapa: {closed.join(' · ')}</span> : null}
        {status === 'open' && store ? <span>mínimo {cents(store.minOrderCents)}</span> : null}
      </div>

      <h1 className="tagline">
        Smash na chapa. <em>Fogo de verdade.</em>
      </h1>
      <p
        className="dim"
        style={{
          fontFamily: 'var(--v-font-mono)',
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {windowLines(store?.hours.windows ?? []).join('  ·  ') || 'abrindo…'} — monte a comanda, a
        gente prensa na hora.
      </p>

      <SurfaceRegion name="catalog.notices" />

      {error ? <BoardError error={error} /> : null}
      {loading && !error ? <SkeletonRows n={6} /> : null}

      {categories.map((cat) => (
        <section className="cat" key={cat.id} aria-labelledby={`cat-${cat.id}`}>
          <div className="cathead">
            <span className="idx">Nº {String(cat.sort).padStart(2, '0')}</span>
            <h2 id={`cat-${cat.id}`}>{cat.name}</h2>
            <span className="hazard-hair" aria-hidden="true" />
          </div>
          {cat.products.map((p, i) => (
            <Link
              key={p.id}
              to={`/produto/${p.slug}`}
              className={`mrow${p.status === 'sold_out' ? ' is-soldout' : ''}`}
              aria-label={`${p.name}, ${cents(p.basePriceCents)}${p.status === 'sold_out' ? ', esgotado' : ''}`}
            >
              <ManifestCode cat={cat.sort} idx={i} />
              <span>
                <span className="name">{p.name}</span>
                {p.description ? <p className="desc">{p.description}</p> : null}
              </span>
              <span className="price">{cents(p.basePriceCents)}</span>
              <span className="go" aria-hidden="true">
                →
              </span>
              {p.status === 'sold_out' ? <span className="tape">Esgotado</span> : null}
            </Link>
          ))}
        </section>
      ))}

      <footer className="foot">
        <div className="col">
          <b>Turno da chapa</b>
          {(store?.hours.windows ?? []).map((w, i) => (
            <span key={i}>
              {w.open}–{w.close}
            </span>
          ))}
          {closed.length ? <span>apagada {closed.join(', ').toLowerCase()}</span> : null}
        </div>
        <div className="col">
          <b>Entrega</b>
          <span>Zona Portuária + Centro</span>
          {store ? <span>mínimo {cents(store.minOrderCents)}</span> : null}
        </div>
        <div className="col">
          <b>Retirada</b>
          <span>{store?.address ?? '—'}</span>
        </div>
      </footer>
    </main>
  );
}
