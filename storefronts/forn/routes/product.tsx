import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProduct } from '@vendua/kernel';
import type { FornProduct } from '../components/catalog-ext.ts';
import { Shell } from '../components/shell.tsx';
import { TakeButton } from '../components/take-button.tsx';
import { ProductFigure } from '../components/marks.tsx';
import { Price } from './index.tsx';
import { brl } from '../components/format.ts';

export default function ProductPage() {
  const { slug = '' } = useParams();
  const { product, loading, error } = useProduct(slug);
  const p = product as (typeof product & { figureVariant?: string }) | undefined;

  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Record<string, string[]>>({});

  const groups = product?.modifierGroups ?? [];
  const satisfied = useMemo(
    () => groups.every((g) => !g.required || (sel[g.id]?.length ?? 0) >= Math.max(1, g.minSelect)),
    [groups, sel],
  );
  const modifierIds = Object.values(sel).flat();

  const toggle = (groupId: string, modId: string, max: number) => {
    setSel((prev) => {
      const cur = prev[groupId] ?? [];
      const next = cur.includes(modId)
        ? cur.filter((id) => id !== modId)
        : max <= 1
          ? [modId]
          : cur.length >= max
            ? cur
            : [...cur, modId];
      return { ...prev, [groupId]: next };
    });
  };

  return (
    <Shell>
      {loading ? (
        <div className="product-page" aria-hidden="true">
          <div className="product-fig" />
          <div>
            <div className="skeleton-bar" style={{ width: '55%', height: 34 }} />
            <div className="skeleton-bar" style={{ width: '80%', marginTop: 14 }} />
            <div className="skeleton-bar" style={{ width: '30%', marginTop: 18 }} />
          </div>
        </div>
      ) : error ? (
        <div className="err-panel">
          <h2>saiu da vitrine</h2>
          <p>Esse item não está mais na fornada — ou a conexão caiu no caminho.</p>
          <Link to="/" className="link-btn ghost">
            voltar pra vitrine
          </Link>
        </div>
      ) : p ? (
        <article className="product-page">
          <div className="product-fig" aria-hidden="true">
            <ProductFigure variant={p.figureVariant} size={96} />
          </div>
          <div className="product-info">
            <Link to="/" className="cat microcaps">
              ← vitrine
            </Link>
            <h1>{p.name}</h1>
            {p.description ? <p className="desc">{p.description}</p> : null}
            <p className="price mono">
              <Price cents={p.basePriceCents} />
            </p>

            {p.status !== 'active' ? (
              <p className="soldout-hero">
                Acabou hoje — a fornada é pequena e sai cedo. Amanhã tem de novo, a partir das 6h30.
              </p>
            ) : null}

            {groups.map((g) => (
              <div className="mod-group" key={g.id}>
                <div className="mod-name microcaps">
                  {g.name}
                  {g.required ? ' · obrigatório' : ''}
                  {g.maxSelect > 1 ? ` · até ${g.maxSelect}` : ''}
                </div>
                <div className="mod-chips" role="group" aria-label={g.name}>
                  {g.modifiers.map((m) => {
                    const on = (sel[g.id] ?? []).includes(m.id);
                    const disabled = m.status !== 'active';
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="mod-chip"
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => toggle(g.id, m.id, g.maxSelect)}
                      >
                        {m.name}
                        {m.priceDeltaCents > 0 ? (
                          <span className="delta">+{brl(m.priceDeltaCents)}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {p.status === 'active' ? (
              <div className="buy-strip">
                <span className="qty-pick" role="group" aria-label="quantidade">
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
                    disabled={qty >= 12}
                    onClick={() => setQty((q) => Math.min(12, q + 1))}
                  >
                    +
                  </button>
                </span>
                {satisfied ? (
                  <TakeButton
                    product={p}
                    qty={qty}
                    modifierIds={modifierIds}
                    label="botar na sacola"
                  />
                ) : (
                  <button type="button" className="take-btn" disabled>
                    escolhe ali em cima
                  </button>
                )}
              </div>
            ) : (
              <div className="buy-strip">
                <TakeButton product={p} />
              </div>
            )}
          </div>
        </article>
      ) : null}
    </Shell>
  );
}
