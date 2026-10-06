import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import {
  productDraw,
  stockLeftOf,
  unitsLeft,
  useCardState,
  useCart,
  useCartCount,
  useCatalog,
  useCopy,
  useLineQuote,
  useProduct,
  useReducedMotion,
  useScrollSpy,
  useStore,
} from '../hooks.ts';
import {
  AddToCart,
  CartTrigger,
  ProductLink,
  StoreStatusBadge,
  useNavigateTo,
} from '../primitives.tsx';
import { haptic } from '../haptics.ts';
import { BlockArea, useAreaHas, usePageContext } from '../composition/runtime.tsx';
import type { SectionProps } from '../composition/registry.ts';
import { Slot } from '../slot.tsx';
import { useKernel } from '../provider.tsx';
import { productHref, resolvePaths } from '../config.ts';
import type { CatalogProduct, ComboSelection } from '../api.ts';
import { errorCopy, showInfo } from '../errors.ts';
import { MAX_LINE_QTY } from '../rules/card.ts';
import { DIETARY_FILTERS, DIETARY_LABEL, dietaryBadges } from '../rules/dietary.ts';
import { formatCents, formatDay, mediaSrcSet, plural } from '../rules/format.ts';
import { absoluteUrl, contactLinks } from '../rules/links.ts';
import { arrangeMenu } from '../rules/menu.ts';
import {
  groupMissing,
  modifierMax,
  modifierUnits,
  slotMissing,
  slotUnits,
} from '../rules/modifiers.ts';
import { priceDisplay, priceWords } from '../rules/price.ts';
import * as S from './schemas.ts';

// SDK sections (17): Kernel-owned behaviour + markup, styled by tokens,
// `variant` settings and documented data-part / --v-<component>-* hooks.

/** Internal hrefs navigate in-app; anything else is a normal link. */
export function KLink({
  href,
  className,
  children,
  ...rest
}: { href: string; className?: string; children: ReactNode } & Record<string, unknown>) {
  const go = useNavigateTo();
  const internal = href.startsWith('/') && !href.startsWith('//');
  return (
    <a
      {...rest}
      href={href}
      className={className}
      onClick={(e) => {
        if (!internal || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

function Head({
  eyebrow,
  title,
  intro,
  as = 'h2',
}: {
  eyebrow?: string | undefined;
  title?: string | undefined;
  intro?: string | undefined;
  as?: 'h1' | 'h2';
}) {
  if (!eyebrow && !title && !intro) return null;
  const H = as;
  return (
    <header className="v-section-head" data-part="head">
      {eyebrow ? <p className="v-eyebrow">{eyebrow}</p> : null}
      {title ? <H className={as === 'h1' ? 'v-page-title' : 'v-section-title'}>{title}</H> : null}
      {intro ? <p className="v-muted">{intro}</p> : null}
    </header>
  );
}

export function PageContent() {
  return <Outlet />;
}

export function Header({ settings }: SectionProps<typeof S.header>) {
  const { store } = useStore();
  const count = useCartCount();
  const name = settings.brand || store?.name || 'Loja';
  const { pathname } = useLocation();
  return (
    <header className="v-header" data-part="root">
      <a href="#main" className="v-sr" data-part="skip">
        Pular para o conteúdo
      </a>
      <div className="v-header-inner">
        <KLink href="/" className="v-brand" data-part="brand" aria-label={`${name} — início`}>
          {settings.logo ? <img src={settings.logo} alt="" height={36} data-part="logo" /> : null}
          <span>{name}</span>
        </KLink>
        {settings.links?.length ? (
          <nav className="v-nav" aria-label="Navegação principal" data-part="nav">
            {settings.links.map((l, i) => (
              <KLink
                key={i}
                href={l.href}
                aria-current={
                  l.href !== '/' && (pathname === l.href || pathname.startsWith(`${l.href}/`))
                    ? 'page'
                    : undefined
                }
              >
                {l.label}
              </KLink>
            ))}
          </nav>
        ) : null}
        <div className="v-header-actions" data-part="actions">
          <BlockArea name="actions" />
          {settings.showStatus ? <StoreStatusBadge /> : null}
          <CartTrigger asChild>
            <button type="button" className="v-cart-pill" data-part="cart">
              <BagGlyph />
              <span className="v-cart-label">{settings.cartLabel}</span>{' '}
              <span key={count} className="v-cart-count" data-empty={count === 0 || undefined}>
                {count}
              </span>
            </button>
          </CartTrigger>
        </div>
      </div>
    </header>
  );
}

export function Footer({ settings }: SectionProps<typeof S.footer>) {
  const { store } = useStore();
  const { whatsapp, instagram } = contactLinks(store);
  return (
    <footer className="v-footer" data-part="root">
      <div className="v-footer-inner">
        <div data-part="about">
          <p className="v-footer-name">{store?.name ?? ''}</p>
          {settings.note ? <p className="v-muted">{settings.note}</p> : null}
          {store?.address ? (
            <p className="v-muted">
              {store.address}
              {store.city ? `, ${store.city}` : ''}
            </p>
          ) : null}
          {settings.showContacts ? (
            <p className="v-footer-contacts" data-part="contacts">
              {whatsapp ? (
                <a href={whatsapp.href} rel="noopener noreferrer" target="_blank">
                  WhatsApp
                </a>
              ) : null}
              {instagram ? (
                <a href={instagram.href} rel="noopener noreferrer" target="_blank">
                  Instagram @{instagram.handle}
                </a>
              ) : null}
            </p>
          ) : null}
          {settings.links?.length ? (
            <nav aria-label="Links do rodapé" data-part="links">
              {settings.links.map((l, i) => (
                <p key={i}>
                  <KLink href={l.href}>{l.label}</KLink>
                </p>
              ))}
            </nav>
          ) : null}
          <BlockArea name="extra" />
        </div>
        {settings.showHours && store ? (
          <div data-part="hours">
            <Slot name="store.HoursTable" hours={store.hours} status={store.status} />
          </div>
        ) : null}
      </div>
    </footer>
  );
}

export function AnnouncementBar({ settings }: SectionProps<typeof S.announcementBar>) {
  if (!settings.text) return null;
  return (
    <div
      className="v-announcement"
      data-part="root"
      data-tone={settings.tone}
      role="region"
      aria-label="Aviso da loja"
    >
      <span>{settings.text}</span>
      {settings.href && settings.linkLabel ? (
        <KLink href={settings.href}>{settings.linkLabel}</KLink>
      ) : null}
    </div>
  );
}

export function HeaderCart({ settings }: SectionProps<typeof S.headerCart>) {
  const count = useCartCount();
  return (
    <div className="v-section v-header-cart" data-part="root">
      <CartTrigger asChild>
        <button
          type="button"
          className={settings.variant === 'pill' ? 'v-cart-pill' : 'v-link-btn'}
          data-part="trigger"
        >
          {settings.label}{' '}
          <span key={count} className="v-cart-count" data-empty={count === 0 || undefined}>
            {count}
          </span>
        </button>
      </CartTrigger>
    </div>
  );
}

export function BagBar({ settings }: SectionProps<typeof S.bagBar>) {
  const { cart } = useCart();
  const { store } = useStore();
  const { config } = useKernel();
  const { pathname } = useLocation();
  const paths = resolvePaths(config);
  // the product page has its own sticky buy bar; cart/checkout/order already are the bag
  const quiet = [paths.product, paths.cart, paths.checkout, paths.order].some((p) =>
    matchPath({ path: p, end: true }, pathname),
  );
  const count = useCartCount();
  if (quiet || count === 0 || !cart) return null;
  return (
    <div className="v-bag-bar" data-vendua="bag-bar" data-part="root">
      <CartTrigger asChild>
        <button type="button" className="v-bag-bar-btn" data-part="trigger">
          <span className="v-bag-bar-count" key={count}>
            {count}
          </span>
          <span className="v-bag-bar-label">{settings.label}</span>
          <span className="v-bag-bar-total v-num">
            {formatCents(cart.totals.subtotalCents, store?.currency ?? 'BRL')}
          </span>
        </button>
      </CartTrigger>
    </div>
  );
}

export function PurchasePanel({ settings }: SectionProps<typeof S.purchasePanel>) {
  const { params } = usePageContext();
  const slug = settings.product || params.slug || '';
  const { product, loading, error, refetch } = useProduct(slug);
  const { store, status } = useStore();
  const { config } = useKernel();
  const go = useNavigateTo();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  // units of picked options with maxQty > 1 (absent = 1)
  const [modQty, setModQty] = useState<Record<string, number>>({});
  const [combo, setCombo] = useState<ComboSelection[]>([]);
  const [qty, setQty] = useState(1);
  const [cartError, setCartError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const currency = store?.currency ?? 'BRL';
  const money = (cents: number) => formatCents(cents, currency);
  const { vocabulary } = useCopy();
  const catalogHref = resolvePaths(config).catalog;
  const customMedia = useAreaHas('media', 'media');
  const { cart } = useCart();
  // units (kits) that still fit next to the cart, counting the kit's picks
  const left = product ? unitsLeft(cart, productDraw(product, combo)) : Number.POSITIVE_INFINITY;
  const maxQty = Math.max(1, Math.min(MAX_LINE_QTY, left));

  // the cart took stock since the stepper was set: never offer more than is left
  useEffect(() => setQty((q) => Math.min(q, maxQty)), [maxQty]);

  const groups = useMemo(() => product?.modifierGroups ?? [], [product]);
  const pickedIds = Object.values(selected).flat();
  // units per picked option (a toggle is 1): Core counts a group's min/max in units
  const picks: Record<string, number> = Object.fromEntries(
    pickedIds.map((id) => [id, modQty[id] ?? 1]),
  );
  const missing = groups.filter((g) => groupMissing(g, modifierUnits(g, picks)));
  const pickedQty = Object.fromEntries(Object.entries(picks).filter(([, n]) => n > 1));
  const errors = Object.fromEntries(
    missing.map((g) => [g.id, cartError ? 'Escolha uma opção' : '']).filter(([, v]) => v),
  );
  const slots = useMemo(() => product?.comboSlots ?? [], [product]);
  // the picker's per-item stock: what one kit can still take at this qty, after the cart
  // and the same item picked in the kit's other slots
  const pickerSlots = useMemo(
    () =>
      slots.map((sl) => ({
        ...sl,
        items: sl.items.map((i) => {
          const free = stockLeftOf(cart, { id: i.productId, stockQuantity: i.stockQuantity });
          if (free === null) return i;
          const elsewhere = combo
            .filter((c) => c.slotId !== sl.id && c.productId === i.productId)
            .reduce((n, c) => n + c.qty, 0);
          return { ...i, stockLeft: Math.max(0, Math.floor(free / qty) - elsewhere) };
        }),
      })),
    [slots, combo, cart, qty],
  );
  const comboMissing = slots
    .map((sl) => ({ slot: sl, left: slotMissing(sl, slotUnits(sl, combo)) }))
    .filter((m) => m.left > 0);
  const complete = missing.length === 0 && comboMissing.length === 0;
  // Core's price for this exact line (options, kit picks, qty) — asked only once it can be added
  const line = useLineQuote(
    product && complete && product.status === 'active' ? product : null,
    {
      modifiers: Object.entries(picks).map(([id, n]) => ({ id, qty: n })),
      comboSelections: combo,
    },
    qty,
  );
  const lineTotal = line.quote && !line.pending && !line.error ? line.quote.lineTotalCents : null;
  const comboErrors = Object.fromEntries(
    comboMissing.map((m) => [m.slot.id, cartError ? `Faltam ${m.left}` : '']).filter(([, v]) => v),
  );

  if (!slug) return null;
  if (loading && !product) {
    return (
      <section
        className="v-section"
        aria-busy="true"
        aria-label="Carregando produto"
        data-part="root"
      >
        <div className="v-pp" data-variant={settings.variant}>
          <div className="v-pp-media" />
          <div />
        </div>
      </section>
    );
  }
  if (!product) {
    return (
      <section className="v-section" data-part="root">
        <div className="v-panel v-empty" role={error ? 'alert' : undefined}>
          <h1 className="v-panel-title">
            {error && error.code !== 'PRODUCT_NOT_FOUND'
              ? 'Não foi possível carregar o produto.'
              : 'Produto não encontrado.'}
          </h1>
          {error && error.code !== 'PRODUCT_NOT_FOUND' ? (
            <button type="button" className="v-btn v-btn-accent" onClick={refetch}>
              Tentar novamente
            </button>
          ) : (
            <KLink href={catalogHref} className="v-btn v-btn-accent">
              {settings.backLabel}
            </KLink>
          )}
        </div>
      </section>
    );
  }

  const soldOut = product.status !== 'active';
  const shown = priceDisplay(product);
  const Title = settings.product ? 'h2' : 'h1';
  const badges = dietaryBadges(product);
  // Kernel 1.21 — the product's own link: the share sheet, else the clipboard
  const share = async () => {
    const url = absoluteUrl(
      store?.publicUrl || globalThis.location?.origin || '',
      productHref(config, product.slug),
    );
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      // a closed sheet rejects (AbortError): nothing to say
      await nav
        .share({
          title: product.name,
          text: store ? `${product.name} · ${store.name}` : product.name,
          url,
        })
        .catch(() => {});
      return;
    }
    try {
      await nav!.clipboard.writeText(url);
      showInfo('share-product', 'Link copiado', 'Cole numa conversa para mandar.');
    } catch {
      showInfo('share-product', 'Copie o link do produto', url);
    }
  };
  return (
    <section className="v-section" data-part="root">
      {!settings.product ? (
        <KLink href={catalogHref} className="v-back" data-part="back">
          ← {settings.backLabel}
        </KLink>
      ) : null}
      <article className="v-pp" data-variant={settings.variant} data-status={product.status}>
        <div className="v-pp-media" data-part="media" data-vt-dst={`product:${product.slug}`}>
          <BlockArea name="media" only={['media']} className="v-pp-media-custom" />
          <BlockArea name="media" only={['badge']} className="v-pp-media-badges" />
          {customMedia ? null : (product.gallery?.length ?? 0) > 1 ? (
            <Slot
              name="catalog.Gallery"
              images={product.gallery!.map((g) => ({ url: g.url, alt: g.alt }))}
              productName={product.name}
              figureVariant={product.figureVariant}
            />
          ) : product.imageUrl ? (
            <img
              src={product.imageUrl}
              {...(mediaSrcSet(product.imageUrl)
                ? {
                    srcSet: mediaSrcSet(product.imageUrl),
                    sizes: '(max-width: 719px) 100vw, 560px',
                  }
                : {})}
              alt={product.name}
              {...{ fetchpriority: 'high' }}
              decoding="async"
            />
          ) : (
            <span className="v-card-initial" aria-hidden="true" data-figure={product.figureVariant}>
              <span>{product.name.slice(0, 1).toUpperCase()}</span>
            </span>
          )}
        </div>
        <div className="v-pp-info" data-part="info">
          <Title className="v-page-title" data-part="name">
            {product.name}
          </Title>
          <p className="v-pp-price v-num" data-part="price" data-form={shown.form}>
            {shown.struckCents !== null ? (
              <>
                <s className="v-compare-at" data-part="compare-at">
                  <span className="v-sr">de </span>
                  {money(shown.struckCents)}
                </s>{' '}
                <span className="v-sr">por </span>
              </>
            ) : null}
            {shown.form === 'from' ? (
              <span className="v-price-from" data-part="from">
                a partir de{' '}
              </span>
            ) : null}
            {money(shown.cents)}
          </p>
          {shown.promoLabel ? (
            <p className="v-pp-promo" data-part="promo">
              Promoção: {shown.promoLabel}
            </p>
          ) : null}
          {badges.length ? (
            <ul className="v-diet" data-part="dietary" aria-label="Dieta e alergênicos">
              {badges.map((b) => (
                <li key={b.tag} className="v-diet-badge" data-kind={b.kind} data-tag={b.tag}>
                  {b.label}
                </li>
              ))}
            </ul>
          ) : null}
          {product.requiresPreorder ? (
            <p className="v-note" data-part="preorder" role="note">
              Sob encomenda
              {product.preorderEarliestDate
                ? ` · a partir de ${formatDay(product.preorderEarliestDate)}`
                : product.preorderLeadDays
                  ? ` · ${product.preorderLeadDays} ${plural(product.preorderLeadDays, 'dia', 'dias')} de antecedência`
                  : ''}
            </p>
          ) : null}
          <BlockArea name="after-price" className="v-pp-area" />
          {settings.showDescription && product.description ? (
            <p className="v-pp-desc" data-part="description">
              {product.description}
            </p>
          ) : null}
          {groups.length > 0 ? (
            <Slot
              name="catalog.ModifierPicker"
              groups={groups}
              value={selected}
              currency={currency}
              errors={errors}
              quantities={pickedQty}
              onChange={(gid, ids) => {
                setCartError(null);
                // an option the picker dropped forgets its units
                const gone = (selected[gid] ?? []).filter((id) => !ids.includes(id));
                if (gone.length)
                  setModQty((q) => {
                    const rest = { ...q };
                    for (const id of gone) delete rest[id];
                    return rest;
                  });
                setSelected((prev) => ({ ...prev, [gid]: ids }));
              }}
              onQtyChange={(gid, mid, n) => {
                const g = groups.find((x) => x.id === gid);
                if (!g || !g.modifiers.some((x) => x.id === mid)) return;
                const next = Math.max(0, Math.min(modifierMax(g, mid, picks), Math.floor(n)));
                setCartError(null);
                setSelected((prev) => {
                  const ids = (prev[gid] ?? []).filter((id) => id !== mid);
                  return { ...prev, [gid]: next > 0 ? [...ids, mid] : ids };
                });
                setModQty((prev) => {
                  const rest = { ...prev };
                  delete rest[mid];
                  return next > 1 ? { ...rest, [mid]: next } : rest;
                });
              }}
            />
          ) : null}
          {slots.length > 0 ? (
            <Slot
              name="catalog.ComboPicker"
              slots={pickerSlots}
              value={combo}
              currency={currency}
              errors={comboErrors}
              onChange={(next) => {
                setCartError(null);
                setCombo(next);
              }}
            />
          ) : null}
          {soldOut && product.availabilityLabel ? (
            <p className="v-note" role="status" data-part="availability">
              <strong>Indisponível agora</strong> · {product.availabilityLabel}
            </p>
          ) : soldOut ? (
            <p className="v-alert" role="status" data-part="sold-out">
              {settings.soldOutText}
            </p>
          ) : (
            <div className="v-pp-buy" data-part="buy">
              <span className="v-qty" role="group" aria-label="Quantidade">
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  disabled={qty <= 1}
                  onClick={() => {
                    haptic.tick();
                    setQty((q) => Math.max(1, q - 1));
                  }}
                >
                  −
                </button>
                <output aria-live="polite">{qty}</output>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  disabled={qty >= maxQty}
                  onClick={() => {
                    haptic.tick();
                    setQty((q) => Math.min(maxQty, q + 1));
                  }}
                >
                  +
                </button>
              </span>
              <AddToCart
                product={product}
                qty={qty}
                modifierIds={pickedIds}
                {...(Object.keys(pickedQty).length ? { modifierQty: pickedQty } : {})}
                {...(slots.length ? { comboSelections: combo } : {})}
                asChild
                onAdded={() => {
                  setAdded(true);
                  // the full sacola, as before 1.11: a sheet would sit over the page's own triggers
                  if (settings.afterAdd === 'cart') go(resolvePaths(config).cart);
                }}
                onError={(err) =>
                  setCartError(
                    err.code === 'MODIFIER_REQUIRED'
                      ? 'Escolha as opções obrigatórias antes de adicionar.'
                      : err.code in COPY_CODES
                        ? errorCopy(err.code).title
                        : `Não foi possível adicionar (${err.message}).`,
                  )
                }
              >
                <button
                  type="button"
                  className="v-btn v-btn-accent"
                  disabled={!complete || status === 'paused'}
                  data-part="add"
                >
                  <span>{settings.addLabel}</span>
                  {/* only Core's total for exactly this line: any other amount (one unit, no
                      options) would be a price the shopper isn't charged */}
                  <span
                    className="v-pp-add-price v-num"
                    data-part="add-price"
                    data-state={lineTotal !== null ? 'quote' : line.pending ? 'pending' : 'none'}
                  >
                    {lineTotal !== null ? (
                      <>
                        <span className="v-pp-add-sep">· </span>
                        {money(lineTotal)}
                      </>
                    ) : null}
                  </span>
                </button>
              </AddToCart>
            </div>
          )}
          {!complete && !soldOut ? (
            <p className="v-muted" role="note" data-part="missing">
              Falta escolher:{' '}
              {[
                ...missing.map((g) => g.name),
                ...comboMissing.map((m) => `${m.left} em ${m.slot.name}`),
              ].join(', ')}
              .
            </p>
          ) : null}
          {left === 0 && !soldOut ? (
            <p className="v-note" role="status" data-part="stock-limit">
              Você já tem {vocabulary.inBag} todas as unidades disponíveis.
            </p>
          ) : null}
          {added && settings.afterAdd === 'stay' ? (
            <p className="v-note" role="status">
              Adicionado {vocabulary.toBag}.
            </p>
          ) : null}
          {cartError ? (
            <p className="v-alert" role="alert">
              {cartError}
            </p>
          ) : null}
          <BlockArea name="after-cta" className="v-pp-area" />
          {settings.showShare ? (
            <button
              type="button"
              className="v-link-btn v-pp-share"
              data-part="share"
              onClick={() => void share()}
            >
              <ShareGlyph />
              Compartilhar
            </button>
          ) : null}
        </div>
      </article>
    </section>
  );
}

// codes whose Kernel copy reads well inline under the add button
const COPY_CODES: Record<string, true> = {
  OUT_OF_STOCK: true,
  COMBO_SLOT_COUNT: true,
  COMBO_ITEM_LIMIT: true,
  COMBO_ITEM_SOLD_OUT: true,
  INVALID_COMBO: true,
  SOLD_OUT: true,
  MODIFIER_SOLD_OUT: true,
};

function ProductGrid({
  products,
  variant,
  currency,
}: {
  products: CatalogProduct[];
  variant: string;
  currency: string;
}) {
  return (
    <ol className="v-grid" data-variant={variant} data-part="grid">
      {products.map((p) => (
        <li key={p.id} data-part="item">
          <GridCard product={p} currency={currency} />
        </li>
      ))}
    </ol>
  );
}

function GridCard({ product: p, currency }: { product: CatalogProduct; currency: string }) {
  const { config } = useKernel();
  const { vocabulary } = useCopy();
  const card = useCardState(p);
  // the card's link label replaces its contents for screen readers: the diets ride along
  const diets = dietaryBadges(p)
    .filter((b) => b.kind !== 'allergen')
    .map((b) => `, ${b.label.toLowerCase()}`)
    .join('');
  return (
    <Slot
      name="catalog.ProductCard"
      product={p}
      {...(card.stockLeft !== null ? { stockLeft: card.stockLeft } : {})}
      currency={currency}
      vocabulary={vocabulary}
      href={productHref(config, p.slug)}
      link={(children) => (
        <ProductLink product={p} asChild>
          <a
            aria-label={
              card.soldOut
                ? `${p.name}${diets}, esgotado`
                : `${p.name}${diets}, ${priceWords(priceDisplay(p), currency)}`
            }
          >
            {children}
          </a>
        </ProductLink>
      )}
      {...(card.canQuickAdd
        ? {
            quickAdd: (children: ReactNode) => (
              <AddToCart
                product={p}
                asChild
                onAdded={() => showInfo(`added:${p.id}`, `${p.name} ${vocabulary.inBag}`)}
              >
                <button type="button" aria-label={`Adicionar ${p.name} ${vocabulary.toBag}`}>
                  {children}
                </button>
              </AddToCart>
            ),
          }
        : {})}
    />
  );
}

// a category lights its jump tab once its top passes under the header and the tab strip
const SPY_MARGIN = '-140px 0px -55% 0px';
const categoryAnchor = (slug: string) => `categoria-${slug}`;

export function CatalogGrid({ settings }: SectionProps<typeof S.catalogGrid>) {
  const { store } = useStore();
  const { page } = usePageContext();
  const [active, setActive] = useState<string>('all');
  const [query, setQuery] = useState('');
  // Kernel 1.21 — diets the shopper narrowed the menu to (`DIETARY_FILTERS`)
  const [diet, setDiet] = useState<string[]>([]);
  const currency = store?.currency ?? 'BRL';
  const q = query.trim();
  const { categories, loading, error, refetch } = useCatalog();
  // Kernel 1.21 — 'jump': every category stays on the page and the tabs scroll to it
  const jump = settings.categoryNav === 'jump';
  const still = useReducedMotion();
  const dietKey = diet.join(',');
  const filters = useMemo(
    () =>
      settings.showDietFilter
        ? DIETARY_FILTERS.filter((t) =>
            categories.some((c) => c.products.some((p) => p.dietary?.includes(t))),
          )
        : [],
    [categories, settings.showDietFilter],
  );
  // a filter the catalog no longer offers stops narrowing it
  const chosen = useMemo(
    () => (dietKey ? dietKey.split(',') : []).filter((t) => filters.includes(t)),
    [dietKey, filters],
  );
  // empty categories drop out and sold-out items sink to the end of theirs; a search spans
  // every category
  const visible = useMemo(() => arrangeMenu(categories, { dietary: chosen }), [categories, chosen]);
  const current = visible.some((c) => c.id === active) ? active : 'all';
  const filtered = useMemo(
    () =>
      q
        ? arrangeMenu(categories, { query: q, dietary: chosen })
        : jump
          ? visible
          : visible.filter((c) => current === 'all' || c.id === current),
    [categories, visible, q, current, chosen, jump],
  );
  const hits = filtered.reduce((n, c) => n + c.products.length, 0);
  const narrowed = q !== '' || chosen.length > 0;

  // jump navigation: the category being read lights its tab; a tapped tab owns the highlight
  // until its scroll lands
  const anchors = jump && !q ? visible.map((c) => categoryAnchor(c.slug)) : [];
  const spied = useScrollSpy(anchors, { rootMargin: SPY_MARGIN });
  const jumping = useRef(false);
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => {
    if (!jumping.current) setTapped(null);
  }, [spied]);
  const lit = tapped ?? spied;
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = strip.current;
    const tab = lit ? el?.querySelector<HTMLElement>(`[href="#${lit}"]`) : null;
    if (!el || !tab || typeof el.scrollTo !== 'function') return;
    el.scrollTo({
      left: tab.offsetLeft - el.clientWidth / 2 + tab.clientWidth / 2,
      behavior: still ? 'auto' : 'smooth',
    });
  }, [lit, still]);
  const goTo = (anchor: string) => {
    setTapped(anchor);
    jumping.current = true;
    const release = () => {
      jumping.current = false;
      window.removeEventListener('scrollend', release);
    };
    window.addEventListener('scrollend', release);
    // without scrollend (or a jump that doesn't move) the strip is handed back anyway
    window.setTimeout(release, 1200);
    document
      .getElementById(anchor)
      ?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  };
  const toggleDiet = (tag: string) =>
    setDiet((d) => (d.includes(tag) ? d.filter((t) => t !== tag) : [...d, tag]));

  return (
    <section className="v-section" data-part="root" id="cardapio">
      <Head
        eyebrow={settings.eyebrow}
        title={settings.title}
        intro={settings.intro}
        as={page === 'catalog' ? 'h1' : 'h2'}
      />
      <BlockArea name="before-grid" />
      {settings.showSearch ? (
        <form
          role="search"
          className="v-search"
          data-part="search"
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="v-label" htmlFor="v-catalog-search">
            {settings.searchLabel}
          </label>
          <div className="v-search-field">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" data-part="icon">
              <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m13 13 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="v-catalog-search"
              type="search"
              className="v-input"
              value={query}
              maxLength={80}
              placeholder="Nome, sabor, categoria…"
              autoComplete="off"
              aria-describedby={narrowed ? 'v-catalog-hits' : undefined}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {query ? (
              <button
                type="button"
                className="v-search-clear"
                aria-label="Limpar busca"
                onClick={() => setQuery('')}
              >
                ×
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      {filters.length ? (
        <div
          className="v-diet-filter"
          role="group"
          aria-label="Filtrar por dieta"
          data-part="diet-filter"
        >
          {filters.map((t) => (
            <button
              key={t}
              type="button"
              className="v-chip"
              data-tag={t}
              aria-pressed={chosen.includes(t)}
              onClick={() => toggleDiet(t)}
            >
              {DIETARY_LABEL[t]}
            </button>
          ))}
        </div>
      ) : null}
      {narrowed ? (
        <p id="v-catalog-hits" className="v-muted v-search-hits" role="status">
          {hits === 0 ? 'Nenhum resultado' : `${hits} ${plural(hits, 'resultado', 'resultados')}`}
        </p>
      ) : null}
      {settings.showCategoryTabs && visible.length > 1 && !q ? (
        jump ? (
          <nav
            className="v-tabs"
            data-mode="jump"
            aria-label="Categorias"
            data-part="tabs"
            ref={strip}
          >
            {visible.map((c) => {
              const anchor = categoryAnchor(c.slug);
              return (
                <a
                  key={c.id}
                  href={`#${anchor}`}
                  className="v-tab"
                  aria-current={lit === anchor ? 'true' : undefined}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    goTo(anchor);
                  }}
                >
                  {c.name}
                </a>
              );
            })}
          </nav>
        ) : (
          <nav className="v-tabs" aria-label="Categorias" data-part="tabs">
            <button
              type="button"
              className="v-tab"
              aria-pressed={current === 'all'}
              onClick={() => setActive('all')}
            >
              {settings.allLabel}
            </button>
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                className="v-tab"
                aria-pressed={current === c.id}
                onClick={() => setActive(c.id)}
              >
                {c.name}
              </button>
            ))}
          </nav>
        )
      ) : null}
      {loading && categories.length === 0 ? (
        <div className="v-grid" aria-busy="true" aria-label="Carregando cardápio">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error && categories.length === 0 ? (
        <Slot
          name="system.ErrorFallback"
          error={{ code: error.code, message: 'O cardápio não carregou.' }}
          retry={refetch}
        />
      ) : filtered.length === 0 ? (
        <p className="v-muted" data-part="empty">
          {narrowed ? (
            <>
              {q ? `Nada encontrado para “${q}”.` : 'Nenhum produto com esses filtros.'}{' '}
              <button
                type="button"
                className="v-link-btn"
                onClick={() => {
                  setQuery('');
                  setDiet([]);
                }}
              >
                Ver tudo
              </button>
            </>
          ) : (
            settings.emptyText
          )}
        </p>
      ) : (
        filtered.map((c) => (
          <div
            key={c.id}
            data-part="category"
            {...(jump && !q ? { id: categoryAnchor(c.slug), 'data-anchor': '' } : {})}
          >
            {filtered.length > 1 || current === 'all' ? (
              <h3 className="v-cat-title">
                {c.name} <span className="v-cat-count v-num">{c.products.length}</span>
              </h3>
            ) : null}
            {c.description && !q ? (
              <p className="v-cat-desc v-muted" data-part="category-description">
                {c.description}
              </p>
            ) : null}
            <ProductGrid products={c.products} variant={settings.variant} currency={currency} />
          </div>
        ))
      )}
    </section>
  );
}

export function ProductList({ settings }: SectionProps<typeof S.productList>) {
  const { categories, loading } = useCatalog();
  const { store } = useStore();
  const { params } = usePageContext();
  const pool = settings.category
    ? (categories.find((c) => c.slug === settings.category)?.products ?? [])
    : categories.flatMap((c) => c.products);
  // on a product page, "you may also like" never suggests the product itself
  const products = pool
    .filter((p) => p.status === 'active' && p.slug !== params.slug)
    .slice(0, settings.limit);
  if (!loading && products.length === 0) return null;
  return (
    <section className="v-section" data-part="root">
      <Head eyebrow={settings.eyebrow} title={settings.title} intro={settings.intro} />
      {loading && products.length === 0 ? (
        <div className="v-grid" aria-busy="true" aria-label="Carregando produtos">
          {Array.from({ length: settings.limit }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <ProductGrid
          products={products}
          variant={settings.variant}
          currency={store?.currency ?? 'BRL'}
        />
      )}
      {settings.ctaLabel && settings.ctaHref ? (
        <p className="v-section-cta">
          <KLink href={settings.ctaHref} className="v-btn v-btn-ghost" data-part="cta">
            {settings.ctaLabel}
          </KLink>
        </p>
      ) : null}
    </section>
  );
}

export function StoreStatus({ settings }: SectionProps<typeof S.storeStatus>) {
  const { store } = useStore();
  if (!store) return null;
  return (
    <section className="v-section" data-part="root" data-variant={settings.variant}>
      <div className={settings.variant === 'card' ? 'v-panel v-status-card' : 'v-status-card'}>
        <div className="v-status-head">
          <h2 className="v-section-title">{settings.title}</h2>
          <StoreStatusBadge />
        </div>
        {settings.showAddress && store.address ? (
          <p className="v-muted" data-part="address">
            {store.address}
            {store.city ? `, ${store.city}` : ''}
          </p>
        ) : null}
        {settings.showHours ? (
          <Slot name="store.HoursTable" hours={store.hours} status={store.status} />
        ) : null}
      </div>
    </section>
  );
}

export function RichText({ settings }: SectionProps<typeof S.richTextSection>) {
  const { page } = usePageContext();
  const paragraphs = (settings.body ?? '').split(/\n{2,}/).filter(Boolean);
  if (!settings.title && paragraphs.length === 0) return null;
  return (
    <section className="v-section v-rich" data-part="root">
      <Head
        eyebrow={settings.eyebrow}
        title={settings.title}
        as={page.startsWith('page:') ? 'h1' : 'h2'}
      />
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="v-skeleton-card" aria-hidden="true">
      <div className="v-card-media v-skeleton" />
      <div className="v-skeleton v-skeleton-line" />
      <div className="v-skeleton v-skeleton-line" data-short="" />
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

function BagGlyph() {
  return (
    <svg
      className="v-cart-glyph"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
