import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddToCart, SurfaceRegion, useProduct, useStore } from '@vendua/kernel';
import type { ProductDetail } from '@vendua/kernel';
import { BoardError, cents, EmberBars, ErrorPlate } from './_ui';

// Required groups gate the CTA client-side for UX; Core still enforces.
export function Produto() {
  const { slug = '' } = useParams();
  const { product, loading, error } = useProduct(slug);
  const { status } = useStore();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<{ code: string; message: string } | undefined>();

  const groups = product?.modifierGroups ?? [];
  const modifierIds = useMemo(() => Object.values(picked).flat(), [picked]);
  const requiredMissing = groups.filter(
    (g) => g.required && (picked[g.id]?.length ?? 0) < Math.max(1, g.minSelect),
  );
  const ready = requiredMissing.length === 0;

  if (loading) {
    return (
      <main className="spec" aria-busy="true" aria-label="carregando produto">
        <Backlink />
        <div className="sk" style={{ height: 90, width: '70%', marginTop: 40 }} />
        <div className="sk" style={{ height: 18, width: '40%', marginTop: 18 }} />
        <div className="sk" style={{ height: 120, marginTop: 34 }} />
      </main>
    );
  }

  if (error || !product) {
    return (
      <main className="spec">
        <Backlink />
        <BoardError error={error ?? { code: 'PRODUCT_NOT_FOUND', message: 'fora do manifesto' }} />
      </main>
    );
  }

  const soldOut = product.status !== 'active';

  return (
    <main className="spec">
      <Backlink />

      <span className="code">REGISTRO · {product.slug.toUpperCase()}</span>
      <h1>{product.name}</h1>
      <span className="price">{cents(product.basePriceCents)}</span>
      {product.description ? <p className="desc">{product.description}</p> : null}
      <p className="hint">
        {soldOut
          ? 'esgotado neste turno'
          : status === 'paused'
            ? 'chapa pausada — volta já'
            : 'preço base — adicionais somam na comanda'}
      </p>

      <SurfaceRegion name="product.notices" />

      {groups.map((g) => (
        <ModifierGroup
          key={g.id}
          group={g}
          selected={picked[g.id] ?? []}
          onPick={(ids) => {
            setPicked((p) => ({ ...p, [g.id]: ids }));
            setAdded(false);
            setAddError(undefined);
          }}
        />
      ))}

      {addError ? <ErrorPlate error={addError} /> : null}

      <div className="actionbar">
        <span className="qtysel" role="group" aria-label="quantidade">
          <button
            type="button"
            aria-label="diminuir"
            disabled={qty <= 1}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >
            −
          </button>
          <output aria-live="polite">{qty}</output>
          <button
            type="button"
            aria-label="aumentar"
            disabled={qty >= 99}
            onClick={() => setQty((q) => Math.min(99, q + 1))}
          >
            +
          </button>
        </span>

        <AddToCart
          product={product}
          qty={qty}
          modifierIds={modifierIds}
          asChild
          onAdded={() => {
            setAdded(true);
            setAddError(undefined);
          }}
          onError={(e) => setAddError(e)}
        >
          <button type="button" className="cta" disabled={!ready}>
            {soldOut
              ? 'Saiu da chapa'
              : ready
                ? 'Botar na chapa'
                : `Marca o ${requiredMissing[0]!.name}`}
          </button>
        </AddToCart>

        {added ? (
          <span className="added-note">
            na comanda ✓ <Link to="/sacola">ver →</Link>
          </span>
        ) : null}
      </div>
    </main>
  );
}

function Backlink() {
  return (
    <Link to="/" className="backlink">
      ← quadro
    </Link>
  );
}

function ModifierGroup({
  group,
  selected,
  onPick,
}: {
  group: ProductDetail['modifierGroups'][number];
  selected: string[];
  onPick: (ids: string[]) => void;
}) {
  const single = group.maxSelect === 1;
  const rule = group.required
    ? `obrigatório · ${Math.max(1, group.minSelect)}`
    : `opcional · até ${group.maxSelect}`;

  const toggle = (id: string) => {
    if (single) {
      onPick(selected[0] === id ? [] : [id]);
      return;
    }
    if (selected.includes(id)) onPick(selected.filter((s) => s !== id));
    else if (selected.length < group.maxSelect) onPick([...selected, id]);
  };

  return (
    <section className="group">
      <div className="group-head">
        <h3>{group.name}</h3>
        <span className={`rule${group.required ? ' req' : ''}`}>{rule}</span>
      </div>

      {single ? (
        <div className="dial" role="radiogroup" aria-label={group.name}>
          {group.modifiers.map((m, i) => {
            const isSel = selected.includes(m.id);
            const out = m.status === 'sold_out';
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={isSel}
                aria-label={`${m.name}${m.priceDeltaCents ? `, mais ${cents(m.priceDeltaCents)}` : ''}${out ? ', esgotado' : ''}`}
                className="dial-opt"
                disabled={out}
                onClick={() => toggle(m.id)}
              >
                <EmberBars level={Math.min(i + 1, 3) as 1 | 2 | 3} />
                {m.name}
                {m.priceDeltaCents ? (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ash)' }}>
                    +{cents(m.priceDeltaCents)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mods">
          {group.modifiers.map((m) => {
            const out = m.status === 'sold_out';
            const isSel = selected.includes(m.id);
            const atCap = !isSel && selected.length >= group.maxSelect;
            return (
              <label key={m.id} className={`mod${out ? ' is-out' : ''}`}>
                <input
                  type="checkbox"
                  checked={isSel}
                  disabled={out || atCap}
                  onChange={() => toggle(m.id)}
                />
                <span className="box" aria-hidden="true" />
                <span>{m.name}</span>
                <span className="delta">
                  {out ? 'acabou' : m.priceDeltaCents ? `+${cents(m.priceDeltaCents)}` : 'incluso'}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
