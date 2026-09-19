import {
  ArrowLeft,
  Bell,
  Check,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Snowflake,
  Truck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddToCart, ApiError, useKernel, useProduct, useStore } from '@vendua/kernel';
import type { ProductDetail } from '@vendua/kernel';
import { Price } from './_components/Price.tsx';
import { ProductFigure, type FigureVariant } from './_components/ProductFigure.tsx';
import { Skeleton } from './_components/Skeleton.tsx';
import { formatBRL } from './_lib/format.ts';
import { maskPhone, phoneDigits } from './_lib/profile.ts';
import { waLink } from './_lib/whatsapp.ts';

/**
 * Product detail — the ficha page: framed figure left, choices right.
 * Modifier groups render from Core's shape (required/min/max); the Kernel has
 * no modifier-picker primitive yet, so selection state lives here and the
 * chosen ids go into AddToCart untouched.
 *
 * Reference parity: stock badge and waitlist are defensive — Core does not
 * expose stockQuantity/requiresPreorder, and there is no waitlist endpoint,
 * so the sold-out state offers a WhatsApp deep link instead (OBSERVATIONS.md).
 */

type Detail = ProductDetail & {
  figureVariant?: FigureVariant;
  imageUrl?: string | null;
  stockQuantity?: number;
  requiresPreorder?: boolean;
};

export function ProductPage() {
  const { slug = '' } = useParams();
  const { product, loading, error } = useProduct(slug);
  const { invalidate } = useKernel();
  const { store, status } = useStore();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistPhone, setWaitlistPhone] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);

  const detail = product as Detail | null;
  const groups = useMemo(() => detail?.modifierGroups ?? [], [detail]);
  const chosenIds = useMemo(() => Object.values(selected).flat(), [selected]);
  const missingRequired = groups.filter(
    (g) => g.required && (selected[g.id]?.length ?? 0) < Math.max(1, g.minSelect),
  );
  const soldOut = product?.status === 'sold_out';
  const preorder = detail?.requiresPreorder === true;
  const stockQty = typeof detail?.stockQuantity === 'number' ? detail.stockQuantity : null;
  const lowStock = !soldOut && !preorder && stockQty !== null && stockQty > 0 && stockQty <= 5;
  const maxQty = preorder ? 99 : stockQty !== null ? Math.max(1, Math.min(99, stockQty)) : 99;

  const extrasCents = groups
    .flatMap((g) => g.modifiers)
    .filter((m) => chosenIds.includes(m.id))
    .reduce((s, m) => s + m.priceDeltaCents, 0);
  // Prices on the CTA show catalog components only — never a combined,
  // client-computed payable total (cart pricing is Core's answer, and a stale
  // catalog read must not promise a number Core won't honor).

  useEffect(() => {
    if (product && store) document.title = `${product.name} · ${store.name}`;
    return () => {
      if (store) document.title = `${store.name}`;
    };
  }, [product, store]);

  if (loading && !product) {
    return (
      <main
        className="container"
        style={{ paddingBlock: '32px 96px' }}
        aria-busy="true"
        aria-label="Carregando produto"
      >
        <Skeleton style={{ height: 44, width: 160, marginBottom: 32 }} />
        <div className="pd-grid">
          <Skeleton style={{ aspectRatio: '1', borderRadius: 12 }} />
          <div style={{ display: 'grid', gap: 20, paddingBlock: 32 }}>
            <Skeleton style={{ height: 16, width: '30%' }} />
            <Skeleton style={{ height: 56, width: '85%' }} />
            <Skeleton style={{ height: 28, width: '25%' }} />
            <Skeleton style={{ height: 90 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="container">
        <div className="empty-state" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
          <ShoppingBag size={32} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" />
          <h1 className="display display-lg">
            {error ? 'Não conseguimos carregar este doce.' : 'Esse doce não está no cardápio.'}
          </h1>
          <p role={error ? 'alert' : undefined}>
            {error
              ? 'Confira sua conexão e tente abrir o produto novamente.'
              : 'Encontre seu próximo favorito no cardápio de hoje.'}
          </p>
          {error ? (
            <button type="button" className="btn" onClick={() => invalidate(`product:${slug}`)}>
              Tentar novamente
            </button>
          ) : (
            <Link to="/catalog" className="btn">
              <ArrowLeft size={16} aria-hidden="true" /> Ver cardápio
            </Link>
          )}
        </div>
      </main>
    );
  }

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

  const onAdded = () => {
    setJustAdded(true);
    setCartError(null);
    window.setTimeout(() => navigate('/cart'), 450);
  };

  const onError = (err: { code: string; message: string }) => {
    setCartError(
      err instanceof ApiError && err.code === 'MODIFIER_REQUIRED'
        ? 'Escolha as opções obrigatórias antes de adicionar.'
        : `Não foi possível adicionar (${err.message}).`,
    );
  };

  const waitlistUrl = waLink(
    store?.whatsapp,
    `Oi! Quero ser avisado quando *${product.name}* voltar ao cardápio.`,
  );

  return (
    <main className="container" style={{ paddingBlock: '32px 96px' }}>
      <Link to={`/catalog#produto-${product.slug}`} className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Voltar ao cardápio
      </Link>

      <article className="pd-grid" style={{ marginTop: 32 }}>
        <div className="pd-frame">
          {detail?.imageUrl && !imgFailed ? (
            <img
              src={detail.imageUrl}
              alt={product.name}
              fetchPriority="high"
              onError={() => setImgFailed(true)}
              className="pd-img"
            />
          ) : (
            <div className="pd-figure">
              <ProductFigure variant={detail?.figureVariant ?? 'default'} title={product.name} />
            </div>
          )}
          {soldOut ? (
            <span className="soldout-flag" style={{ fontSize: '0.8125rem', padding: '8px 16px' }}>
              Esgotado hoje
            </span>
          ) : null}
          {!soldOut && preorder ? (
            <span
              className="soldout-flag soldout-flag--preorder"
              style={{ fontSize: '0.8125rem', padding: '8px 16px' }}
            >
              Sob encomenda
            </span>
          ) : null}
          {!soldOut && !preorder && lowStock ? (
            <span
              className="soldout-flag soldout-flag--low"
              style={{ fontSize: '0.8125rem', padding: '8px 16px' }}
            >
              Restam {stockQty} unidades
            </span>
          ) : null}
        </div>

        <div>
          <h1 className="display display-lg">{product.name}</h1>
          <p className="pd-price">{formatBRL(product.basePriceCents)}</p>
          <p className="pd-desc">
            {product.description ??
              'Pudim de receita de família, sem furinho: leite condensado, ovos selecionados e calda dourada de caramelo.'}
          </p>
          <p
            className="small muted"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Truck size={16} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" />
              Entrega{store?.city ? ` em ${store.city}` : ' local'} · preparo em ~
              {store?.prepTimeMinutes ?? 40} min
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Snowflake size={16} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" />
              Prontinho para servir
            </span>
          </p>

          {groups.length > 0 ? (
            <div className="ficha-hairline" style={{ marginTop: 32, paddingTop: 24 }}>
              {groups.map((g) => {
                const single = g.maxSelect === 1;
                const sel = selected[g.id] ?? [];
                return (
                  <fieldset
                    key={g.id}
                    className="mod-group"
                    style={{ border: 0, margin: '0 0 24px', padding: 0 }}
                  >
                    <legend className="mod-group-head" style={{ display: 'contents' }}>
                      <div className="mod-group-head">
                        <h3>{g.name}</h3>
                        <span className="mod-hint">
                          {g.required
                            ? single
                              ? 'obrigatório'
                              : `escolha ${Math.max(1, g.minSelect)}–${g.maxSelect}`
                            : single
                              ? 'opcional'
                              : `até ${g.maxSelect}`}
                        </span>
                      </div>
                    </legend>
                    <ul
                      className="mod-list"
                      role={single ? 'radiogroup' : 'group'}
                      aria-label={g.name}
                    >
                      {g.modifiers.map((m) => {
                        const isSel = sel.includes(m.id);
                        const modSoldOut = m.status === 'sold_out';
                        const capped = !isSel && !single && sel.length >= g.maxSelect;
                        const disabled = modSoldOut || capped;
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              role={single ? 'radio' : 'checkbox'}
                              aria-checked={isSel}
                              disabled={disabled}
                              className="mod-item"
                              data-shape={single ? 'radio' : 'check'}
                              {...(isSel ? { 'data-selected': true } : {})}
                              {...(disabled ? { 'data-disabled': true } : {})}
                              onClick={() => toggle(g.id, m.id, single, g.maxSelect)}
                              style={{ width: '100%' }}
                            >
                              <span className="mod-check" aria-hidden="true">
                                {isSel && !single ? <Check size={12} strokeWidth={3} /> : null}
                              </span>
                              <span className="mod-name">
                                {m.name}
                                {modSoldOut ? <span className="mod-hint"> · esgotado</span> : null}
                              </span>
                              {m.priceDeltaCents > 0 ? (
                                <span className="mod-delta">+ {formatBRL(m.priceDeltaCents)}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          ) : null}

          {!soldOut ? (
            <div
              className="ficha-hairline"
              style={{ marginTop: groups.length ? 0 : 32, paddingTop: 24 }}
            >
              {stockQty !== null ? (
                <div className="stock-line" role="status">
                  <span>Disponibilidade:</span>
                  <strong data-tone={lowStock ? 'low' : 'ok'}>
                    {lowStock ? `Restam ${stockQty} unidades` : `${stockQty} unidades disponíveis`}
                  </strong>
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginTop: stockQty !== null ? 12 : 0,
                }}
              >
                <span id="qty-label" className="small" style={{ fontWeight: 500 }}>
                  Quantidade
                </span>
                <div className="qty" role="group" aria-labelledby="qty-label">
                  <button
                    type="button"
                    aria-label="Diminuir quantidade"
                    disabled={qty <= 1}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                  >
                    <Minus size={16} aria-hidden="true" />
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button
                    type="button"
                    aria-label="Aumentar quantidade"
                    disabled={qty >= maxQty}
                    onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {missingRequired.length > 0 ? (
                <p className="small muted" role="note" style={{ marginTop: 16 }}>
                  Falta escolher: {missingRequired.map((g) => g.name).join(', ')}.
                </p>
              ) : null}

              <AddToCart
                product={product}
                qty={qty}
                modifierIds={chosenIds}
                asChild
                onAdded={onAdded}
                onError={onError}
              >
                <button
                  type="button"
                  className="btn btn-block"
                  style={{ marginTop: 20, height: 56 }}
                  disabled={missingRequired.length > 0 || status === 'paused'}
                >
                  {justAdded ? (
                    <>
                      <Check size={16} aria-hidden="true" /> Na sacola — abrindo…
                    </>
                  ) : (
                    <>
                      <ShoppingBag size={16} aria-hidden="true" /> Adicionar à sacola ·{' '}
                      {product ? formatBRL(product.basePriceCents) : ''}
                      {extrasCents > 0 ? ` + ${formatBRL(extrasCents)}` : ''}
                      {qty > 1 ? ` ×${qty}` : ''}
                    </>
                  )}
                </button>
              </AddToCart>
              {status === 'paused' ? (
                <p className="inline-alert warn" role="status" style={{ marginTop: 12 }}>
                  Estamos pausados agora — volte em instantes.
                </p>
              ) : null}
              {cartError ? (
                <p className="inline-alert error" role="alert" style={{ marginTop: 12 }}>
                  {cartError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="waitlist-box" role="status">
              <p
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                <Bell size={16} style={{ color: 'var(--zinc-400)' }} aria-hidden="true" />
                Esgotado hoje
              </p>
              <p className="small muted" style={{ marginTop: 4 }}>
                Deixe seu WhatsApp e a gente avisa na próxima fornada.
              </p>
              {waitlistDone ? (
                <p className="inline-alert info" style={{ marginTop: 12 }}>
                  <Check size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Ok — se a
                  mensagem não abrir, fale com a gente pelo WhatsApp da loja.
                </p>
              ) : waitlistOpen ? (
                <form
                  style={{ display: 'flex', gap: 8, marginTop: 12 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (phoneDigits(waitlistPhone).length < 10) return;
                    const url = waLink(
                      store?.whatsapp,
                      `Oi! Sou eu — pode me avisar quando *${product.name}* voltar? Meu número: ${waitlistPhone}`,
                    );
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                    setWaitlistDone(true);
                  }}
                >
                  <label htmlFor="waitlist-phone" className="sr-label">
                    WhatsApp com DDD
                  </label>
                  <input
                    id="waitlist-phone"
                    className="input"
                    style={{ height: 44 }}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="send"
                    required
                    placeholder="(22) 99999-9999"
                    value={waitlistPhone}
                    onChange={(e) => setWaitlistPhone(maskPhone(e.target.value))}
                  />
                  <button
                    type="submit"
                    className="btn"
                    style={{ height: 44, paddingInline: 16 }}
                    disabled={phoneDigits(waitlistPhone).length < 10}
                  >
                    Avisar
                  </button>
                </form>
              ) : waitlistUrl ? (
                <a
                  href={waitlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{ marginTop: 12, height: 44 }}
                >
                  <MessageCircle size={15} aria-hidden="true" /> Quero ser avisado
                </a>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 12, height: 44 }}
                  onClick={() => setWaitlistOpen(true)}
                >
                  Quero ser avisado
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    </main>
  );
}
