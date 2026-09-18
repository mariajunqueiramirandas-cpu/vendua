import { Link } from 'react-router-dom';
import { useCatalog, useStore } from '@vendua/kernel';
import { asFornCategories, type FornProduct } from '../components/catalog-ext.ts';
import { BagButton } from '../components/bag-button.tsx';
import { DayClock } from '../components/day-clock.tsx';
import { Colophon } from '../components/shell.tsx';
import { TakeButton } from '../components/take-button.tsx';
import { ProductFigure } from '../components/marks.tsx';
import { brl, hoursLines } from '../components/format.ts';

function CaseRow({ product }: { product: FornProduct }) {
  const out = product.status !== 'active';
  return (
    <div className={`case-row${out ? ' is-out' : ''}`}>
      <Link to={`/produto/${product.slug}`} className="case-cell-main">
        <span className="case-name">{product.name}</span>
        {out ? <span className="case-out-tag microcaps">acabou hoje</span> : null}
        {product.description ? <p className="case-desc">{product.description}</p> : null}
      </Link>
      <span className="case-price mono">
        <Price cents={product.basePriceCents} />
      </span>
      <TakeButton product={product} />
    </div>
  );
}

export function Price({ cents }: { cents: number }) {
  const s = brl(cents);
  const i = s.lastIndexOf(',');
  return (
    <>
      {s.slice(0, i)}
      <span className="cents">{s.slice(i)}</span>
    </>
  );
}

function LedgerSkeleton() {
  return (
    <div aria-hidden="true">
      {[72, 55, 64, 40].map((w, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton-bar" style={{ width: `${w}%`, marginBottom: 6 }} />
          <div className="skeleton-bar" style={{ width: `${w * 0.6}%`, height: 9 }} />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { store, status } = useStore();
  const { categories, loading, error } = useCatalog();
  const cats = asFornCategories(categories);

  return (
    <main className="page-fade">
      <header className="wrap masthead">
        <div className="masthead-meta microcaps">
          <span>{store?.city ?? 'padoca de bairro'}</span>
          <span>fornada diária · {store ? hoursLines(store).join(' + ') : '…'}</span>
          <span>{store?.deliveryEnabled ? 'balcão + entrega' : 'só balcão'}</span>
        </div>
        <div className="masthead-brand">
          <h1 className="wordmark">
            forn
            <span className="do-bairro">do bairro</span>
          </h1>
          <p className="masthead-note">
            {store?.tagline ?? 'pão de fermentação natural'}
            {store?.address ? ` — ${store.address}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <BagButton />
        </div>
      </header>

      <div className="wrap">
        <DayClock />
      </div>

      <section className="wrap ledger" aria-label="vitrine">
        <div className="ledger-intro">
          <h2>a vitrine</h2>
          <span className="mono microcaps" style={{ color: 'var(--mute)' }}>
            {status === 'closed' ? 'encomende pra próxima fornada' : 'sai da fornada, entra na sacola'}
          </span>
        </div>

        {loading ? <LedgerSkeleton /> : null}
        {error ? (
          <div className="err-panel">
            <h2>a vitrine não abriu</h2>
            <p>Não conseguimos falar com o balcão ({error.code}). Verifica a conexão e tenta de novo.</p>
            <button type="button" className="retry-btn" onClick={() => location.reload()}>
              recarregar
            </button>
          </div>
        ) : null}
        {!loading && !error && cats.every((c) => c.products.length === 0) ? (
          <div className="empty-panel">
            <h2>vitrine vazia</h2>
            <p>A fornada de hoje já saiu toda. Volta amanhã cedinho.</p>
          </div>
        ) : null}

        {cats.map((cat) =>
          cat.products.length === 0 ? null : (
            <section className="case-group" key={cat.id}>
              <div className="case-head">
                <h3>{cat.name}</h3>
                <span className="count mono microcaps">{String(cat.products.length).padStart(2, '0')}</span>
                <span className="rule" aria-hidden="true" />
              </div>
              {cat.products.map((p) => (
                <CaseRow key={p.id} product={p} />
              ))}
            </section>
          ),
        )}
      </section>

      <section className="wrap casa" aria-label="a casa">
        <div>
          <h3>a casa</h3>
          <p>{store?.description}</p>
          <p>
            <em>
              {status === 'closed'
                ? 'Porta fechada, forn quente: o pedido entra na fila e sai com a primeira fornada.'
                : 'Tira o pão da vitrine, a gente embrulha no papel.'}
            </em>
          </p>
          {store ? <ProductFigure variant={undefined} size={34} /> : null}
        </div>
        <ul className="casa-facts">
          <li>
            <span className="k">fornada</span>
            <span className="v mono">{store ? hoursLines(store).join(' + ') : '—'}</span>
          </li>
          <li>
            <span className="k">endereço</span>
            <span className="v">{store?.address ?? '—'}</span>
          </li>
          <li>
            <span className="k">entrega</span>
            <span className="v">{store?.deliveryEnabled ? 'balcão + entrega' : 'só retirada no balcão'}</span>
          </li>
          <li>
            <span className="k">pedido mínimo</span>
            <span className="v">{store && store.minOrderCents > 0 ? brl(store.minOrderCents) : 'sem mínimo'}</span>
          </li>
          <li>
            <span className="k">preparo</span>
            <span className="v">{store ? `~${store.prepTimeMinutes} min` : '—'}</span>
          </li>
          <li>
            <span className="k">whatsapp</span>
            <span className="v">
              {store?.whatsapp ? (
                <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noreferrer">
                  chama no zap
                </a>
              ) : (
                '—'
              )}
            </span>
          </li>
          <li>
            <span className="k">instagram</span>
            <span className="v">{store?.instagram ?? '—'}</span>
          </li>
        </ul>
      </section>

      <Colophon />
    </main>
  );
}
