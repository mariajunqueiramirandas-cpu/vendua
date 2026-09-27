import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { dayLabel, money } from '@vendua/ui-defaults';
import { useCart, useCatalog, useProduct, useStore } from '../hooks.ts';
import {
  AddToCart,
  CartTrigger,
  ProductLink,
  StoreStatusBadge,
  useNavigateTo,
} from '../primitives.tsx';
import { BlockArea, useAreaHas, usePageContext } from '../composition/runtime.tsx';
import type { SectionProps } from '../composition/registry.ts';
import { Slot } from '../slot.tsx';
import { useKernel } from '../provider.tsx';
import { productHref, resolvePaths } from '../config.ts';
import type { CatalogProduct, ComboSelection } from '../api.ts';
import { errorCopy } from '../errors.ts';
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
  const { cart } = useCart();
  const count = cart?.status === 'open' ? cart.totals.itemCount : 0;
  const name = settings.brand || store?.name || 'Loja';
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
              <KLink key={i} href={l.href}>
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
              {settings.cartLabel} <span className="v-cart-count">{count}</span>
            </button>
          </CartTrigger>
        </div>
      </div>
    </header>
  );
}

export function Footer({ settings }: SectionProps<typeof S.footer>) {
  const { store } = useStore();
  const wa = store?.whatsapp?.replace(/\D/g, '');
  const ig = store?.instagram?.replace(/^@/, '');
  return (
    <footer className="v-footer" data-part="root">
      <div className="v-footer-inner">
        <div data-part="about">
          <p style={{ fontWeight: 600 }}>{store?.name ?? ''}</p>
          {settings.note ? <p className="v-muted">{settings.note}</p> : null}
          {store?.address ? (
            <p className="v-muted">
              {store.address}
              {store.city ? `, ${store.city}` : ''}
            </p>
          ) : null}
          {settings.showContacts ? (
            <p className="v-footer-contacts" data-part="contacts">
              {wa ? (
                <a href={`https://wa.me/${wa}`} rel="noopener noreferrer" target="_blank">
                  WhatsApp
                </a>
              ) : null}
              {wa && ig ? ' · ' : null}
              {ig ? (
                <a
                  href={`https://www.instagram.com/${ig}/`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Instagram @{ig}
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
  const { cart } = useCart();
  const count = cart?.status === 'open' ? cart.totals.itemCount : 0;
  return (
    <div
      className="v-section"
      data-part="root"
      style={{ paddingBlock: 8, display: 'flex', justifyContent: 'flex-end' }}
    >
      <CartTrigger asChild>
        <button
          type="button"
          className={settings.variant === 'pill' ? 'v-cart-pill' : 'v-link-btn'}
          data-part="trigger"
        >
          {settings.label} <span className="v-cart-count">{count}</span>
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
  const [combo, setCombo] = useState<ComboSelection[]>([]);
  const [qty, setQty] = useState(1);
  const [cartError, setCartError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const currency = store?.currency ?? 'BRL';
  const catalogHref = resolvePaths(config).catalog;
  const customMedia = useAreaHas('media', 'media');

  useEffect(() => {
    if (product && store && !settings.product) document.title = `${product.name} · ${store.name}`;
  }, [product, store, settings.product]);

  const groups = useMemo(() => product?.modifierGroups ?? [], [product]);
  const missing = groups.filter(
    (g) => g.required && (selected[g.id]?.length ?? 0) < Math.max(1, g.minSelect),
  );
  const errors = Object.fromEntries(
    missing.map((g) => [g.id, cartError ? 'Escolha uma opção' : '']).filter(([, v]) => v),
  );
  const slots = useMemo(() => product?.comboSlots ?? [], [product]);
  const comboMissing = slots
    .map((sl) => ({
      slot: sl,
      left: sl.minSelect - combo.filter((c) => c.slotId === sl.id).reduce((n, c) => n + c.qty, 0),
    }))
    .filter((m) => m.left > 0);
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
  const Title = settings.product ? 'h2' : 'h1';
  const maxQty = Math.max(1, Math.min(99, product.stockQuantity ?? 99));
  return (
    <section className="v-section" data-part="root">
      {!settings.product ? (
        <KLink href={catalogHref} className="v-back" data-part="back">
          ← {settings.backLabel}
        </KLink>
      ) : null}
      <article className="v-pp" data-variant={settings.variant} data-status={product.status}>
        <div className="v-pp-media" data-part="media">
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
              alt={product.name}
              {...{ fetchpriority: 'high' }}
              decoding="async"
            />
          ) : (
            <span className="v-card-initial" aria-hidden="true" data-figure={product.figureVariant}>
              {product.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="v-pp-info" data-part="info">
          <Title className="v-page-title" data-part="name">
            {product.name}
          </Title>
          <p className="v-pp-price v-num" data-part="price">
            {slots.some((sl) => sl.items.some((i) => i.priceDeltaCents > 0)) ? 'a partir de ' : ''}
            {money(product.basePriceCents, currency)}
          </p>
          {product.requiresPreorder ? (
            <p className="v-note" data-part="preorder" role="note">
              Sob encomenda
              {product.preorderEarliestDate
                ? ` · a partir de ${dayLabel(product.preorderEarliestDate)}`
                : product.preorderLeadDays
                  ? ` · ${product.preorderLeadDays} ${product.preorderLeadDays === 1 ? 'dia' : 'dias'} de antecedência`
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
              onChange={(gid, ids) => {
                setCartError(null);
                setSelected((prev) => ({ ...prev, [gid]: ids }));
              }}
            />
          ) : null}
          {slots.length > 0 ? (
            <Slot
              name="catalog.ComboPicker"
              slots={slots}
              value={combo}
              currency={currency}
              errors={comboErrors}
              onChange={(next) => {
                setCartError(null);
                setCombo(next);
              }}
            />
          ) : null}
          {soldOut ? (
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
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                >
                  −
                </button>
                <output aria-live="polite">{qty}</output>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  disabled={qty >= maxQty}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                >
                  +
                </button>
              </span>
              <AddToCart
                product={product}
                qty={qty}
                modifierIds={Object.values(selected).flat()}
                {...(slots.length ? { comboSelections: combo } : {})}
                asChild
                onAdded={() => {
                  setAdded(true);
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
                  disabled={missing.length > 0 || comboMissing.length > 0 || status === 'paused'}
                  data-part="add"
                >
                  {slots.length
                    ? settings.addLabel
                    : `${settings.addLabel} · ${money(product.basePriceCents * qty, currency)}`}
                </button>
              </AddToCart>
            </div>
          )}
          {(missing.length > 0 || comboMissing.length > 0) && !soldOut ? (
            <p className="v-muted" role="note" data-part="missing">
              Falta escolher:{' '}
              {[
                ...missing.map((g) => g.name),
                ...comboMissing.map((m) => `${m.left} em ${m.slot.name}`),
              ].join(', ')}
              .
            </p>
          ) : null}
          {added && settings.afterAdd === 'stay' ? (
            <p className="v-note" role="status">
              Adicionado à sacola.
            </p>
          ) : null}
          {cartError ? (
            <p className="v-alert" role="alert">
              {cartError}
            </p>
          ) : null}
          <BlockArea name="after-cta" className="v-pp-area" />
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

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function ProductGrid({
  products,
  variant,
  currency,
}: {
  products: CatalogProduct[];
  variant: string;
  currency: string;
}) {
  const { config } = useKernel();
  return (
    <ol className="v-grid" data-variant={variant} data-part="grid">
      {products.map((p) => (
        <li key={p.id} data-part="item">
          <Slot
            name="catalog.ProductCard"
            product={p}
            currency={currency}
            href={productHref(config, p.slug)}
            link={(children) => (
              <ProductLink product={p} asChild>
                <a
                  aria-label={
                    p.status === 'active'
                      ? `${p.name}, ${money(p.basePriceCents, currency)}`
                      : `${p.name}, esgotado`
                  }
                >
                  {children}
                </a>
              </ProductLink>
            )}
          />
        </li>
      ))}
    </ol>
  );
}

export function CatalogGrid({ settings }: SectionProps<typeof S.catalogGrid>) {
  const { categories, loading, error, refetch } = useCatalog();
  const { store } = useStore();
  const { page } = usePageContext();
  const [active, setActive] = useState<string>('all');
  const [query, setQuery] = useState('');
  const currency = store?.currency ?? 'BRL';
  const visible = categories.filter((c) => c.products.some((p) => p.status !== 'archived'));
  const q = normalize(query.trim());
  const filtered = visible
    .filter((c) => active === 'all' || c.id === active)
    .map((c) => ({
      ...c,
      products: c.products.filter(
        (p) =>
          p.status !== 'archived' &&
          (!q || normalize(p.name).includes(q) || normalize(p.description ?? '').includes(q)),
      ),
    }))
    .filter((c) => c.products.length > 0);

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
          <input
            id="v-catalog-search"
            type="search"
            className="v-input"
            value={query}
            maxLength={80}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      ) : null}
      {settings.showCategoryTabs && visible.length > 1 ? (
        <nav className="v-tabs" aria-label="Categorias" data-part="tabs">
          <button
            type="button"
            className="v-tab"
            aria-pressed={active === 'all'}
            onClick={() => setActive('all')}
          >
            {settings.allLabel}
          </button>
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              className="v-tab"
              aria-pressed={active === c.id}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
        </nav>
      ) : null}
      {loading && categories.length === 0 ? (
        <div className="v-grid" aria-busy="true" aria-label="Carregando cardápio">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="v-card-media" />
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
          {q ? `Nada encontrado para “${query.trim()}”.` : settings.emptyText}
        </p>
      ) : (
        filtered.map((c) => (
          <div key={c.id} data-part="category">
            {filtered.length > 1 || active === 'all' ? (
              <h3 className="v-cat-title">{c.name}</h3>
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
  const pool = settings.category
    ? (categories.find((c) => c.slug === settings.category)?.products ?? [])
    : categories.flatMap((c) => c.products);
  const products = pool.filter((p) => p.status === 'active').slice(0, settings.limit);
  if (!loading && products.length === 0) return null;
  return (
    <section className="v-section" data-part="root">
      <Head eyebrow={settings.eyebrow} title={settings.title} intro={settings.intro} />
      {loading && products.length === 0 ? (
        <div className="v-grid" aria-busy="true" aria-label="Carregando produtos">
          {Array.from({ length: settings.limit }, (_, i) => (
            <div key={i} className="v-card-media" />
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
        <p style={{ marginTop: 24 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="v-section-title" style={{ margin: 0 }}>
            {settings.title}
          </h2>
          <StoreStatusBadge />
        </div>
        {settings.showAddress && store.address ? (
          <p className="v-muted" data-part="address" style={{ margin: 0 }}>
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
