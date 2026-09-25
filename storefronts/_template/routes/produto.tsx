import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddToCart, ApiError, formatCents, useKernel, useProduct, useStore } from '@vendua/kernel';

export function ProductPage() {
  const { slug = '' } = useParams();
  const { product, loading, error } = useProduct(slug);
  const { invalidate } = useKernel();
  const { store, status } = useStore();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [cartError, setCartError] = useState<string | null>(null);

  const groups = useMemo(() => product?.modifierGroups ?? [], [product]);
  const chosenIds = useMemo(() => Object.values(selected).flat(), [selected]);
  const missingRequired = groups.filter(
    (g) => g.required && (selected[g.id]?.length ?? 0) < Math.max(1, g.minSelect),
  );

  if (loading && !product) {
    return (
      <main id="main" className="container page" aria-busy="true" aria-label="Carregando produto">
        <div className="product-grid">
          <div className="card-figure" aria-hidden="true" />
          <div>
            <p className="sk-line" />
            <p className="sk-line sk-line--short" />
            <p className="sk-line" />
          </div>
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main id="main" className="container page">
        <div className="empty" role={error ? 'alert' : undefined}>
          <h1>{error ? 'Não foi possível carregar o produto.' : 'Produto não encontrado.'}</h1>
          {error ? (
            <button type="button" className="btn" onClick={() => invalidate(`product:${slug}`)}>
              Tentar novamente
            </button>
          ) : (
            <Link to="/" className="btn">
              Voltar ao cardápio
            </Link>
          )}
        </div>
      </main>
    );
  }

  const soldOut = product.status === 'sold_out';

  const toggle = (groupId: string, modifierId: string, single: boolean, max: number) => {
    setSelected((prev) => {
      const cur = prev[groupId] ?? [];
      if (cur.includes(modifierId)) {
        return { ...prev, [groupId]: cur.filter((id) => id !== modifierId) };
      }
      if (single) return { ...prev, [groupId]: [modifierId] };
      if (cur.length >= max) return prev;
      return { ...prev, [groupId]: [...cur, modifierId] };
    });
  };

  return (
    <main id="main" className="container page">
      <Link to="/" className="back-link">
        ← Voltar ao cardápio
      </Link>

      <div className="product-grid">
        <div
          className="card-figure card-figure--lg"
          aria-hidden="true"
          data-figure={product.figureVariant}
        >
          {product.name.slice(0, 1).toUpperCase()}
        </div>

        <div>
          <h1>{product.name}</h1>
          <p className="price-lg">{formatCents(product.basePriceCents, store?.currency)}</p>
          {product.description ? <p className="muted">{product.description}</p> : null}

          {groups.map((g) => {
            const single = g.maxSelect === 1;
            const sel = selected[g.id] ?? [];
            return (
              <fieldset key={g.id} className="mod-group">
                <legend>
                  {g.name}
                  <span className="muted">
                    {' '}
                    — {g.required ? 'obrigatório' : 'opcional'}
                    {single
                      ? ''
                      : g.required
                        ? `, ${Math.max(1, g.minSelect)}–${g.maxSelect}`
                        : `, até ${g.maxSelect}`}
                  </span>
                </legend>
                <ul className="mod-list" role={single ? 'radiogroup' : 'group'} aria-label={g.name}>
                  {g.modifiers.map((m) => {
                    const isSel = sel.includes(m.id);
                    const modSoldOut = m.status === 'sold_out';
                    const capped = !isSel && !single && sel.length >= g.maxSelect;
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          role={single ? 'radio' : 'checkbox'}
                          aria-checked={isSel}
                          disabled={modSoldOut || capped}
                          className="mod-item"
                          data-selected={isSel || undefined}
                          onClick={() => toggle(g.id, m.id, single, g.maxSelect)}
                        >
                          <span>{m.name}</span>
                          {modSoldOut ? <span className="muted"> esgotado</span> : null}
                          {m.priceDeltaCents !== 0 ? (
                            <span className="muted">
                              {' '}
                              {m.priceDeltaCents > 0 ? '+' : '−'}
                              {formatCents(Math.abs(m.priceDeltaCents), store?.currency)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}

          {!soldOut ? (
            <div className="buy-row">
              <div className="qty" role="group" aria-label="Quantidade">
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  disabled={qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                >
                  −
                </button>
                <output aria-live="polite">{qty}</output>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  disabled={qty >= 99}
                  onClick={() => setQty((q) => Math.min(99, q + 1))}
                >
                  +
                </button>
              </div>

              <AddToCart
                product={product}
                qty={qty}
                modifierIds={chosenIds}
                asChild
                onAdded={() => navigate('/cart')}
                onError={(err) =>
                  setCartError(
                    err instanceof ApiError && err.code === 'MODIFIER_REQUIRED'
                      ? 'Escolha as opções obrigatórias antes de adicionar.'
                      : `Não foi possível adicionar (${err.message}).`,
                  )
                }
              >
                <button
                  type="button"
                  className="btn"
                  disabled={missingRequired.length > 0 || status === 'paused'}
                >
                  Adicionar à sacola · {formatCents(product.basePriceCents, store?.currency)}
                  {qty > 1 ? ` ×${qty}` : ''}
                </button>
              </AddToCart>

              {missingRequired.length > 0 ? (
                <p className="muted" role="note">
                  Falta escolher: {missingRequired.map((g) => g.name).join(', ')}.
                </p>
              ) : null}
              {status === 'paused' ? (
                <p className="alert" role="status">
                  A loja está pausada agora — volte em instantes.
                </p>
              ) : null}
              {cartError ? (
                <p className="alert" role="alert">
                  {cartError}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="alert" role="status">
              Esgotado no momento.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
